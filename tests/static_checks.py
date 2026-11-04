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


def test_vpn_toggle():
    html = read(os.path.join(ROOT, "index.html"))
    check("VPN: один тумблер вместо двух кнопок",
          'id="btnVpnToggle"' in html
          and 'id="btnVpnStart"' not in html
          and 'id="btnVpnStop"' not in html)
    check("VPN: подписи состояний и занятости",
          all(text in html for text in ("Включить", "Выключить", "Включаю…", "Выключаю…")))
    check("VPN: подписка, сервер и автозапуск не задеты",
          all(token in html for token in ('id="vpnUrl"', 'id="vpnServer"', 'id="vpnAutostart"')))


def test_custom_select():
    html = read(os.path.join(ROOT, "index.html"))
    check("select: кастомный комбобокс поверх нативного",
          "function enhanceSelects" in html and "dd-btn" in html and "dd-native" in html)
    check("select: доступность и клавиатура",
          all(token in html for token in ("combobox", "listbox", "aria-expanded",
                                          "ArrowDown", "Escape", "Home", "End")))
    check("select: панель рендерится вне карточки",
          "document.body.appendChild(panel)" in html)
    check("select: синхронизация опций и disabled",
          "MutationObserver" in html and "ResizeObserver" in html and "select.disabled" in html)


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
    check("lighttpd: /luna не проксируется напрямую", '"/luna/"' not in active)
    check("luna: отдельный auth-прокси", os.path.isfile(os.path.join(ROOT, "cgi-bin", "luna.py"))
          and "common.require_auth()" in read(os.path.join(ROOT, "cgi-bin", "luna.py")))
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


def test_sound_rows_mobile():
    html = read(os.path.join(ROOT, "index.html"))
    check("звуки: список не даёт горизонтальный скролл",
          "grid-template-columns:minmax(0,1fr)" in html and "overflow-x:hidden" in html)
    check("звуки: карточный вид строк на мобиле",
          ".sound-row{flex-wrap:wrap" in html
          and ".sound-main{flex:1 1 100%" in html
          and ".sound-actions{flex:1 1 100%" in html)
    check("звуки: имя и мета переносятся на мобиле",
          "overflow-wrap:anywhere" in html and "white-space:normal" in html)


def test_ui_polish():
    html = read(os.path.join(ROOT, "index.html"))
    check("мобильный статус-пилл не растягивается",
          ".topbar-right .pill{flex:0 1 auto" in html)
    check("нет tap-highlight на тач-устройствах",
          "-webkit-tap-highlight-color:transparent" in html)
    check("↑↓ в шапке карточки, не absolute",
          ".card-head{display:flex" in html
          and "card.insertBefore(header, head)" in html
          and ".card-move{position:absolute" not in html)
    check("шаблоны сценариев убраны",
          "btnTplMorning" not in html and "applyScenarioTemplate" not in html)
    check("нет мигания вкладки при загрузке",
          '<body class="booting">' in html
          and "body.booting main.grid" in html and "body.booting .tabs" in html
          and "classList.remove('booting')" in html)


def test_control_heights():
    html = read(os.path.join(ROOT, "index.html"))
    check("высоты: обычные контролы 42", "--ctl-h:42px" in html
          and "input[type=\"text\"]{height:var(--ctl-h);padding:0 12px}" in html)
    check("высоты: кнопки в строке с полем — как поле",
          ".row:has(.net-input) .btn" in html and ".row:has(select) .btn" in html)
    check("высоты: чипы и пиллы 30px",
          "height:30px;padding:0 12px;border-radius:var(--r-pill)" in html
          and "height:30px;padding:0 14px;border-radius:var(--r-pill)" in html)
    check("высоты: компактные списки звуков и громкость",
          ".sound-actions .btn{height:30px" in html
          and ".vol-row .btn{height:var(--ctl-h-sm)" in html)
    check("гуттер: без scrollbar-gutter, с компенсацией --sbw",
          "scrollbar-gutter" not in html
          and "padding-left:var(--sbw,0px)" in html
          and "syncScrollbarPad" in html)


def test_display_auto_api():
    html = read(os.path.join(ROOT, "index.html"))
    py = read(os.path.join(ROOT, "cgi-bin", "display.py"))
    check("дисплей: галочка автояркости на вкладке",
          'id="displayAuto"' in html and 'id="displayAutoStatus"' in html
          and "loadDisplayState" in html and "display_auto_brightness" in html)
    check("дисплей: яркость/время считает станция, не браузер",
          "sync_clock" in py and "time.strftime(\"%H:%M\")" in py
          and "display_brightness=load_display_brightness()" in py
          and "autoSyncClock" not in html and "clockPayload" not in html)
    check("дисплей: автояркость дисплея хранится и применяется на станции",
          "display_auto_apply" in py and "display_enabled" in py
          and "DISPLAY_STATE" in py)
    check("дисплей: ручной режим/яркость сегментов не ломают авто",
          "MODE_PATH" in py and "segment_brightness" in py
          and 'load_mode().get("manual")' in py)


def test_button_grids():
    html = read(os.path.join(ROOT, "index.html"))
    check("вкладки: одинаковая ширина и сетка на планшете",
          ".tab{" in html and "width:128px;height:var(--ctl-h-sm)" in html
          and "grid-template-columns:repeat(auto-fit,minmax(104px,1fr))" in html)
    check("обслуживание: сетка равных кнопок",
          'class="row maint-actions"' in html
          and ".maint-actions{display:grid" in html
          and ".maint-actions .btn{width:100%" in html)
    check("дисплей: чипы цветов и режимов — сетка",
          "#presets{display:grid" in html and ".bright-chips{display:grid" in html)
    check("автояркость перенесена в «Дисплей», не в «Обслуживание»",
          html.index('id="presets"') < html.index('id="autoBright"') < html.index('id="h-maint"')
          and "autoBrightStatus" in html
          and "el.autoBright.addEventListener" in html)
    check("аудит рядов: Bluetooth, дни, сценарии, звуки, PIN",
          all(cls in html for cls in (".bt-actions{display:grid", ".sc-days{display:grid",
                                     ".sc-edit-actions", ".sound-top-actions",
                                     ".pin-actions")))
    check("широкие экраны: сетки кнопок с разумным max-width",
          "max-width:940px" in html and "max-width:368px" in html
          and "max-width:556px" in html)
    check("ряды действий: одна высота кнопок",
          ".action-row .btn{height:var(--ctl-h)" in html)
    check("Нейросеть: лишняя кнопка «Голосом» убрана",
          "btnLlmVoice" not in html and "askLlmVoice" not in html)
    check("радио: auto-fit без пустоты, 2 на планшете, узкий плеер",
          "repeat(auto-fit,minmax(130px,1fr))" in html
          and ".radio-controls{max-width:100%" in html
          and "repeat(2,minmax(0,1fr));max-width:400px" in html
          and ".radio-player .btn{flex:0 0 120px}" in html)


def test_p1_guards():
    html = read(os.path.join(ROOT, "index.html"))
    common_py = read(os.path.join(ROOT, "cgi-bin", "common.py"))
    auth_py = read(os.path.join(ROOT, "cgi-bin", "auth.py"))
    display_py = read(os.path.join(ROOT, "cgi-bin", "display.py"))
    voice_py = read(os.path.join(ROOT, "service", "voice_daemon.py"))
    check("P1: cookie SameSite=Strict", "SameSite=Strict" in auth_py)
    check("P1: GET-действия и cross-origin POST запрещены",
          "WRITE_KEYS" in common_py and "same_origin_ok" in common_py
          and "Действие требует POST" in common_py
          and "'X-Requested-With': 'MidiPult'" in html)
    check("P1: Luna через auth-прокси",
          os.path.isfile(os.path.join(ROOT, "cgi-bin", "luna.py"))
          and "require_auth" in read(os.path.join(ROOT, "cgi-bin", "luna.py"))
          and "/cgi-bin/luna.py?path=" in html)
    init = read(os.path.join(ROOT, "init.d", "S99mypult"))
    check("P1: Luna только на localhost",
          "--listen 127.0.0.1:8099" in init and "luna_on_lan" in init)
    check("P1: station-side clock_loop и clock_tick",
          "def clock_loop" in voice_py and "clock_tick" in display_py
          and "clock_loop" in voice_py.split("def main()", 1)[0])
    check("P1: ползунок не сохраняет нулевой рисунок",
          "if changed:" in display_py and "save_state(read_all())" in display_py)


def test_p2_hardening():
    html = read(os.path.join(ROOT, "index.html"))
    light = read(os.path.join(ROOT, "lighttpd", "myweb.conf"))
    index_py = read(os.path.join(ROOT, "index.py"))
    backup_py = read(os.path.join(ROOT, "cgi-bin", "backup.py"))
    diag_py = read(os.path.join(ROOT, "cgi-bin", "diag.py"))
    init = read(os.path.join(ROOT, "init.d", "S99mypult"))
    ignore = read(os.path.join(ROOT, ".gitignore"))
    common_py = read(os.path.join(ROOT, "cgi-bin", "common.py"))
    update_py = read(os.path.join(ROOT, "cgi-bin", "update.py"))
    vpn_py = read(os.path.join(ROOT, "cgi-bin", "vpn.py"))
    check("P2: CSP и anti-clickjacking без дублей",
          "Content-Security-Policy" in light and "X-Frame-Options" in light
          and "frame-ancestors 'none'" in light
          and light.count("Content-Security-Policy") == 1
          and "Content-Security-Policy" not in index_py
          and "X-Frame-Options" not in index_py
          and "X-Frame-Options" not in common_py)
    check("P2: backup включает состояние дисплея",
          '"display": "display.json"' in backup_py
          and '"display_mode": "display_mode.json"' in backup_py)
    check("P2: diag читает glagol.json", "/data/mypult/glagol.json" in diag_py)
    check("P2: socat только на loopback", "bind=127.0.0.1" in init)
    check("P2: runtime display-файлы в .gitignore",
          "display.json" in ignore and "display_mode.json" in ignore)
    check("P2: нет innerHTML с err.message",
          "scList.innerHTML = '<div class=\"seg-note\">сценарии" not in html
          and "note.textContent = 'сценарии: ' + err.message" in html)
    check("P2: ошибки display не показываются успехом",
          "synced === false" in html and "data.display.applied === false" in html)
    check("P2: автояркость не залипает после включения экрана",
          'save_mode(not load_auto()["display_enabled"]' in read(
              os.path.join(ROOT, "cgi-bin", "display.py")))
    check("P3: update только GitHub HTTPS + размер",
          "def asset_guard" in update_py and "ASSET_HOSTS" in update_py
          and "MAX_ARCHIVE" in update_py and 'ASSET_HOSTS = frozenset' in update_py
          and "common.url_guard" in update_py)
    check("P3: sing-box SHA/size/HTTPS",
          "BINARY_HASH" in vpn_py and "MAX_BINARY" in vpn_py
          and "size > MAX_BINARY" in vpn_py
          and "SHA-256 не совпал" in vpn_py)
    check("P3: PIN HTTP warning", 'id="pinInsecure"' in html
          and "location.protocol === 'http:'" in html)
    check("P3: автояркость manual показывает паузу",
          "пауза (ручной режим)" in html and "data.mode || {}" in html)
    check("player: свежий снимок и 3с/10с poll",
          "?player=1" in html and "active ? 3000 : 10000" in html
          and "refreshPlayer(true)" in html
          and '"player" in query' in read(
              os.path.join(ROOT, "service", "state_daemon.py")))


def main():
    for test in (
        test_encoding,
        test_html_structure,
        test_js_syntax,
        test_css,
        test_vpn_toggle,
        test_sound_rows_mobile,
        test_custom_select,
        test_ui_polish,
        test_control_heights,
        test_display_auto_api,
        test_p1_guards,
        test_p2_hardening,
        test_button_grids,
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
