#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Bluetooth колонки: сопряжение и подключение как обычной A2DP-колонки.

    GET  /cgi-bin/bluetooth.py             — состояние адаптера и устройства
    POST /cgi-bin/bluetooth.py {"action":"discoverable","on":1}
    POST /cgi-bin/bluetooth.py {"action":"scan"}
    POST /cgi-bin/bluetooth.py {"action":"connect","mac":"AA:BB:..."}
    POST /cgi-bin/bluetooth.py {"action":"disconnect","mac":"AA:BB:..."}
    POST /cgi-bin/bluetooth.py {"action":"remove","mac":"AA:BB:..."}

Звук принимает уже запущенный bluealsad (a2dp-sink), он играет в ALSA
default — тот же тракт, что у Алисы, поэтому микширование не ломается.
"""

from __future__ import annotations

import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

BLUETOOTHCTL = "/usr/bin/bluetoothctl"
RE_MAC = re.compile(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")


def bt(*args, timeout=12):
    code, out, err = common.run([BLUETOOTHCTL] + list(args), timeout=timeout)
    return code, (out or "") + (err or "")


def parse_show():
    _, text = bt("show")
    info = {}
    for line in text.splitlines():
        if line.startswith("Controller "):
            info["Controller"] = line.split(" ", 1)[1].split(" ")[0].strip()
            continue
        if ":" in line:
            key, value = line.split(":", 1)
            if key.strip() in ("Name", "Alias", "Powered", "Discoverable", "Pairable"):
                info[key.strip()] = value.strip()
    return {
        "powered": info.get("Powered") == "yes",
        "discoverable": info.get("Discoverable") == "yes",
        "pairable": info.get("Pairable") == "yes",
        "name": info.get("Name") or info.get("Alias"),
        "address": info.get("Controller"),
    }


def device_info(mac):
    _, text = bt("info", mac)
    data = {"mac": mac, "name": None, "paired": False, "connected": False, "trusted": False}
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("Name:"):
            data["name"] = line.split(":", 1)[1].strip()
        elif line.startswith("Paired:"):
            data["paired"] = line.split(":", 1)[1].strip() == "yes"
        elif line.startswith("Connected:"):
            data["connected"] = line.split(":", 1)[1].strip() == "yes"
        elif line.startswith("Trusted:"):
            data["trusted"] = line.split(":", 1)[1].strip() == "yes"
    return data


def devices():
    _, text = bt("devices")
    result = []
    for line in text.splitlines():
        parts = line.split(" ", 2)
        if len(parts) >= 3 and parts[0] == "Device":
            mac, name = parts[1], parts[2].strip()
            item = device_info(mac)
            item["name"] = item["name"] or name
            result.append(item)
    return result


def wait_connected(mac, seconds=8):
    """bluetoothctl возвращает управление раньше, чем A2DP реально поднялся."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        if device_info(mac)["connected"]:
            return True
        time.sleep(0.7)
    return False


def bluealsa_running():
    code, out, _ = common.run(["/bin/sh", "-c", "ps | grep '[b]luealsa-aplay'"], timeout=6)
    return code == 0 and bool(out.strip())


def status():
    info = parse_show()
    info["ok"] = True
    info["devices"] = sorted(devices(), key=lambda d: (not d["connected"], d["name"] or ""))
    info["audio"] = bluealsa_running()
    return info


def main():
    data = common.params()
    action = (data.get("action") or "").strip()
    mac = (data.get("mac") or "").strip()

    if action == "power":
        bt("power", "on" if common.truthy(data.get("on")) else "off")
        common.respond(200, status())
        return

    if action == "discoverable":
        on = common.truthy(data.get("on"))
        bt("power", "on")
        bt("pairable", "on" if on else "off")
        bt("discoverable", "on" if on else "off")
        common.respond(200, status())
        return

    if action == "scan":
        bt("--timeout", "10", "scan", "on", timeout=20)
        common.respond(200, status())
        return

    if action in ("connect", "disconnect", "remove") and mac:
        if not RE_MAC.match(mac):
            common.fail(400, "Некорректный MAC-адрес")
            return
        if action == "connect":
            bt("trust", mac, timeout=15)
            if not device_info(mac)["paired"]:
                bt("pair", mac, timeout=25)
            bt("connect", mac, timeout=25)
            if not wait_connected(mac):
                bt("connect", mac, timeout=25)
                wait_connected(mac, seconds=5)
        elif action == "disconnect":
            bt("disconnect", mac, timeout=15)
        else:
            bt("remove", mac, timeout=15)
        common.respond(200, status())
        return

    common.respond(200, status())


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка bluetooth.py: %s" % exc)
        except Exception:
            pass
