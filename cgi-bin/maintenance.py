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
import signal
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


def platformd_pid():
    try:
        code, output, _err = common.run(["ps", "w"], timeout=3)
        if code != 0:
            return None
        for line in output.splitlines():
            if "maind" in line and "--platformd" in line:
                fields = line.split()
                if fields and fields[0].isdigit():
                    return int(fields[0])
    except Exception:
        pass
    return None


def reload_sounds():
    pid = platformd_pid()
    if not pid:
        raise RuntimeError("maind --platformd не найден")
    os.kill(pid, signal.SIGTERM)
    # launcher поднимает platformd примерно через 10–15 секунд
    for _ in range(24):
        time.sleep(1)
        current = platformd_pid()
        if current and current != pid:
            return pid, current
    return pid, None


def main():
    data = common.params()

    if common.truthy(data.get("cleanup")):
        freed = cleanup()
        common.ok(freed=freed, items=sizes())
        return

    if data.get("reload_sounds") == "yes":
        old_pid, new_pid = reload_sounds()
        common.ok(reload=True, old_pid=old_pid, new_pid=new_pid)
        return

    if data.get("reboot") == "yes":
        common.ok(reboot=True)
        common.run(["/sbin/sync"], timeout=3)
        common.run(["/sbin/reboot", "-f"], timeout=5)
        return

    if data.get("poweroff") == "yes":
        common.ok(poweroff=True)
        common.run(["/sbin/sync"], timeout=3)
        common.run(["/sbin/poweroff", "-f"], timeout=5)
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
