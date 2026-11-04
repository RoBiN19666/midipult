#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Статические проверки фронтенда и конфигов (без колонки и браузера).

  python3 tests/static_checks.py

Проверяет: синтаксис JS (node --check), дубликаты id, все id из init(),
внешние ссылки, CRLF/BOM, баланс скобок в myweb.conf, состав модулей
lighttpd и синтаксис init-скрипта (sh -n, если есть sh).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
NODE = os.environ.get("NODE") or shutil.which("node") or "node"

TEXT_EXT = (".html", ".py", ".conf", ".sh", ".md", ".json", ".ps1")
RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append((name, bool(condition), detail))
    print("[%s] %s%s" % ("PASS" if condition else "FAIL", name,
                        ("  — " + detail) if detail and not condition else ""))


def read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def test_encoding():
    bad = []
    for folder, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", ".tmp", ".release")]
        for name in files:
            if not (name.endswith(TEXT_EXT) or name == "S99mypult"):
                continue
            path = os.path.join(folder, name)
            with open(path, "rb") as fh:
                raw = fh.read()
            if b"\r\n" in raw:
                bad.append(os.path.relpath(path, ROOT) + " (CRLF)")
            # .ps1 намеренно с BOM: Windows PowerShell 5.1 иначе читает
            # кириллицу как ANSI и ломает разбор скрипта.
            if raw.startswith(b"\xef\xbb\xbf") and not name.endswith(".ps1"):
                bad.append(os.path.relpath(path, ROOT) + " (BOM)")
    check("файлы без CRLF и BOM", not bad, ", ".join(bad))


def test_html_structure():
    html = read(os.path.join(ROOT, "index.html"))
    ids = re.findall(r'\bid="([^"]+)"', html)
    dups = sorted({i for i in ids if ids.count(i) > 1})
    check("нет дубликатов id", not dups, ", ".join(dups))

    for tag in ("section", "div", "button", "svg", "main", "header", "footer", "dialog"):
        opens = len(re.findall(r"<%s[\s>]" % tag, html))
        closes = len(re.findall(r"</%s>" % tag, html))
        check("теги <%s> сбалансированы" % tag, opens == closes, "%d/%d" % (opens, closes))

    check("есть viewport", 'name="viewport"' in html)
    external = re.findall(r'(?:src|href)="(https?://[^"]+)"', html)
    external = [url for url in external
                if not url.startswith("https://github.com/RoBiN19666/midipult")]
    check("нет внешних ресурсов", not external,
          ", ".join(external) or "станция работает офлайн")


def test_js_syntax():
    html = read(os.path.join(ROOT, "index.html"))
    present = set(re.findall(r'\bid="([^"]+)"', html))
    scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
    check("найден inline-скрипт", bool(scripts))
    if not scripts:
        return
    js = scripts[-1]

    fd, tmp = tempfile.mkstemp(prefix="mypult-js-", suffix=".js")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(js)
    try:
        proc = subprocess.run([NODE, "--check", tmp], capture_output=True, text=True)
        check("JS проходит node --check", proc.returncode == 0,
              (proc.stderr or "").strip()[:400])
    except FileNotFoundError:
        check("JS проходит node --check", True, "node не найден — пропущено")
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    match = re.search(r"\[\s*('pill'.*?)\]\.forEach", js, re.S)
    check("найден список id в init()", bool(match))
    if match:
        wanted = re.findall(r"'([^']+)'", match.group(1))
        missing = [w for w in wanted if w not in present]
        check("все id из init() есть в разметке", not missing, ", ".join(missing))

    symbols = set(re.findall(r'<symbol id="([^"]+)"', html))
    used = set(re.findall(r'<use href="#([^"]+)"', html))
    check("все <use> ссылаются на symbol", used <= symbols, ", ".join(sorted(used - symbols)))

    clicks = set(re.findall(r"\$\('#([a-zA-Z0-9_-]+)'\)\.addEventListener", js))
    check("обработчики ссылаются на существующие id", clicks <= present,
          ", ".join(sorted(clicks - present)))


def test_css():
    html = read(os.path.join(ROOT, "index.html"))
    css = re.search(r"<style>(.*?)</style>", html, re.S).group(1)
    check("CSS: скобки сбалансированы", css.count("{") == css.count("}"),
          "%d/%d" % (css.count("{"), css.count("}")))
    check("CSS: есть тёмная палитра", "--bg:" in css and "--card-a:" in css)
    check("CSS: адаптив", "@media" in css)


def strip_comments(text):
    lines = []
    for line in text.splitlines():
        lines.append(line.split("#", 1)[0] if not line.lstrip().startswith("#") else "")
    return "\n".join(lines)


def test_lighttpd_config():
    text = read(os.path.join(ROOT, "lighttpd", "myweb.conf"))
    active = strip_comments(text)

    depth = 0
    for char in active:
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        if depth < 0:
            break
    check("lighttpd: фигурные скобки сбалансированы", depth == 0, "depth=%d" % depth)

    check("lighttpd: порт 8055", "server.port" in active and "8055" in active)
    check("lighttpd: document-root", 'server.document-root = "/data/myweb"' in active)
    check("lighttpd: mod_cgi подключён", '"mod_cgi"' in active)
    check("lighttpd: cgi.assign на python3", '".py" => "/opt/bin/python3"' in active)
    check("lighttpd: прокси /luna/", '"/luna/"' in active and "8099" in active)
    check("lighttpd: .py исключён из статики",
          "static-file.exclude-extensions" in active and '".py"' in active)
    check("lighttpd: нет директив connect-timeout/read-timeout вне бэкенда",
          "proxy.connect-timeout" not in active and "proxy.read-timeout" not in active)

    known = (
        "server.", "index-file.", "static-file.", "url.", "accesslog.", "mimetype.",
        "setenv.", "cgi.", "proxy.", "$HTTP",
    )
    unknown = []
    for match in re.finditer(r"^\s*([a-zA-Z][\w.-]*)\s*=", active, re.M):
        key = match.group(1)
        if not key.startswith(known):
            unknown.append(key)
    check("lighttpd: нет неизвестных директив", not unknown, ", ".join(unknown))


def test_init_script():
    path = os.path.join(ROOT, "init.d", "S99mypult")
    text = read(path)
    check("init: shebang /bin/sh", text.startswith("#!/bin/sh"))
    check("init: есть start/stop/reload/status",
          all(("%s)" % cmd) in text for cmd in ("start", "stop", "reload", "status")))
    check("init: проверка конфига перед запуском", "-t -f" in text)
    check("init: не убивает чужие процессы", "killall" not in text)

    sh = shutil.which("sh") or shutil.which("bash")
    if sh:
        proc = subprocess.run([sh, "-n", path], capture_output=True, text=True)
        check("init: sh -n без ошибок", proc.returncode == 0, (proc.stderr or "")[:300])
    else:
        check("init: sh -n без ошибок", True, "sh не найден — пропущено")


def test_python_headers():
    for name in ("speak.py", "media.py", "volume.py", "status.py"):
        path = os.path.join(ROOT, "cgi-bin", name)
        text = read(path)
        check("%s: shebang /opt/bin/python3" % name, text.startswith("#!/opt/bin/python3"))
        check("%s: common подключается через путь скрипта" % name, "sys.path.insert" in text)


def test_version():
    data = json.loads(read(os.path.join(ROOT, "version.json")))
    version = data.get("version") or ""
    check("version.json: semver", bool(re.fullmatch(r"\d+\.\d+\.\d+", version)), version)

    changelog = read(os.path.join(ROOT, "CHANGELOG.md"))
    check("CHANGELOG содержит текущую версию", ("## %s" % version) in changelog,
          "нет заголовка '## %s'" % version)

    html = read(os.path.join(ROOT, "index.html"))
    check("UI показывает версию", 'id="verTag"' in html and "/version.json" in html)

    status = read(os.path.join(ROOT, "cgi-bin", "status.py"))
    check("status.py читает version.json", "version.json" in status)

    init = read(os.path.join(ROOT, "init.d", "S99mypult"))
    check("S99mypult status печатает версию", "version.json" in init)

    install = read(os.path.join(ROOT, "deploy", "install.sh"))
    check("install.sh копирует version.json", "version.json" in install)


def main():
    for test in (
        test_encoding,
        test_html_structure,
        test_js_syntax,
        test_css,
        test_lighttpd_config,
        test_init_script,
        test_python_headers,
        test_version,
    ):
        try:
            test()
        except Exception as exc:  # noqa: BLE001
            check(test.__name__, False, repr(exc))

    failed = [n for n, ok, _ in RESULTS if not ok]
    print("\n%d проверок, %d провалов" % (len(RESULTS), len(failed)))
    for name in failed:
        print("  ✗", name)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
