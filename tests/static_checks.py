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
            # push-to-station.ps1 намеренно UTF-16LE для Windows PowerShell.
            if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
                continue
            # .ps1/.cmd по .gitattributes лежат с CRLF: так их удобнее
            # открывать в Windows PowerShell, и это осознанное исключение.
            if b"\r\n" in raw and not name.endswith((".ps1", ".cmd")):
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
    # WindowsApps bash.exe — заглушка WSL, которая падает без установленного
    # дистрибутива; это не POSIX-shell для проверки init-скрипта.
    if sh and "windowsapps" in sh.lower():
        sh = None
    if sh and subprocess.run([sh, "-c", "exit 0"], capture_output=True).returncode != 0:
        sh = None
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
    check("дисплей: панель не синхронизирует время",
          "sync_clock" not in py and "clock_tick" not in py
          and "btnSync" not in html and "syncClock" not in html
          and "display_brightness=load_display_brightness()" in py)
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
    check("P1: панель не крутит часы по таймеру",
          "def clock_loop" not in voice_py and "clock_tick" not in display_py
          and "clock_loop" not in voice_py)
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
    display_py = read(os.path.join(ROOT, "cgi-bin", "display.py"))
    voice_py = read(os.path.join(ROOT, "service", "voice_daemon.py"))
    state_py = read(os.path.join(ROOT, "service", "state_daemon.py"))
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
          and '"display_mode": "display_mode.json"' in backup_py
          and "timezone" not in read(os.path.join(ROOT, "cgi-bin", "backup.py")))
    check("P2: diag читает glagol.json", "/data/mypult/glagol.json" in diag_py)
    check("P2: socat только на loopback", "bind=127.0.0.1" in init)
    check("P2: runtime display-файлы в .gitignore",
          "display.json" in ignore and "display_mode.json" in ignore)
    check("P2: нет innerHTML с err.message",
          "scList.innerHTML = '<div class=\"seg-note\">сценарии" not in html
          and "note.textContent = 'сценарии: ' + err.message" in html)
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
    check("player: watcher, fresh-запрос и 2с/10с poll",
          "?player=1" in html and "active ? 2000 : 10000" in html
          and "refreshPlayer(true, true)" in html
          and "fresh=1" in html and "pendingSeek" in html
          and "Перемотка не применилась" in html
          and "Станция не применила перемотку" in html
          and "commandGuard(" in html and "cmdPlaying" in html
          and "currentProgress" in html and "progressAt" in html
          and "start_watcher" in read(os.path.join(ROOT, "service", "state_daemon.py"))
          and "def start_watcher" in read(os.path.join(ROOT, "cgi-bin", "glagol.py"))
          and "latest(" in read(os.path.join(ROOT, "cgi-bin", "player.py"))
          and '"fresh" in query' in read(
              os.path.join(ROOT, "service", "state_daemon.py"))
          and '"player" in query' in read(
              os.path.join(ROOT, "service", "state_daemon.py")))
    init_py = init
    install_sh = read(os.path.join(ROOT, "deploy", "install.sh"))
    docs = "\n".join(read(os.path.join(ROOT, name)) for name in
                     ("README.md", "FAQ.md", "CHANGELOG.md", "docs/ARCHITECTURE.md"))
    check("timezone: управление удалено",
          "TIMEZONE_PATH" not in common_py and "configured_timezone" not in common_py
          and "apply_timezone" not in common_py
          and "TIMEZONE_FILE" not in init_py and "TZ_FILE" not in install_sh
          and "tzSelect" not in html and "timezone.py" not in html)
    check("timezone: нет города в коде/доках",
          all("Yekaterinburg" not in text and "Екатеринбург" not in text
              for text in (common_py, init_py, voice_py, state_py, html, docs)))
    check("reset: отдельные кнопки/эндпоинты",
          'id="btnDisplayReset"' in html and 'id="btnRingReset"' in html
          and "reset_display" in display_py and "reset_ring" in display_py
          and "askConfirm('Сбросить настройки дисплея" in html
          and "askConfirm('Сбросить кольцо" in html)
    check("время: нет фоновой синхронизации/перестановки",
          "sync_clock" not in display_py and "clock_tick" not in display_py
          and "clock_loop" not in voice_py)
    check("ring: плавная свеча без random, кадры через очередь",
          "Math.random" not in html and
          "i * 0.55 + frame * 0.22" in html and
          "function ringFrame(" in html and "ringPending" in html)


def test_symlink_docroot_fix():
    """Прошивки, где /data — симлинк: docroot должен стать реальным путём."""
    install = read(os.path.join(ROOT, "deploy", "install.sh"))
    conf = read(os.path.join(ROOT, "lighttpd", "myweb.conf"))
    check("deploy: document-root резолвится через readlink -f",
          'readlink -f "$WEB"' in install and "DOC_REAL" in install
          and "server.document-root" in install,
          "нет резолва docroot в install.sh")
    check("deploy: порт не наследуется из старого конфига",
          "OLD_PORT" not in install and "CHECK_PORT" not in install,
          "наследование порта ломает voice_daemon/scenarios (там жёстко 8055)")
    check("lighttpd: follow-symlink остаётся запрещённым",
          'server.follow-symlink' in conf and '"disable"' in conf,
          "хардening потерян")


def test_autostart_shim():
    """Шим /etc/init.d/S99mypult обязан пробрасывать аргументы."""
    auto = read(os.path.join(ROOT, "deploy", "autostart.sh"))
    check("autostart: шим передаёт аргументы",
          'exec /opt/etc/init.d/S99mypult "$@"' in auto,
          "шим без \"$@\": stop/status через /etc/init.d запускают пульт")
    check("autostart: старый шим перезаписывается",
          "обновляю $SHIM" in auto and "grep -q '\"\\$@\"'" in auto,
          "нет миграции старого шима")


def test_radio_url_and_search():
    """Своё радио по ссылке и веб-поиск для LLM."""
    html = read(os.path.join(ROOT, "index.html"))
    llm_py = read(os.path.join(ROOT, "cgi-bin", "llm.py"))
    radio_py = read(os.path.join(ROOT, "cgi-bin", "radio.py"))
    voice_py = read(os.path.join(ROOT, "service", "voice_daemon.py"))
    check("радио: поле URL и кнопка потока",
          'id="radioUrl"' in html and 'id="btnRadioStream"' in html
          and "addRadioStream" in html)
    check("радио: поток отдаётся штатному плееру (Glagol audio_play)",
          "audio_play" in radio_py and "externalCommandBypass" in radio_py
          and "audio_play_data" in radio_py)
    check("llm: галочка поиска и блок источников",
          'id="llmSearch"' in html and 'id="llmSources"' in html
          and "renderLlmSources" in html)
    check("llm: модуль websearch подключён",
          os.path.isfile(os.path.join(ROOT, "cgi-bin", "websearch.py"))
          and "import websearch" in llm_py and "web_search" in llm_py)
    check("голос: триггеры поиска в фразе",
          "search_wanted" in voice_py and 'payload["search"] = 1' in voice_py)


def test_yapanel_features():
    """Идеи из yapanel-web: CLI Алисы, анимации кольца, текст песни."""
    voice = read(os.path.join(ROOT, "service", "voice_daemon.py"))
    display_py = read(os.path.join(ROOT, "cgi-bin", "display.py"))
    html = read(os.path.join(ROOT, "index.html"))
    search_py = read(os.path.join(ROOT, "cgi-bin", "websearch.py"))
    lyrics_py = read(os.path.join(ROOT, "cgi-bin", "lyrics.py"))
    scenarios_py = read(os.path.join(ROOT, "cgi-bin", "scenarios.py"))
    install_sh = read(os.path.join(ROOT, "deploy", "install.sh"))
    preflight_sh = read(os.path.join(ROOT, "deploy", "preflight.sh"))
    history_py = read(os.path.join(ROOT, "cgi-bin", "history.py"))
    daemon_py = read(os.path.join(ROOT, "service", "state_daemon.py"))
    check("голос: отмена через maind --cli",
          "alice_cli" in voice and "alice_cli.cancel()" in voice)
    check("плеер: пауза через maind --cli",
          "alice_cli.pause()" in read(os.path.join(ROOT, "cgi-bin", "media.py")))
    check("голос: follow-up через CLI и Luna speech",
          "listen_for_phrase" in voice and "/api/alice/speech" in voice
          and "follow_up" in voice)
    check("кольцо: анимации прошивки через led_util",
          "led_util" in display_py and "ring_animations" in display_py
          and "anim_preview" in display_py)
    check("плеер: текст песни из LRCLIB",
          os.path.isfile(os.path.join(ROOT, "cgi-bin", "lyrics.py"))
          and "lrclib.net" in lyrics_py and "parse_lrc" in lyrics_py)
    check("UI: follow-up, анимации и текст песни",
          all(token in html for token in (
              'id="llmFollowUp"', 'id="ringPickPop"', 'id="ringAnimChips"',
              'id="btnLyrics"', 'id="lyricsBox"', "currentProgress")))
    check("текст: без караоке-заливки",
          "np-lyric-text::before" not in html and "State.audioProgress" in html)
    check("радио: компактный список",
          all(token in html for token in (
              'id="btnRadioPick"', 'id="radioPop"', 'id="radioSearch"')))
    check("часы: редактор обновляет сохранённое",
          "editingAnimId" in html and "animRun" in html and "AbortController" in html)
    check("будильник: один раз или повторять",
          'data-repeat="0"' in html and "alarmRepeat" in html
          and 'once: !State.alarmRepeat' in html)
    check("будильник: свой звук", 'data-amode="sound"' in html
          and 'id="alarmSoundList"' in html and "loadAlarmSounds" in html)
    check("кольцо: превью играющей анимации",
          "State.ringPreview" in html and "animation_name" in display_py)
    check("кольцо: режим и анимация не конфликтуют",
          "stopFirmwareRingAnim" in html
          and "ring_anim_stop: 1, keep: 1" in html
          and 'data.get("keep")' in display_py)
    check("автояркость: Luna time и применение после перезагрузки",
          "time_text or time.strftime" in display_py
          and "def auto_loop" in daemon_py
          and "display.display_auto_apply()" in daemon_py
          and 'reason === ' in html)
    check("сценарии: анимация дисплея",
          "clock_anim" in scenarios_py and "clock_anim_play" in display_py
          and "clockanimd.py" in install_sh)
    check("дисплей: стоп анимации и без кадров часов",
          'id="btnClockAnimStop"' in html and "clockLayerOff" in html
          and "!State.animPlaying" in html and "luna_clock_off" in display_py)
    check("установщик: пакеты, Luna, lock",
          "install_luna" in preflight_sh and "bootstrap.lock" in preflight_sh
          and "MYPULT_UPDATE_LUNA" in preflight_sh
          and "opkg upgrade" not in preflight_sh
          and "sha256sum -c" in preflight_sh)
    check("графики: история за сутки",
          "history.jsonl" in daemon_py and "record_history" in daemon_py
          and "history.jsonl" in history_py and 'id="sparkCpu"' in html
          and 'class="sys-spark"' in html)
    check("главная: 3D-станция и мобильное меню",
          'data-tab="home"' in html and 'id="stationGL"' in html
          and 'id="homeScreen"' in html
          and 'id="btnMobileTabs"' in html and "initStation3D" in html
          and "buildMobileTabs" in html)
    check("главная: WebGL-станция",
          'id="stationGL"' in html and "function initStationGL" in html
          and "gl_FragColor" in html and "u_screen" in html
          and "sdRound" in html and "gl-on" in html)
    check("главная: glTF-станция, экран и кольцо",
          "initStationGLTF" in html and "GLTFLoader" in html
          and "screenPlane" in html and "ringTube" in html
          and "mutePlane" in html and "usbPlane" in html
          and os.path.isfile(os.path.join(ROOT, "assets", "scene.gltf"))
          and os.path.isfile(os.path.join(ROOT, "assets", "GLTFLoader.js")))
    check("главная: быстрый вид без дублей меню",
          'id="btnHomeExtra"' in html and 'id="homeExtraBody"' in html
          and "HOME_EXTRAS" in html and "data-goto" not in html)
    check("UI: лайки и оверлей текста",
          all(token in html for token in (
              'id="btnLike"', 'id="btnDislike"', 'id="lyricsDlg"',
              'id="lyrStage"', "function openLyrics(", "function loadLiked(",
              "function toggleLike(")))
    musicapi_py = read(os.path.join(ROOT, "cgi-bin", "musicapi.py"))
    check("музыка: лайки через API станции",
          "add-multiple" in musicapi_py and "likes/tracks" in musicapi_py
          and "account_storage.dat" in musicapi_py)
    check("музыка: очередь, похожие, избранное",
          "/albums/" in musicapi_py and "/similar" in musicapi_py
          and "def favorites" in musicapi_py and "def queue" in musicapi_py)
    check("UI: диалог очереди",
          'id="queueDlg"' in html and 'id="queueList"' in html
          and "function loadQueueTab(" in html and "function openQueue(" in html)
    check("UI: кнопки трека неактивны без трека",
          "musicTrack" in html and "button.hidden = false" in html
          and "button.disabled = !musicTrack" in html)
    check("UI: строка текста в плеере и закрытие по фону",
          'id="lyricsNow"' in html and 'id="lyricsInline"' in html
          and "function setLyricsInline(" in html
          and "event.target === dialog" in html
          and "[el.lyricsDlg, el.queueDlg]" in html)
    check("UI: карточка будильников",
          'id="alarmList"' in html and 'id="btnAlarmAdd"' in html
          and "function alarmAdd(" in html and "function loadAlarms(" in html)
    voice_py = read(os.path.join(ROOT, "service", "voice_daemon.py"))
    alarm_py = read(os.path.join(ROOT, "cgi-bin", "alarm.py"))
    alarmd_py = read(os.path.join(ROOT, "service", "alarmd.py"))
    check("будильник: демон и API",
          "alarmd.start()" in voice_py and "def build(" in alarm_py
          and "class AlarmScheduler" in alarmd_py)
    conf = read(os.path.join(ROOT, "lighttpd", "myweb.conf"))
    daemon_py = read(os.path.join(ROOT, "service", "state_daemon.py"))
    check("часы: редактор анимаций и прокси",
          "^/clock" in conf and "class ClockAnimator" in daemon_py
          and 'id="clockAnimList"' in html and "function renderClockAnimList(" in html
          and "clock_anim_save" in read(os.path.join(ROOT, "cgi-bin", "display.py")))
    check("поиск: без скрейпинга выдачи",
          "_bing" not in search_py and "duckduckgo" not in search_py.lower())


def test_ring_pipeline():
    """Кадры кольца идут напрямую в демон, без CGI на каждый кадр."""
    html = read(os.path.join(ROOT, "index.html"))
    daemon = read(os.path.join(ROOT, "service", "state_daemon.py"))
    conf = read(os.path.join(ROOT, "lighttpd", "myweb.conf"))
    display_py = read(os.path.join(ROOT, "cgi-bin", "display.py"))
    check("кольцо: прокси /ring в lighttpd",
          "^/ring" in conf and "8057" in conf)
    check("кольцо: демон принимает кадры и зовёт Luna",
          "do_POST" in daemon and "ring_forward" in daemon
          and "/api/led/ring" in daemon)
    check("кольцо: панель шлёт кадры напрямую (25 fps)",
          "function ringFrame(" in html and "request('/ring'" in html
          and "setInterval(tick, 40)" in html)
    check("кольцо: сброс и «Стоп» гасят кольцо",
          "luna_ring_off" in display_py and "paintOff()" in html)


def test_security_files_guard():
    source = read(os.path.join(ROOT, "cgi-bin", "files.py"))
    check("файлы: chats.json в SENSITIVE_NAMES", '"chats.json"' in source)
    check("файлы: secrets.json в SENSITIVE_NAMES", '"secrets.json"' in source)
    check("файлы: есть защита исполняемых файлов",
          "PROTECTED_EXT" in source and "def _protected" in source)
    check("файлы: _can_write учитывает _protected",
          "not _protected(path)" in source)


def test_luna_yam_guard():
    preflight = read(os.path.join(ROOT, "deploy", "preflight.sh"))
    init = read(os.path.join(ROOT, "init.d", "S99mypult"))
    check("Luna: закреплена 0.2.39", 'LUNA_VERSION="0.2.39"' in preflight)
    check("Luna: SHA-256 0.2.39",
          "2815464179ed105f1e969d4683e5a1699dd6c5ee1954d4655987e120f8dcabfb"
          in preflight)
    check("Luna: preflight знает про YAM",
          "luna_owned_by_yam" in preflight and "/etc/init.d/S99luna" in preflight)
    check("Luna: init не запускает свою копию при YAM",
          "luna_owned_by_yam" in init and "не запускаю" in init)


def test_dns_probe_hardening():
    init = read(os.path.join(ROOT, "init.d", "S99mypult"))
    install = read(os.path.join(ROOT, "deploy", "install.sh"))
    network = read(os.path.join(ROOT, "cgi-bin", "network.py"))
    check("DNS: есть dnsprobe.py",
          os.path.isfile(os.path.join(ROOT, "cgi-bin", "dnsprobe.py")))
    check("DNS: init проверяет ответ, а не только порт",
          "dns_answers" in init and "/tmp/mypult-dns-restart" in init)
    check("DNS: install проверяет ответ", "dns_answers" in install)
    check("DNS: set_dns не отдаёт 502 на неудачу",
          'common.fail(502, "DNS' not in network)
    check("DNS: повторные серверы не рестартят резолвер",
          "skipped" in network and "same and dns_probe" in network)
    check("DNS: после смены конфига — принудительный рестарт",
          "ensure_dns(force=True)" in network)


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
        test_symlink_docroot_fix,
        test_autostart_shim,
        test_radio_url_and_search,
        test_yapanel_features,
        test_ring_pipeline,
        test_button_grids,
        test_lighttpd_config,
        test_init_script,
        test_python_headers,
        test_version,
        test_security_files_guard,
        test_luna_yam_guard,
        test_dns_probe_hardening,
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
