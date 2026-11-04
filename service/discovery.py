#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""UDP-discovery панели для Android-приложения.

Приложение шлёт broadcast на 255.255.255.255:8056 с текстом
`MYPULT_DISCOVER`; панель отвечает JSON с именем, моделью, версией и IP.
Секретов здесь нет: приложение после ответа всё равно проверяет /version.json.
"""

from __future__ import annotations

import json
import os
import socket
import threading

PORT = 8056
DISCOVER = b"MYPULT_DISCOVER"


def version(paths=("/data/myweb/version.json", "/data/mypult/version.json")):
    for path in paths:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return str(json.load(fh).get("version") or "")
        except (OSError, ValueError, TypeError):
            pass
    return ""


def model():
    try:
        with open("/proc/device-tree/model", "r", encoding="utf-8", errors="replace") as fh:
            return fh.read().replace("\x00", "").strip()
    except OSError:
        return ""


def local_ip():
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("8.8.8.8", 80))
            return probe.getsockname()[0]
        finally:
            probe.close()
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return ""


def payload():
    return {
        "service": "midipult",
        "api": 1,
        "name": socket.gethostname() or "MidiPult",
        "model": model(),
        "version": version(),
        "ip": local_ip(),
        "port": 8055,
    }


def serve():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("0.0.0.0", PORT))
        while True:
            try:
                data, address = sock.recvfrom(512)
            except OSError:
                continue
            if data.strip() != DISCOVER:
                continue
            try:
                body = json.dumps(payload(), ensure_ascii=False).encode("utf-8")
                sock.sendto(body, address)
            except OSError:
                pass
    finally:
        sock.close()


def start():
    thread = threading.Thread(target=serve, name="mypult-discovery", daemon=True)
    thread.start()
    return thread


if __name__ == "__main__":
    start()
    threading.Event().wait()
