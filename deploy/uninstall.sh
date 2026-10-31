#!/bin/sh
# Аккуратно удалить MidiPult с колонки, не трогая Luna, YAM и Entware.
#
#   sh deploy/uninstall.sh [--dry-run] [--yes] [--purge]
#
# По умолчанию:
#   - останавливает только процессы пульта (voice/state/lighttpd);
#   - делает бэкап в /data/mypult-uninstall-<дата>;
#   - удаляет /data/myweb, init-скрипты и конфиг lighttpd;
#   - оставляет /data/mypult (ключи, VPN, сценарии) для переустановки.
#
# --purge   удалить и /data/mypult (бэкап всё равно останется);
# --yes     без подтверждения.

set -u

WEB="/data/myweb"
DATA="/data/mypult"
CONF="/opt/etc/lighttpd/myweb.conf"
INIT_OPT="/opt/etc/init.d/S99mypult"
INIT_ETC="/etc/init.d/S99mypult"

PURGE=0
YES=0
DRY=0

for arg in "$@"; do
    case "$arg" in
        --purge) PURGE=1 ;;
        --yes|-y) YES=1 ;;
        --dry-run) DRY=1 ;;
        -h|--help)
            sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) echo "Неизвестный аргумент: $arg" >&2; exit 2 ;;
    esac
done

say() { echo "[uninstall] $*"; }
warn() { echo "[uninstall] ВНИМАНИЕ: $*" >&2; }
die() { echo "[uninstall] ОШИБКА: $*" >&2; exit 1; }
run() {
    if [ "$DRY" = "1" ]; then
        say "dry-run: $*"
    else
        "$@"
    fi
}

[ "$(id -u)" = "0" ] || die "нужен root"
[ -d "$WEB" ] || [ -d "$DATA" ] || die "пульт не найден ($WEB и $DATA отсутствуют)"

STAMP=$(date '+%Y%m%d-%H%M%S')
BACKUP="/data/mypult-uninstall-$STAMP"

say "план:"
say "  остановить voice/state/lighttpd"
say "  бэкап: $BACKUP"
say "  удалить: $WEB, $INIT_OPT, $CONF"
[ -f "$INIT_ETC" ] && say "  удалить: $INIT_ETC"
if [ "$PURGE" = "1" ]; then
    say "  удалить: $DATA (--purge)"
else
    say "  сохранить: $DATA (настройки и ключи)"
fi

if [ "$DRY" != "1" ] && [ "$YES" != "1" ]; then
    printf "Продолжить? [y/N] "
    read answer
    case "$answer" in
        y|Y|yes|YES) ;;
        *) echo "Отменено."; exit 0 ;;
    esac
fi

stop_pidfile() {
    file="$1"
    [ -f "$file" ] || return 0
    pid=$(cat "$file" 2>/dev/null)
    [ -n "$pid" ] || { rm -f "$file"; return 0; }
    if kill -0 "$pid" 2>/dev/null; then
        if [ "$DRY" = "1" ]; then
            say "dry-run: kill $pid ($file)"
        else
            kill "$pid" 2>/dev/null
            i=0
            while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 10 ]; do
                sleep 1
                i=$((i + 1))
            done
            kill -9 "$pid" 2>/dev/null
        fi
    fi
    run rm -f "$file"
}

say "останавливаю процессы пульта"
stop_pidfile "$DATA/voice.pid"
stop_pidfile "/tmp/mypult-state.pid"
stop_pidfile "/tmp/mypult-lighttpd.pid"
if [ "$DRY" != "1" ] && (ps 2>/dev/null | grep -q '[v]oice_daemon.py'); then
    warn "остался voice_daemon.py — проверьте вручную"
fi
run rm -f /tmp/mypult-lighttpd.pid /tmp/mypult-state.pid

backup_dir() {
    src="$1"
    dst="$2"
    [ -d "$src" ] || return 0
    if cp -a "$src" "$dst" 2>/dev/null; then
        return 0
    fi
    if cp -r "$src" "$dst" 2>/dev/null; then
        return 0
    fi
    die "не удалось сохранить $src в $dst — удаление отменено"
}

if [ "$DRY" != "1" ]; then
    say "делаю бэкап в $BACKUP"
    mkdir -p "$BACKUP" || die "не могу создать $BACKUP"
    backup_dir "$WEB" "$BACKUP/myweb"
    backup_dir "$DATA" "$BACKUP/mypult"
    [ -f "$CONF" ] && cp -p "$CONF" "$BACKUP/myweb.conf" 2>/dev/null || true
    [ -f "$INIT_OPT" ] && cp -p "$INIT_OPT" "$BACKUP/S99mypult.opt" 2>/dev/null || true
    [ -f "$INIT_ETC" ] && cp -p "$INIT_ETC" "$BACKUP/S99mypult.etc" 2>/dev/null || true
    chmod 700 "$BACKUP" 2>/dev/null || true
    say "бэкап готов"
fi

remove_etc_init() {
    [ -f "$INIT_ETC" ] || return 0
    if ! grep -q '/opt/etc/init.d/S99mypult' "$INIT_ETC" 2>/dev/null; then
        warn "$INIT_ETC не похож на шим MidiPult — не трогаю"
        return 0
    fi
    if [ "$DRY" = "1" ]; then
        say "dry-run: удалить $INIT_ETC"
        return 0
    fi
    if rm -f "$INIT_ETC" 2>/dev/null; then
        say "удалён $INIT_ETC"
        return 0
    fi
    # rootfs может быть ro
    if mount -o remount,rw / 2>/dev/null; then
        rm -f "$INIT_ETC" && say "удалён $INIT_ETC (rootfs rw)"
        sync
        mount -o remount,ro / 2>/dev/null || warn "не вернул rootfs в ro"
    else
        warn "не удалось удалить $INIT_ETC (rootfs ro)"
    fi
}

say "удаляю автозапуск"
remove_etc_init
if [ -f "$INIT_OPT" ]; then
    if grep -q 'MidiPult\|S99mypult' "$INIT_OPT" 2>/dev/null; then
        run rm -f "$INIT_OPT"
    else
        warn "$INIT_OPT не похож на init MidiPult — не трогаю"
    fi
fi
[ -f "$CONF" ] && run rm -f "$CONF"

say "удаляю файлы пульта"
[ -d "$WEB" ] && run rm -rf "$WEB"
if [ "$PURGE" = "1" ]; then
    [ -d "$DATA" ] && run rm -rf "$DATA"
fi

say "готово."
if [ "$DRY" = "1" ]; then
    say "dry-run: бэкап был бы в $BACKUP; ничего не изменено"
else
    say "бэкап: $BACKUP"
fi
if [ "$PURGE" != "1" ]; then
    say "$DATA сохранён; полное удаление: sh deploy/uninstall.sh --purge"
fi
say "Luna, YAM и Entware не тронуты. Перезагрузка не требуется."
