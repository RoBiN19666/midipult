#!/bin/sh
# Проверка и автоустановка зависимостей пульта на колонке.
# Запускается из deploy/install.sh до копирования файлов.
#
# Переменные:
#   MYPULT_NO_PACKAGES=1 — только проверить, ничего не устанавливать.

set -u

OPKG="/opt/bin/opkg"
LOG="/tmp/mypult.log"
NO_PACKAGES="${MYPULT_NO_PACKAGES:-0}"

say() { echo "[preflight] $*"; }
warn() { echo "[preflight] ВНИМАНИЕ: $*" >&2; }
die() { echo "[preflight] ОШИБКА: $*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "нужен root"
[ -d /opt ] || die "нет /opt — сначала установите Entware"
[ -x "$OPKG" ] || die "нет $OPKG — Entware установлен не полностью"

mkdir -p /data/mypult 2>/dev/null || die "нет доступа к /data"

# MidiPult рассчитан только на Яндекс Станцию Миди (Cucumber).
MODEL=$(tr -d '\000' </proc/device-tree/model 2>/dev/null || true)
case "$MODEL" in
    *Cucumber*|*cucumber*|*Midi*|*midi*) ;;
    *) die "это не Яндекс Станция Миди (model='${MODEL:-неизвестно}'); установка отменена" ;;
esac
say "модель: $MODEL"

# Сколько места на корне (КБ)
free_kb=$(df -k / 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "$free_kb" ] && [ "$free_kb" -lt 20000 ] 2>/dev/null; then
    die "мало места на / (${free_kb} КБ), нужно хотя бы 20 МБ"
fi

missing=""

has_pkg() {
    "$OPKG" list-installed 2>/dev/null | grep -q "^$1 "
}

ensure_pkg() {
    pkg="$1"
    reason="$2"
    if has_pkg "$pkg"; then
        say "пакет $pkg уже есть"
        return 0
    fi
    missing="1"
    if [ "$NO_PACKAGES" = "1" ]; then
        warn "не хватает пакета $pkg ($reason)"
        return 1
    fi
    say "ставлю $pkg ($reason)"
    # opkg может спрашивать подтверждение — отвечаем да
    if ! yes 2>/dev/null | "$OPKG" install "$pkg" >>"$LOG" 2>&1; then
        warn "не удалось поставить $pkg"
        return 1
    fi
    has_pkg "$pkg"
}

# Сначала обновим списки, если чего-то не хватает.
need_any=""
[ -x /opt/bin/python3 ] || need_any="1"
[ -x /opt/sbin/lighttpd ] || need_any="1"
[ -f /opt/lib/lighttpd/mod_cgi.so ] || need_any="1"
[ -f /opt/lib/lighttpd/mod_proxy.so ] || need_any="1"
[ -x /opt/bin/curl ] || need_any="1"

if [ -n "$need_any" ] && [ "$NO_PACKAGES" != "1" ]; then
    say "обновляю списки пакетов"
    "$OPKG" update >>"$LOG" 2>&1 || warn "opkg update не удался, пробую установку из кэша"
fi

# Базовые компоненты
[ -x /opt/bin/python3 ] || ensure_pkg python3 "Python для CGI"
[ -x /opt/sbin/lighttpd ] || ensure_pkg lighttpd "веб-сервер"
[ -f /opt/lib/lighttpd/mod_cgi.so ] || ensure_pkg lighttpd-mod-cgi "CGI"
[ -f /opt/lib/lighttpd/mod_proxy.so ] || ensure_pkg lighttpd-mod-proxy "прокси Luna"
[ -x /opt/bin/curl ] || ensure_pkg curl "HTTP-запросы"

# websocket-client нужен плееру/Glagol
if [ -x /opt/bin/python3 ] && ! /opt/bin/python3 -c 'import websocket' >/dev/null 2>&1; then
    ensure_pkg python3-websocket-client "WebSocket Glagol" || \
        warn "плеер может не работать без python3-websocket-client"
fi

# Не обязательные для запуска, но нужны функциям
command -v amixer >/dev/null 2>&1 || warn "amixer не найден — громкость через Glagol"
command -v wpa_cli >/dev/null 2>&1 || warn "wpa_cli не найден — Wi-Fi недоступен"
[ -x /usr/bin/amixer ] || [ -x /opt/bin/amixer ] || warn "нет amixer в /usr/bin или /opt/bin"

# Финальные жёсткие проверки
[ -x /opt/bin/python3 ] || die "python3 так и не появился"
[ -x /opt/sbin/lighttpd ] || die "lighttpd так и не появился"
[ -f /opt/lib/lighttpd/mod_cgi.so ] || die "нет mod_cgi.so"
[ -f /opt/lib/lighttpd/mod_proxy.so ] || die "нет mod_proxy.so"

# Luna: бинарник должен быть в прошивке
if [ ! -f /data/quazar/luna/bin/luna ]; then
    warn "нет /data/quazar/luna/bin/luna — без Luna не будет дисплея/кольца"
fi

# maind IPC
if ! /opt/bin/python3 -c 'import socket; s=socket.create_connection(("127.0.0.1", 9875), 1); s.close()' 2>/dev/null; then
    warn "IPC 9875 не слушает — TTS может быть недоступен (maind/platformd)"
fi

if [ "$NO_PACKAGES" = "1" ] && [ -n "$missing" ]; then
    die "не хватает пакетов; повторите без MYPULT_NO_PACKAGES=1"
fi

say "проверка пройдена: $(/opt/bin/python3 --version 2>&1), lighttpd $(/opt/sbin/lighttpd -v 2>/dev/null | head -1)"
exit 0
