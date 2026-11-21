#!/bin/sh
# Сборка vqe_tap.so под обе архитектуры, которые встречаются у Станций.
#
#   ZIG=/path/to/zig sh build.sh
#
# Результат — рядом с исходником:
#   vqe_tap-armhf.so   — 32-битный ARM (Миди/Cucumber: maind там ELFCLASS32)
#   vqe_tap-aarch64.so — 64-битный ARM (Станция 2 и другие на arm64)
#
# glibc пришпилен к 2.28: на Миди Buildroot с более старым loader, чем у
# десктопных сборок, а .so должен грузиться в уже запущенный maind.

set -eu

here=$(dirname "$0")
zig=${ZIG:-zig}
cc_flags="-shared -fPIC -O2 -Wall -Wextra -Wno-unused-parameter"

"$zig" cc -target arm-linux-gnueabihf.2.28 $cc_flags \
    -o "$here/vqe_tap-armhf.so" "$here/vqe_tap.c" -ldl -lpthread

"$zig" cc -target aarch64-linux-gnu.2.28 $cc_flags \
    -o "$here/vqe_tap-aarch64.so" "$here/vqe_tap.c" -ldl -lpthread

ls -l "$here"/vqe_tap-*.so
