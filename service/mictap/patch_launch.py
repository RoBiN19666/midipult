#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Патч launch.json Quasar: LD_PRELOAD и параметры tap-а для `maind --platformd`.

Вынесено из deploy/mic-tap.sh отдельным файлом, чтобы это можно было
проверять тестами (tests/test_units.py) без колонки и без shell.

    python3 patch_launch.py <вход.json> <выход.json> <путь к .so> <сокет> [канал]

Канал: `6:0` — только он (экономит CPU приёмника), `all` или пусто — все
каналы VQE (нужно, чтобы узнать раскладку на незнакомой прошивке).

Правила:
  - меняется только task с аргументом `--platformd`;
  - старые LD_PRELOAD/MYPULT_MIC_* выбрасываются, чужие envs сохраняются;
  - если такого task не ровно один — ошибка, файл не пишется.
"""

from __future__ import annotations

import json
import sys

PREFIXES = ("LD_PRELOAD=", "MYPULT_MIC_")


def patch(data: dict, so_path: str, socket_path: str, channel: str = "6:0") -> dict:
    nodes = data.get("nodes")
    if not isinstance(nodes, list):
        raise ValueError("launch.json без nodes")

    extra = ["LD_PRELOAD=%s" % so_path, "MYPULT_MIC_SOCKET=%s" % socket_path]
    if channel:
        extra.append("MYPULT_MIC_CHANNEL=%s" % channel)

    patched = 0
    for node in nodes:
        tasks = node.get("tasks")
        if not isinstance(tasks, list):
            continue
        for task in tasks:
            args = task.get("arg") or []
            if "--platformd" not in args:
                continue
            envs = [item for item in (task.get("envs") or [])
                    if not str(item).startswith(PREFIXES)]
            envs.extend(extra)
            task["envs"] = envs
            patched += 1

    if patched != 1:
        raise ValueError("ожидался ровно один task --platformd, найдено %d" % patched)
    return data


def main(argv: list[str]) -> int:
    if len(argv) not in (5, 6):
        print("использование: patch_launch.py <in> <out> <so> <socket> [канал|all]",
              file=sys.stderr)
        return 2
    src, dst, so_path, socket_path = argv[1:5]
    channel = argv[5] if len(argv) == 6 else "6:0"
    if channel.strip().lower() in ("all", "*", "-1:-1"):
        channel = ""
    with open(src, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    data = patch(data, so_path, socket_path, channel)
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=4)
        fh.write("\n")
    print("пропатчен task --platformd: %s, канал %s" % (so_path, channel or "все"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
