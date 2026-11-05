#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Резервная копия настроек пульта.

    GET  /cgi-bin/backup.py   — JSON со всеми конфигами
    POST /cgi-bin/backup.py   {"data": {...}} — восстановить

В копию попадают: профили LLM и ключи, VPN-подписка, сценарии, радио,
DNS, яркость кольца, чаты, настройки голоса и автояркости.
Файл содержит секреты — храните его отдельно.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

BASE = "/data/mypult"
FILES = {
    "llm": "llm.json",
    "vpn": "vpn.json",
    "scenarios": "scenarios.json",
    "radio": "radio.json",
    "dns": "dns.json",
    "ring": "ring.json",
    "chats": "chats.json",
    "voice": "voice.json",
    "auto_brightness": "auto_brightness.json",
    "display": "display.json",
    "display_mode": "display_mode.json",
}


def export():
    data = {}
    for key, name in FILES.items():
        path = os.path.join(BASE, name)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data[key] = json.load(fh)
        except (OSError, ValueError):
            continue
    return {"ok": True, "version": 1, "data": data}


def restore(payload):
    if not isinstance(payload, dict):
        raise RuntimeError("нужен объект data")
    written = []
    for key, value in payload.items():
        name = FILES.get(key)
        if name and isinstance(value, (dict, list)):
            path = os.path.join(BASE, name)
            common.write_json(path, value, indent=2)
            written.append(key)
    return written


def main():
    data = common.params()

    if data.get("data") is not None:
        try:
            written = restore(data.get("data"))
        except Exception as exc:  # noqa: BLE001
            common.fail(400, "Восстановление не удалось: %s" % exc)
            return
        common.ok(restored=written)
        return

    common.respond(200, export())


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка backup.py: %s" % exc)
        except Exception:
            pass
