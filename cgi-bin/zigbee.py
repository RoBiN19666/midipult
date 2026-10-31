#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Zigbee: состояние локальной сети и команды устройствам через Алису.

    GET  /cgi-bin/zigbee.py            — радио, сеть, число записей устройств
    POST /cgi-bin/zigbee.py {"text": "включи лампу"} — команда через Glagol

Важно: у прошивки нет публичного локального API управления Zigbee.
Радио и NCP принадлежат maind (`telink_ncp`), список устройств лежит в
LMDB, а добавление/удаление делает приложение «Яндекс Дом» (режим хаба).
Поэтому здесь — чтение состояния и передача команд Алисе, которая уже
умеет управлять привязанными устройствами по именам.
"""

from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

try:
    import glagol  # noqa: E402
except Exception:  # noqa: BLE001
    glagol = None

ZIGBEE_DIR = "/data/quasar/data/zigbee"
DEVICE_DB = os.path.join(ZIGBEE_DIR, "device.lmdb")
NETWORK = os.path.join(ZIGBEE_DIR, "network.dat")
RE_DEVICE = re.compile(r"iot_zigbee_([0-9A-Fa-f]{8,16})")


def read_bytes(path):
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except OSError:
        return b""


def maind_running():
    code, out, _ = common.run(["/bin/sh", "-c", "ps | grep '[m]aind --platformd'"], timeout=6)
    return code == 0 and bool((out or "").strip())


def devices():
    raw = read_bytes(DEVICE_DB).decode("utf-8", "ignore")
    seen = []
    for match in RE_DEVICE.finditer(raw):
        eui = match.group(1).upper()
        if eui not in seen:
            seen.append(eui)
    return seen


def status():
    found = devices()
    return {
        "ok": True,
        "radio": maind_running(),
        "network": os.path.exists(NETWORK),
        "db": os.path.exists(DEVICE_DB),
        "devices": [{"eui64": item, "short": item[-6:]} for item in found],
        "count": len(found),
        "local_api": False,
        "hint": "Управление и добавление — в приложении «Яндекс Дом»; "
                "команды привязанным устройствам можно отдавать Алисе.",
    }


def main():
    data = common.params()

    text = str(data.get("text") or "").strip()
    if text:
        if glagol is None:
            common.fail(501, "Модуль glagol недоступен")
            return
        if len(text) > 200:
            common.fail(400, "Слишком длинная команда")
            return
        try:
            reply = glagol.send({"command": "sendText", "text": text}, timeout=20)
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "Алиса не ответила: %s" % exc)
            return
        state = (reply or {}).get("state") or {}
        player = state.get("playerState") or {}
        common.ok(sent=True, playing=state.get("playing"),
                  title=player.get("title"),
                  alice=state.get("aliceState"))
        return

    common.respond(200, status())


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка zigbee.py: %s" % exc)
        except Exception:
            pass
