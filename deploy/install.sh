#!/bin/sh
#
# install.sh — установка пульта на колонку. Запускать НА КОЛОНКЕ, из каталога,
# куда скопирован проект:
#
#   scp -P 2222 -r mini_app_alice root@STATION:/tmp/mypult-src
#   ssh -p 2222 root@STATION 'sh /tmp/mypult-src/deploy/install.sh'
#
# Скрипт ничего не удаляет: старые файлы копируются в /tmp/mypult-backup-<дата>,
# невалидный конфиг lighttpd откатывается автоматически.

set -u

SRC=$(cd "$(dirname "$0")/.." && pwd)
WEB="/data/myweb"
CONF="/opt/etc/lighttpd/myweb.conf"
INIT="/etc/init.d/S99mypult"
PY="/opt/bin/python3"
LIGHTTPD="/opt/sbin/lighttpd"
STAMP=$(date '+%Y%m%d-%H%M%S')
BACKUP="/tmp/mypult-backup-$STAMP"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "нужен root"
[ -d "$WEB" ] || die "нет каталога $WEB"
[ -f "$SRC/index.html" ] || die "не найден $SRC/index.html"

if [ -f "$SRC/deploy/preflight.sh" ]; then
    say "проверяю зависимости"
    sh "$SRC/deploy/preflight.sh" || die "preflight не пройден"
fi
[ -x "$PY" ] || die "не найден $PY (нужен Entware)"
[ -x "$LIGHTTPD" ] || die "не найден $LIGHTTPD"

say "источник: $SRC"
VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/version.json" 2>/dev/null | head -n 1)
OLD_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$WEB/version.json" 2>/dev/null | head -n 1)
say "версия: ${VERSION:-неизвестна}"
if [ -n "$OLD_VERSION" ] && [ -n "$VERSION" ] && [ "$OLD_VERSION" != "$VERSION" ]; then
    say "обновление: $OLD_VERSION -> $VERSION"
fi

# Часовой пояс панели хранится в /data/mypult/timezone и задаётся
# пользователем через интерфейс. Установщик не навязывает зону.
TZ_FILE="/data/mypult/timezone"
say "резервная копия: $BACKUP"
mkdir -p "$BACKUP" || die "не могу создать $BACKUP"
[ -f "$WEB/index.html" ] && cp -f "$WEB/index.html" "$BACKUP/index.html"
[ -f "$WEB/cgi-bin/glagol.conf" ] && cp -f "$WEB/cgi-bin/glagol.conf" "$BACKUP/glagol.conf"
for f in "$WEB"/cgi-bin/*.py; do
    [ -f "$f" ] && cp -f "$f" "$BACKUP/" 2>/dev/null
done
[ -f "$CONF" ] && cp -f "$CONF" "$BACKUP/myweb.conf"
[ -f "$INIT" ] && cp -f "$INIT" "$BACKUP/S99mypult"

say "копирую фронтенд и CGI"
mkdir -p "$WEB/cgi-bin" || die "не могу создать $WEB/cgi-bin"
cp -f "$SRC/index.html" "$WEB/index.html" || die "не скопировался index.html"
[ -f "$SRC/index.py" ] && cp -f "$SRC/index.py" "$WEB/index.py"
[ -f "$SRC/manifest.json" ] && cp -f "$SRC/manifest.json" "$WEB/manifest.json"
for asset in favicon.ico icon-192.png icon-512.png icon.png icon-circle.png; do
    [ -f "$SRC/$asset" ] && cp -f "$SRC/$asset" "$WEB/$asset"
done
rm -f "$WEB/icon.svg"
[ -f "$SRC/version.json" ] && cp -f "$SRC/version.json" "$WEB/version.json"
for f in "$SRC"/cgi-bin/*.py; do
    cp -f "$f" "$WEB/cgi-bin/" || die "не скопировался $f"
done
# Устаревший CGI звука отклика: удаляем, чтобы не оставался после обновления.
rm -f "$WEB/cgi-bin/soundcfg.py"
[ -f "$SRC/cgi-bin/glagol.conf" ] && [ ! -f "$WEB/cgi-bin/glagol.conf" ] && \
    cp -f "$SRC/cgi-bin/glagol.conf" "$WEB/cgi-bin/glagol.conf"

if [ -f "$SRC/service/voice_daemon.py" ]; then
    say "копирую голосовой демон"
    mkdir -p /data/mypult
    cp -f "$SRC/service/state_daemon.py" /data/mypult/state_daemon.py 2>/dev/null || true
    cp -f "$SRC/service/discovery.py" /data/mypult/discovery.py 2>/dev/null || true
cp -f "$SRC/service/voice_daemon.py" /data/mypult/voice_daemon.py \
        || warn "не скопировался voice_daemon.py"
    chmod 700 /data/mypult 2>/dev/null
    chmod 600 /data/mypult/voice_daemon.py 2>/dev/null
    sed -i 's/\r$//' /data/mypult/voice_daemon.py 2>/dev/null
    sed -i 's/\r$//' /data/mypult/discovery.py 2>/dev/null
fi

if [ -f "$SRC/deploy/uninstall.sh" ]; then
    cp -f "$SRC/deploy/uninstall.sh" /data/mypult/uninstall.sh || \
        warn "не скопировался uninstall.sh"
    chmod 700 /data/mypult/uninstall.sh 2>/dev/null
    sed -i 's/\r$//' /data/mypult/uninstall.sh 2>/dev/null
fi

say "копирую конфиг lighttpd и init-скрипт"
cp -f "$SRC/lighttpd/myweb.conf" "$CONF" || die "не скопировался myweb.conf"

# /etc на прошивке обычно read-only: пробуем /etc/init.d, затем Entware
# (/opt/etc/init.d — его запускает rc.unslung), затем кладём рядом с веб-рутом.
INIT_TARGET="$INIT"
if ! cp -f "$SRC/init.d/S99mypult" "$INIT_TARGET" 2>/dev/null; then
    warn "$INIT не записывается (read-only /etc) — ищу другое место"
    INIT_TARGET=""
    mkdir -p /opt/etc/init.d 2>/dev/null
    if cp -f "$SRC/init.d/S99mypult" /opt/etc/init.d/S99mypult 2>/dev/null; then
        INIT_TARGET="/opt/etc/init.d/S99mypult"
    elif mkdir -p "$WEB/init.d" 2>/dev/null && \
         cp -f "$SRC/init.d/S99mypult" "$WEB/init.d/S99mypult" 2>/dev/null; then
        INIT_TARGET="$WEB/init.d/S99mypult"
    fi
    [ -n "$INIT_TARGET" ] || die "некуда положить S99mypult"
    say "init-скрипт: $INIT_TARGET"
fi
chmod 755 "$INIT_TARGET" || die "chmod для $INIT_TARGET не удался"

if [ -f "$SRC/deploy/autostart.sh" ]; then
    say "настраиваю автозапуск в /etc/init.d"
    sh "$SRC/deploy/autostart.sh" || warn "автозапуск не настроен — см. deploy/autostart.sh"
fi

say "убираю CRLF после копирования с Windows"
for f in "$WEB/index.html" "$WEB/cgi-bin/"*.py "$CONF" "$INIT_TARGET"; do
    [ -f "$f" ] && sed -i 's/\r$//' "$f"
done

say "права на запуск"
chmod 755 "$WEB/cgi-bin/"*.py || die "chmod не удался"

if ! "$PY" -c 'import websocket' >/dev/null 2>&1; then
    say "ставлю python3-websocket-client"
    yes 2>/dev/null | /opt/bin/opkg install python3-websocket-client >>/tmp/mypult.log 2>&1 || \
        warn "не смог поставить python3-websocket-client — плеер будет недоступен"
fi
command -v amixer >/dev/null 2>&1 || warn "amixer не найден — громкость пойдёт через Glagol"

say "проверяю конфиг lighttpd"
if ! "$LIGHTTPD" -t -f "$CONF"; then
    warn "конфиг НЕВАЛИДЕН — восстанавливаю предыдущий"
    [ -f "$BACKUP/myweb.conf" ] && cp -f "$BACKUP/myweb.conf" "$CONF"
    die "исправьте myweb.conf и повторите"
fi

if [ "${FORCE_WEB:-0}" = "1" ]; then
    warn "FORCE_WEB=1: останавливаю все lighttpd"
    killall lighttpd 2>/dev/null
    sleep 1
fi

if [ ! -x "$INIT_TARGET" ]; then
    die "нет исполняемого $INIT_TARGET"
fi

if [ -f /tmp/mypult-lighttpd.pid ]; then
    "$INIT_TARGET" reload
else
    "$INIT_TARGET" start
fi
sleep 2

say "проверка по HTTP"
CODE_INDEX=$(/opt/bin/curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8055/ 2>/dev/null)
echo "  GET /                 -> ${CODE_INDEX:-нет ответа}"
STATUS_JSON=$(/opt/bin/curl -s http://127.0.0.1:8055/cgi-bin/status.py 2>/dev/null)
echo "  GET /cgi-bin/status.py -> $(echo "$STATUS_JSON" | head -c 400)"
echo "  GET speak.py?check=1   -> $(/opt/bin/curl -s 'http://127.0.0.1:8055/cgi-bin/speak.py?check=1' 2>/dev/null | head -c 300)"

if [ "$CODE_INDEX" != "200" ]; then
    warn "индекс не отдался. Логи: /tmp/mypult-lighttpd-error.log и /tmp/mypult.log"
    exit 1
fi

case "$STATUS_JSON" in
    *'"services"'*|*'"luna"'*) : ;;
    *)
        warn "CGI не отвечает — похоже, на 8055 работает старый lighttpd без mod_cgi."
        warn "Повторите установку так:  FORCE_WEB=1 sh $SRC/deploy/install.sh"
        exit 2
        ;;
esac

say "готово. Откройте http://<ip-колонки>:8055/"

if [ "$INIT_TARGET" != "$INIT" ] && [ ! -x /etc/init.d/S99mypult ]; then
    warn "автозапуск установлен в $INIT_TARGET, а не в /etc/init.d (раздел только для чтения)"
    if [ "$INIT_TARGET" = "/opt/etc/init.d/S99mypult" ]; then
        echo "    Entware обычно запускает /opt/etc/init.d/rc.unslung при загрузке —"
        echo "    проверьте: ls -l /opt/etc/init.d/rc.unslung"
    fi
    echo "    Ручной запуск после перезагрузки: $INIT_TARGET start"
fi
