#!/bin/sh
# deploy/mic-tap.sh — включение и выключение перехвата микрофона (vqe_tap.so).
#
#   sh deploy/mic-tap.sh status          что сейчас
#   sh deploy/mic-tap.sh apply [канал]   поставить .so, пропатчить launch.json, смонтировать
#   sh deploy/mic-tap.sh apply all       отдавать все каналы VQE (разведка прошивки)
#   sh deploy/mic-tap.sh mount           только (пере)монтировать — вызывается на загрузке
#   sh deploy/mic-tap.sh remove          размонтировать и убрать автозапуск
#   sh deploy/mic-tap.sh restart         перезапустить quasar (Алиса замолчит на ~10 с)
#
# Канал по умолчанию 6:0 — выход AEC (Yandex VQE): свой звук колонки погашен,
# речь проходит. Именно этот канал слушает YaJavis; на Миди он тоже есть.
# Если на незнакомой прошивке 6:0 пустой — `apply all` покажет реальные каналы
# в файле /tmp/mypult/mic.sock.seen.
#
# Почему bind-mount, а не правка файла: /system только для чтения, а копия
# launch.json переживает обновление прошивки и откатывается одним umount.
#
# Архитектура определяется по самому maind (байт ELF-класса), а не по uname:
# на Миди ядро aarch64, но maind 32-битный (armhf), и .so должен совпадать
# именно с ним.

set -u

PATH=/opt/bin:/usr/bin:/bin:/usr/sbin:/sbin
export PATH

MAIN=/system/vendor/quasar/maind
LAUNCH=/system/vendor/quasar/launch.json
DIR=/data/mypult/mictap
STATE=/data/mypult/mictap.json
CHANNEL_FILE=/data/mypult/mic-channel
SOCK=/tmp/mypult/mic.sock
HERE=$(dirname "$0")
SRC="$HERE/../service/mictap"
[ -d "$SRC" ] || SRC=/data/myweb/service/mictap

DEFAULT_CHANNEL=6:0

log() { printf '%s\n' "$*"; }
die() { printf 'ОШИБКА: %s\n' "$*" >&2; exit 1; }

saved_channel() {
    if [ -f "$CHANNEL_FILE" ]; then
        cat "$CHANNEL_FILE" 2>/dev/null | tr -d ' \n'
    else
        printf '%s' "$DEFAULT_CHANNEL"
    fi
}

elf_class() {
    # 1 = ELFCLASS32 (armhf), 2 = ELFCLASS64 (aarch64); пусто — не ELF.
    [ -f "$1" ] || return 1
    od -An -tu1 -j4 -N1 "$1" 2>/dev/null | tr -d ' \n'
}

so_for_arch() {
    case "$1" in
        1) printf 'vqe_tap-armhf.so' ;;
        2) printf 'vqe_tap-aarch64.so' ;;
        *) return 1 ;;
    esac
}

has_symbol() {
    [ -f "$1" ] || return 1
    grep -q "YandexVqeC_GetOutputChannelData" "$1" 2>/dev/null
}

# Пути Quasar не зашиты намертво: на Станции 2 и после обновления прошивки они
# могут быть другими. Если привычных нет — берём launch.json из командной строки
# запущенного launcher'а, а путь к maind — из самого launch.json.
resolve_paths() {
    if [ -f "$MAIN" ] && [ -f "$LAUNCH" ]; then
        return 0
    fi
    _cand=$(ps w 2>/dev/null | awk '/quasar_launcher2/ {print $NF; exit}')
    case "$_cand" in
        *.json) [ -f "$_cand" ] && LAUNCH="$_cand" ;;
    esac
    [ -f "$LAUNCH" ] || return 1
    _main=$(/opt/bin/python3 - "$LAUNCH" <<'PY'
import json, sys

try:
    with open(sys.argv[1], "r", encoding="utf-8") as fh:
        data = json.load(fh)
except (OSError, ValueError):
    sys.exit(0)
for node in data.get("nodes", []):
    for task in node.get("tasks", []):
        if "--platformd" in (task.get("arg") or []):
            print(task.get("path") or "")
            sys.exit(0)
PY
)
    if [ -n "${_main:-}" ] && [ -f "$_main" ]; then
        MAIN="$_main"
    fi
    [ -f "$MAIN" ]
}

mounted() {
    # stat на прошивке нет, поэтому проверяем по содержимому: копия в $DIR
    # совпадает с системным файлом и содержит наш LD_PRELOAD.
    [ -f "$DIR/launch.json" ] || return 1
    grep -q "LD_PRELOAD=" "$LAUNCH" 2>/dev/null || return 1
    cmp -s "$LAUNCH" "$DIR/launch.json" 2>/dev/null
}

patch_json() {
    # $1 — исходный launch.json, $2 — куда положить пропатченный, $3 — канал.
    [ -f "$SRC/patch_launch.py" ] || die "нет $SRC/patch_launch.py"
    /opt/bin/python3 "$SRC/patch_launch.py" "$1" "$2" "$DIR/vqe_tap.so" "$SOCK" "$3"
}

build_patch() {
    # $1 — канал. Всегда отталкиваемся от системного launch.json (до монтажа
    # он настоящий): так обновление прошивки не потеряется за нашей копией.
    cp -f "$LAUNCH" "$DIR/launch.base.json" || die "не скопировать launch.json"
    patch_json "$DIR/launch.base.json" "$DIR/launch.json" "$1" || die "не пропатчить launch.json"
}

apply() {
    resolve_paths
    channel="${1:-$(saved_channel)}"
    case "$channel" in
        all|ALL|\*) channel=all ;;
        *:*) : ;;
        *) die "канал должен быть kind:index или all" ;;
    esac

    [ -f "$MAIN" ] || die "нет $MAIN"
    has_symbol "$MAIN" || die "в maind нет YandexVqeC_GetOutputChannelData — tap не поддерживается этой прошивкой"

    class=$(elf_class "$MAIN") || die "не удалось прочитать ELF-класс maind"
    so=$(so_for_arch "$class") || die "неизвестная архитектура maind (ELF-класс $class)"
    [ -f "$SRC/$so" ] || die "нет $SRC/$so — соберите его build.sh или обновите пульт"

    mkdir -p "$DIR" || die "не создаётся $DIR"
    cp -f "$SRC/$so" "$DIR/vqe_tap.so" || die "не скопировать .so"
    chmod 644 "$DIR/vqe_tap.so"

    printf '%s' "$channel" >"$CHANNEL_FILE"

    if mounted; then
        # Канал мог измениться: пересобираем копию от базового файла и
        # перемонтируем. Требует перезапуска quasar, о чём скажем ниже.
        build_patch "$channel" || die "не пересобрать launch.json"
        # umount может быть занят (launcher держит файл): тогда монтируем
        # поверх — в Linux это законно, верхний слой и будет нашим.
        umount "$LAUNCH" 2>/dev/null
        mount --bind "$DIR/launch.json" "$LAUNCH" || die "bind-mount не удался"
        log "launch.json перемонтирован (канал $channel)"
    else
        build_patch "$channel" || die "не собрать launch.json"
        umount "$LAUNCH" 2>/dev/null
        mount --bind "$DIR/launch.json" "$LAUNCH" || die "bind-mount не удался"
        mounted || die "mount не подтвердился"
        log "launch.json смонтирован (bind, канал $channel)"
    fi

    # Автозапуск делает S99mypult: /etc на прошивке только для чтения, отдельный
    # S96 туда не положить, а S99 и так стартует после quasar и умеет один раз
    # перезапустить его с уже смонтированным launch.json.
    write_state "on" "$channel"
    log "tap включён: $( [ "$class" = 1 ] && echo armhf || echo aarch64 ), канал $channel, сокет $SOCK"
    log "чтобы maind подхватил LD_PRELOAD: sh $0 restart"
}

mount_only() {
    resolve_paths
    [ -f "$DIR/vqe_tap.so" ] || exit 0
    has_symbol "$MAIN" || exit 0
    mounted && exit 0

    channel=$(saved_channel)
    # Прошивка могла обновить launch.json: если базовый файл отличается от
    # системного — пересобираем патч, иначе монтируем готовый.
    if [ -f "$DIR/launch.base.json" ] && ! cmp -s "$LAUNCH" "$DIR/launch.base.json"; then
        log "mic-tap: launch.json изменился — пересобираю патч"
        build_patch "$channel" || exit 0
    fi
    [ -f "$DIR/launch.json" ] || build_patch "$channel" || exit 0
    mount --bind "$DIR/launch.json" "$LAUNCH" 2>/dev/null
    mounted && log "mic-tap: смонтирован на загрузке (канал $channel)"
}

write_state() {
    /opt/bin/python3 - "$STATE" "$1" "$(elf_class "$MAIN")" "$SOCK" "$2" <<'PY'
import json, os, sys, time

path, enabled, klass, sock, channel = sys.argv[1:6]
data = {
    "enabled": enabled == "on",
    "arch": "armhf" if klass == "1" else "aarch64",
    "channel": channel,
    "socket": sock,
    "updated": time.strftime("%Y-%m-%dT%H:%M:%S"),
}
with open(path + ".tmp", "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False)
    fh.flush()
    os.fsync(fh.fileno())
os.replace(path + ".tmp", path)
PY
}

remove() {
    resolve_paths
    # Снимаем все слои: после нескольких apply их могло накопиться.
    i=0
    while [ "$i" -lt 4 ]; do
        umount "$LAUNCH" 2>/dev/null || break
        i=$((i + 1))
    done
    rm -f "$DIR/launch.json" "$DIR/active"
    write_state "off" "$(saved_channel)"
    log "tap выключен, автозапуск убран (.so оставлен в $DIR)"
    log "Алиса подхватит изменение после перезапуска quasar: sh $0 restart"
}

restart_quasar() {
    [ -x /system/vendor/quasar/run.sh ] || die "нет /system/vendor/quasar/run.sh"
    # pkill на прошивке нет, есть killall. Убиваем и launcher, и сами задачи:
    # launcher не перезапускает уже висящие maind, а нам нужен новый процесс
    # с LD_PRELOAD.
    killall quasar_launcher2 2>/dev/null
    sleep 2
    killall maind 2>/dev/null
    sleep 3
    if pidof maind >/dev/null 2>&1; then
        killall -9 maind 2>/dev/null
        sleep 2
    fi
    sh /system/vendor/quasar/run.sh >/dev/null 2>&1
    i=0
    while [ "$i" -lt 20 ]; do
        sleep 2
        i=$((i + 1))
        pidof maind >/dev/null 2>&1 && break
    done
    if pidof maind >/dev/null 2>&1; then
        log "quasar перезапущен, maind: $(pidof maind)"
    else
        log "ВНИМАНИЕ: maind не поднялся — лог /data/quasar/launcher2.out"
        return 1
    fi
}

status() {
    resolve_paths
    class=$(elf_class "$MAIN" 2>/dev/null)
    so=$(so_for_arch "${class:-}" 2>/dev/null || echo "?")
    log "maind      : $MAIN (ELF-класс ${class:-?}, ожидается $so)"
    log "символ VQE : $(has_symbol "$MAIN" && echo есть || echo НЕТ)"
    log "файл .so   : $( [ -f "$DIR/vqe_tap.so" ] && echo есть || echo нет )"
    log "bind-mount : $(mounted && echo да || echo нет)"
    log "канал      : $(saved_channel)"
    if [ -S "$SOCK" ]; then
        log "сокет      : есть ($SOCK)"
    else
        log "сокет      : нет ($SOCK)"
    fi
    # Живой ли приёмник — по процессу, а не по bind: bind падает и на «занято»,
    # и на оставшемся после падения файле сокета.
    if ps w 2>/dev/null | grep -q "[m]icd.py"; then
        log "приёмник   : работает (micd.py)"
    else
        log "приёмник   : не запущен"
    fi
    [ -f "$STATE" ] && log "состояние  : $(cat "$STATE")"
}

case "${1:-status}" in
    status) status ;;
    apply) apply "${2:-}" ;;
    mount) mount_only ;;
    remove) remove ;;
    restart) restart_quasar ;;
    *) die "использование: $0 {status|apply [канал]|mount|remove|restart}" ;;
esac

exit 0
