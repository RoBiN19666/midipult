#!/bin/sh
# Создать /etc/init.d/S99mypult, если rootfs read-only.
# Вызывается установщиком; можно запускать вручную.

SHIM="/etc/init.d/S99mypult"
TARGET="/opt/etc/init.d/S99mypult"

[ -x "$TARGET" ] || {
    echo "нет $TARGET — сначала установите пульт" >&2
    exit 1
}

if [ -x "$SHIM" ] && grep -q "$TARGET" "$SHIM" 2>/dev/null; then
    echo "автозапуск уже настроен: $SHIM"
    exit 0
fi

write_shim() {
    cat > "$SHIM" <<'EOF'
#!/bin/sh
# Автозапуск пульта Станции Миди.
[ -x /opt/etc/init.d/S99mypult ] && /opt/etc/init.d/S99mypult start
exit 0
EOF
    chmod 755 "$SHIM"
}

if [ -w /etc/init.d ] 2>/dev/null; then
    write_shim && echo "создан $SHIM" && exit 0
fi

echo "rootfs read-only, пробую remount rw…"
if ! mount -o remount,rw / 2>/dev/null; then
    echo "не удалось remount rw. Создайте вручную:" >&2
    echo "  mount -o remount,rw /" >&2
    echo "  создать $SHIM (вызов $TARGET start)" >&2
    echo "  mount -o remount,ro /" >&2
    exit 1
fi

trap 'mount -o remount,ro / 2>/dev/null' EXIT INT TERM
if write_shim; then
    sync
    echo "создан $SHIM"
    mount -o remount,ro / 2>/dev/null
    trap - EXIT INT TERM
    exit 0
fi

echo "не удалось записать $SHIM" >&2
exit 1
