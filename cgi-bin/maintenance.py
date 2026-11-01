#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Обслуживание: очистка логов/кэша и перезагрузка.

    GET  /cgi-bin/maintenance.py          — размеры
    POST /cgi-bin/maintenance.py {"cleanup":1}
    POST /cgi-bin/maintenance.py {"reboot":"yes"}
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

TARGETS = (
    "/tmp/mypult-lighttpd-error.log",
    "/tmp/mypult.log",
    "/data/mypult/voice.log",
    "/data/mypult/vpn/sing-box.log",
)


def dir_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


def sizes():
    items = []
    for path in TARGETS:
        try:
            items.append({"path": path, "bytes": os.path.getsize(path)})
        except OSError:
            items.append({"path": path, "bytes": 0})
    pycache = 0
    for root in ("/data/myweb/cgi-bin", "/data/mypult"):
        folder = os.path.join(root, "__pycache__")
        if os.path.isdir(folder):
            pycache += dir_size(folder)
    items.append({"path": "__pycache__", "bytes": pycache})
    return items


def cleanup():
    freed = 0
    for path in TARGETS:
        try:
            size = os.path.getsize(path)
            with open(path, "w", encoding="utf-8"):
                pass
            freed += size
        except OSError:
            pass
    for root in ("/data/myweb/cgi-bin", "/data/mypult"):
        folder = os.path.join(root, "__pycache__")
        if os.path.isdir(folder):
            freed += dir_size(folder)
            shutil.rmtree(folder, ignore_errors=True)
    return freed


def boot_info():
    try:
        uptime = float(open("/proc/uptime", encoding="ascii").read().split()[0])
    except (OSError, ValueError):
        uptime = None
    try:
        boot_id = open("/proc/sys/kernel/random/boot_id", encoding="ascii").read().strip()
    except OSError:
        boot_id = None
    return {"uptime": uptime, "boot_id": boot_id}


def schedule_power(action):
    """Запустить reboot/poweroff отдельно: common.ok() завершает CGI."""
    try:
        with open("/data/mypult/power.log", "a", encoding="utf-8") as fh:
            fh.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), action))
    except OSError:
        pass
    command = "sleep 1; exec /sbin/%s -f" % action
    subprocess.Popen(
        ["/bin/sh", "-c", command],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        start_new_session=True,
    )


def main():
    data = common.params()

    if common.truthy(data.get("boot")):
        common.ok(**boot_info())
        return

    if common.truthy(data.get("cleanup")):
        freed = cleanup()
        common.ok(freed=freed, items=sizes())
        return

    if data.get("reboot") == "yes":
        schedule_power("reboot")
        common.ok(reboot=True)
        return

    if data.get("poweroff") == "yes":
        schedule_power("poweroff")
        common.ok(poweroff=True)
        return

    common.ok(items=sizes())


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка maintenance.py: %s" % exc)
        except Exception:
            pass
