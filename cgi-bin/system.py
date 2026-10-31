#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Ресурсы колонки: CPU, память, температура, датчики, диск.

    GET /cgi-bin/system.py

Всё читается из /proc и /sys, без внешних утилит.
"""

from __future__ import annotations

import glob
import json
import os
import time
import urllib.request

import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402


def read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read().strip()
    except OSError:
        return None


def cpu_usage():
    def snapshot():
        line = read("/proc/stat")
        if not line:
            return None
        parts = [int(value) for value in line.splitlines()[0].split()[1:]]
        idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
        return idle, sum(parts)

    first = snapshot()
    time.sleep(0.25)
    second = snapshot()
    if not first or not second:
        return None
    delta_total = second[1] - first[1]
    delta_idle = second[0] - first[0]
    if delta_total <= 0:
        return None
    return round((1 - delta_idle / delta_total) * 100, 1)


def memory():
    data = {}
    text = read("/proc/meminfo")
    if not text:
        return None
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        try:
            data[key] = int(value.strip().split()[0])
        except (ValueError, IndexError):
            continue
    total = data.get("MemTotal")
    available = data.get("MemAvailable", data.get("MemFree"))
    if not total or available is None:
        return None
    return {
        "total_kb": total,
        "available_kb": available,
        "used_kb": total - available,
        "percent": round((total - available) * 100 / total, 1),
        "swap_total_kb": data.get("SwapTotal", 0),
        "swap_free_kb": data.get("SwapFree", 0),
    }


def temperatures():
    result = []
    for zone in sorted(glob.glob("/sys/class/thermal/thermal_zone*")):
        raw = read(os.path.join(zone, "temp"))
        kind = read(os.path.join(zone, "type")) or os.path.basename(zone)
        if raw is None:
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        if value > 1000:
            value /= 1000.0
        if -40 < value < 150:
            result.append({"name": kind, "c": round(value, 1)})
    if not result:
        for hwmon in sorted(glob.glob("/sys/class/hwmon/hwmon*")):
            for name in ("temp1_input", "temp2_input"):
                raw = read(os.path.join(hwmon, name))
                if raw is None:
                    continue
                try:
                    value = float(raw) / 1000.0
                except ValueError:
                    continue
                label = read(os.path.join(hwmon, "name")) or os.path.basename(hwmon)
                result.append({"name": label, "c": round(value, 1)})
    return result


def light_sensor():
    # На Миди стоит LTR-308ALS; Luna уже читает его через iio и отдаёт lux.
    try:
        with urllib.request.urlopen("http://127.0.0.1:8099/api/sensors", timeout=3) as response:
            sensors = json.loads(response.read().decode("utf-8"))
        for item in sensors:
            if isinstance(item, dict) and item.get("kind") == "ambient_light":
                return {
                    "name": "LTR-308ALS",
                    "value": item.get("value"),
                    "unit": item.get("unit") or "lux",
                }
    except Exception:  # noqa: BLE001
        pass

    for pattern in ("/sys/bus/iio/devices/*/in_illuminance*_input",
                    "/sys/bus/iio/devices/*/in_intensity_input"):
        for path in glob.glob(pattern):
            raw = read(path)
            if raw is None:
                continue
            try:
                return {"name": "iio", "value": float(raw), "unit": "lux"}
            except ValueError:
                continue
    for path in glob.glob("/sys/class/light/*/brightness"):
        raw = read(path)
        if raw is None:
            continue
        try:
            return {"name": "light", "value": float(raw), "unit": "raw"}
        except ValueError:
            continue
    return None


def disk():
    result = []
    if not hasattr(os, "statvfs"):
        return result
    for mount in ("/data", "/"):
        try:
            stats = os.statvfs(mount)
        except OSError:
            continue
        total = stats.f_blocks * stats.f_frsize
        free = stats.f_bavail * stats.f_frsize
        result.append({
            "mount": mount,
            "total_mb": round(total / 1048576),
            "free_mb": round(free / 1048576),
            "percent": round((total - free) * 100 / total, 1) if total else 0,
        })
    return result


def uptime():
    raw = read("/proc/uptime")
    if not raw:
        return None
    try:
        return int(float(raw.split()[0]))
    except (ValueError, IndexError):
        return None


def main():
    load = read("/proc/loadavg")
    temps = temperatures()
    hottest = max(temps, key=lambda item: item["c"]) if temps else None

    common.respond(200, {
        "ok": True,
        "cpu": {
            "percent": cpu_usage(),
            "load": load.split()[:3] if load else None,
            "cores": os.cpu_count(),
        },
        "memory": memory(),
        "temperature": {"all": temps, "hottest": hottest},
        "light": light_sensor(),
        "disk": disk(),
        "uptime_s": uptime(),
        "board": read("/proc/device-tree/model"),
    })


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка system.py: %s" % exc)
        except Exception:
            pass
