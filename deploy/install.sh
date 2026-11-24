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
STAGE=""
OLD=""

cleanup() {
    if [ -n "$OLD" ] && [ -d "$OLD" ] && [ ! -d "$WEB" ]; then
        mv "$OLD" "$WEB" 2>/dev/null
    fi
    if [ -n "$STAGE" ]; then
        rm -rf "$STAGE" 2>/dev/null
    fi
    return 0
}
trap cleanup EXIT INT TERM

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

say "резервная копия: $BACKUP"
mkdir -p "$BACKUP" || die "не могу создать $BACKUP"
[ -f "$WEB/index.html" ] && cp -f "$WEB/index.html" "$BACKUP/index.html"
[ -f "$WEB/cgi-bin/glagol.conf" ] && cp -f "$WEB/cgi-bin/glagol.conf" "$BACKUP/glagol.conf"
for f in "$WEB"/cgi-bin/*.py; do
    [ -f "$f" ] && cp -f "$f" "$BACKUP/" 2>/dev/null
done
[ -f "$CONF" ] && cp -f "$CONF" "$BACKUP/myweb.conf"
[ -f "$INIT" ] && cp -f "$INIT" "$BACKUP/S99mypult"
# /tmp — tmpfs: полные снимки веб-рута быстро съедают его. Оставляем
# только пять последних резервных копий.
KEEP_BACKUPS=5
BACKUP_INDEX=0
for old_backup in $(ls -1dt /tmp/mypult-backup-* 2>/dev/null); do
    BACKUP_INDEX=$((BACKUP_INDEX + 1))
    if [ "$BACKUP_INDEX" -gt "$KEEP_BACKUPS" ]; then
        rm -rf "$old_backup"
    fi
done
# Полный снимок веб-рута — для ручного отката при потере питания.
if [ -d "$WEB" ]; then
    tar -cf "$BACKUP/myweb.tar" -C "$(dirname "$WEB")" "$(basename "$WEB")" 2>/dev/null || \
        warn "полный бэкап веб-рута не сделан"
fi

say "копирую фронтенд и CGI"
STAGE="${WEB}.new"
OLD="${WEB}.old.$$"
rm -rf "$STAGE" || die "не могу очистить $STAGE"
mkdir -p "$STAGE/cgi-bin" || die "не могу создать $STAGE/cgi-bin"
# Сохраняем файлы, которых нет в архиве (например, glagol.conf с локальными
# переопределениями), чтобы обновление их не потеряло.
if [ -d "$WEB" ]; then
    cp -a "$WEB/." "$STAGE/" 2>/dev/null || warn "не всё скопировалось из $WEB"
fi
cp -f "$SRC/index.html" "$STAGE/index.html" || die "не скопировался index.html"
[ -f "$SRC/index.py" ] && cp -f "$SRC/index.py" "$STAGE/index.py"
[ -f "$SRC/manifest.json" ] && cp -f "$SRC/manifest.json" "$STAGE/manifest.json"
for asset in favicon.ico icon-192.png icon-512.png icon.png icon-circle.png; do
    [ -f "$SRC/$asset" ] && cp -f "$SRC/$asset" "$STAGE/$asset"
done
if [ -d "$SRC/assets" ]; then
    mkdir -p "$STAGE/assets"
    cp -Rf "$SRC/assets/"* "$STAGE/assets/" 2>/dev/null || warn "не скопировались assets"
fi
rm -f "$STAGE/icon.svg"
# Мёртвые ассеты старого FBX-рендера: убираем и из staging, и из живого рута
# после подмены, чтобы не тащить их через обновления.
rm -f "$STAGE/assets/station-midi.fbx" "$STAGE/assets/FBXLoader.js" "$STAGE/assets/fflate.min.js"
[ -f "$SRC/version.json" ] && cp -f "$SRC/version.json" "$STAGE/version.json"
for f in "$SRC"/cgi-bin/*.py; do
    cp -f "$f" "$STAGE/cgi-bin/" || die "не скопировался $f"
done
[ -f "$SRC/cgi-bin/default_layout_presets.json" ] && \
    cp -f "$SRC/cgi-bin/default_layout_presets.json" "$STAGE/cgi-bin/default_layout_presets.json"
chmod 755 "$STAGE"/cgi-bin/*.py 2>/dev/null
if [ -f "$SRC/bin/yt-dlp" ]; then
    mkdir -p /data/mypult/bin
    cp -f "$SRC/bin/yt-dlp" /data/mypult/bin/yt-dlp || warn "не скопировался yt-dlp"
    chmod 755 /data/mypult/bin/yt-dlp 2>/dev/null || true
fi
# ffmpeg нужен YouTube-провайдеру: AAC/M4A штатный плеер не играет,
# поэтому трек перекодируется в локальный MP3.
if [ ! -x /opt/bin/ffmpeg ] && [ -x /opt/bin/opkg ]; then
    say "ставлю ffmpeg для YouTube Music"
    /opt/bin/opkg install ffmpeg >>/tmp/mypult.log 2>&1 || \
        warn "ffmpeg не установился — YouTube Music будет недоступен"
fi
# Устаревший CGI звука отклика: удаляем, чтобы не оставался после обновления.
rm -f "$STAGE/cgi-bin/soundcfg.py"
# YouTube теперь отдаёт HLS напрямую; старый MP3-прокси больше не нужен.
rm -f "$STAGE/cgi-bin/youtube_stream.py"
rm -f "$STAGE/cgi-bin/timezone.py"
# VK-провайдер удалён: VK закрыл публичный audio API. Убираем и CGI, и
# страницы возврата OAuth, чтобы они не оставались от старых версий.
# Токен в /data/mypult/vk_token.json не трогаем: это данные пользователя,
# при желании он удаляется вручную.
rm -f "$STAGE/cgi-bin/vk.py" "$STAGE/cgi-bin/vk_stream.py"
rm -f "$STAGE/vk_oauth.html" "$STAGE/vk_callback.html"
[ -f "$SRC/cgi-bin/glagol.conf" ] && [ ! -f "$STAGE/cgi-bin/glagol.conf" ] && \
    cp -f "$SRC/cgi-bin/glagol.conf" "$STAGE/cgi-bin/glagol.conf"

if [ -f "$SRC/service/voice_daemon.py" ]; then
    say "копирую голосовой демон"
    mkdir -p /data/mypult
    cp -f "$SRC/service/state_daemon.py" /data/mypult/state_daemon.py 2>/dev/null || true
    cp -f "$SRC/service/discovery.py" /data/mypult/discovery.py 2>/dev/null || true
    cp -f "$SRC/service/alarmd.py" /data/mypult/alarmd.py 2>/dev/null || true
    cp -f "$SRC/service/clockanimd.py" /data/mypult/clockanimd.py 2>/dev/null || true
    cp -f "$SRC/service/termd.py" /data/mypult/termd.py 2>/dev/null || true
    chmod 700 /data/mypult/termd.py 2>/dev/null
    chmod 600 /data/mypult/clockanimd.py 2>/dev/null
    sed -i 's/\r$//' /data/mypult/clockanimd.py 2>/dev/null
    chmod 600 /data/mypult/alarmd.py 2>/dev/null
    sed -i 's/\r$//' /data/mypult/alarmd.py 2>/dev/null
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
    elif mkdir -p "$STAGE/init.d" 2>/dev/null && \
         cp -f "$SRC/init.d/S99mypult" "$STAGE/init.d/S99mypult" 2>/dev/null; then
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
for f in "$STAGE/index.html" "$STAGE/cgi-bin/"*.py "$CONF" "$INIT_TARGET"; do
    [ -f "$f" ] && sed -i 's/\r$//' "$f"
done

say "права на запуск"
chmod 755 "$STAGE/cgi-bin/"*.py || die "chmod не удался"

# Атомарная подмена: старый веб-рут уводим в сторону, новый переименовываем
# целиком. Если что-то пойдёт не так, старый возвращается на место.
say "подменяю $WEB целиком"
if [ -d "$WEB" ]; then
    mv "$WEB" "$OLD" || die "не могу отодвинуть старый $WEB"
fi
if ! mv "$STAGE" "$WEB"; then
    [ -d "$OLD" ] && mv "$OLD" "$WEB"
    die "не удалось подменить $WEB — старый возвращён"
fi
STAGE=""
sync
rm -rf "$OLD"
OLD=""

# На части прошивок /data — симлинк на /bkupgrade/data. lighttpd с
# server.follow-symlink = "disable" не идёт по симлинкам и отдаёт 403 на всё,
# если document-root указан через /data: панель «устанавливается», но проверка
# по HTTP падает и self-update откатывается. Пишем в конфиг реальный путь —
# хардening остаётся включённым. На обычной прошивке readlink вернёт тот же
# /data/myweb, и конфиг не меняется.
DOC_REAL=$(readlink -f "$WEB" 2>/dev/null || true)
if [ -n "$DOC_REAL" ] && [ "$DOC_REAL" != "$WEB" ] && [ -d "$DOC_REAL" ]; then
    say "document-root: $WEB -> $DOC_REAL (обход симлинка /data)"
    sed -i "s#^server\.document-root.*#server.document-root = \"$DOC_REAL\"#" "$CONF"
fi

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

# update-status.json — история последней установки. Раньше файл годами хранил
# запись 0.4.46 -> 0.4.47, хотя на колонке уже стояла другая версия.
NOW=$(date +%s)
printf '{"state":"done","from":"%s","to":"%s","message":"Установлено заливкой","error":"","installed":"%s","rolled_back":false,"updated_at":%s,"finished_at":%s}\n' \
    "${OLD_VERSION:-}" "${VERSION:-}" "${VERSION:-}" "$NOW" "$NOW" \
    >/data/mypult/update-status.json 2>/dev/null || \
    warn "не удалось обновить update-status.json"

# Резолвер прошивки (unbound) иногда остаётся лежать: сеть по IP есть, а имён нет.
# Поднимаем его, если :53 никто не слушает. На здоровой колонке это no-op.
port53_listening() {
    awk -v p=":0035" 'index($2, p) > 0 { found = 1 } END { exit !found }' \
        /proc/net/udp /proc/net/udp6 2>/dev/null
}

dns_answers() {
    [ -f "$WEB/cgi-bin/dnsprobe.py" ] || return 1
    "$PY" "$WEB/cgi-bin/dnsprobe.py" >/dev/null 2>&1
}

ensure_unbound() {
    port53_listening && return 0
    if [ ! -x /usr/sbin/unbound ]; then
        warn "unbound не найден — DNS на колонке не поднимется"
        return 0
    fi
    say "unbound не слушает :53 — пробую поднять"
    # unbound слушает и ::1; если IPv6 на loopback выключен, старт падает.
    if [ "$(cat /proc/sys/net/ipv6/conf/lo/disable_ipv6 2>/dev/null)" = "1" ]; then
        echo 0 > /proc/sys/net/ipv6/conf/lo/disable_ipv6 2>/dev/null || true
        sleep 1
    fi
    if [ -x /etc/init.d/S70unbound ]; then
        /etc/init.d/S70unbound restart >>/tmp/mypult.log 2>&1 || true
        sleep 2
        if port53_listening && dns_answers; then
            say "unbound поднят (S70unbound)"
            return 0
        fi
    fi
    kill "$(cat /var/run/unbound.pid 2>/dev/null)" 2>/dev/null || true
    sleep 1
    /usr/sbin/unbound >>/tmp/mypult.log 2>&1 || true
    sleep 2
    if port53_listening && dns_answers; then
        say "unbound поднят и отвечает"
    else
        warn "unbound не отвечает — проверьте /etc/unbound/unbound.conf"
    fi
}

ensure_unbound

say "готово. Откройте http://<ip-колонки>:8055/"

if [ "$INIT_TARGET" != "$INIT" ] && [ ! -x /etc/init.d/S99mypult ]; then
    warn "автозапуск установлен в $INIT_TARGET, а не в /etc/init.d (раздел только для чтения)"
    if [ "$INIT_TARGET" = "/opt/etc/init.d/S99mypult" ]; then
        echo "    Entware обычно запускает /opt/etc/init.d/rc.unslung при загрузке —"
        echo "    проверьте: ls -l /opt/etc/init.d/rc.unslung"
    fi
    echo "    Ручной запуск после перезагрузки: $INIT_TARGET start"
fi
