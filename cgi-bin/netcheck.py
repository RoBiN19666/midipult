#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Проверка сети: шлюз, интернет, DNS, HTTP-задержка.

    GET /cgi-bin/netcheck.py
"""

from __future__ import annotations

import os
import re
import socket
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402


def gateway():
    code, out, _ = common.run(["/sbin/ip", "route"], timeout=6)
    match = re.search(r"default via (\d+\.\d+\.\d+\.\d+)", out or "")
    return match.group(1) if match else None


def ping(host, count=3):
    if not host:
        return {"host": host, "ok": False, "rtt": None}
    code, out, _ = common.run(["/bin/ping", "-c", str(count), "-W", "2", host], timeout=12)
    match = re.search(r"avg[^/]*/([\d.]+)", out or "")
    if not match:
        match = re.search(r"time=([\d.]+)", out or "")
    return {
        "host": host,
        "ok": code == 0,
        "rtt": float(match.group(1)) if match else None,
    }


def http_check(url="https://ya.ru", timeout=12):
    code, out, _ = common.run(
        ["/opt/bin/curl", "-s", "-o", "/dev/null", "-m", str(timeout),
         "-w", "%{http_code} %{time_total}", url], timeout=timeout + 3)
    parts = (out or "").strip().split()
    if len(parts) == 2:
        try:
            return {"url": url, "code": int(parts[0]), "time": float(parts[1])}
        except ValueError:
            pass
    return {"url": url, "code": None, "time": None}


def dns_check():
    started = time.time()
    try:
        socket.getaddrinfo("ya.ru", 443)
        return {"ok": True, "ms": round((time.time() - started) * 1000)}
    except OSError:
        return {"ok": False, "ms": None}


def speed_check():
    url = "https://mirror.yandex.ru/ubuntu/ls-lR.gz"
    code, out, _ = common.run(
        ["/opt/bin/curl", "-s", "-o", "/dev/null", "-m", "25",
         "-r", "0-4999999", "-w", "%{speed_download} %{http_code}", url], timeout=30)
    parts = (out or "").strip().split()
    if len(parts) != 2:
        return {"url": url, "mbps": None, "code": None}
    try:
        return {"url": url, "mbps": round(float(parts[0]) * 8 / 1e6, 1),
                "code": int(parts[1])}
    except ValueError:
        return {"url": url, "mbps": None, "code": None}


def main():
    data = common.params()

    if common.truthy(data.get("speed")):
        common.ok(speed=speed_check())
        return

    gw = gateway()
    common.ok(
        gateway=ping(gw, 3),
        internet=ping("1.1.1.1", 3),
        dns=dns_check(),
        http=http_check(),
    )


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка netcheck.py: %s" % exc)
        except Exception:
            pass
