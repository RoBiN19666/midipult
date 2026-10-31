#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Проверка состояния сервисов пульта: GET /cgi-bin/status.py.

Отвечает быстро (только connect к портам) и никогда не трогает железо.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

IPC_SOCKETS = (
    "/var/run/aliced.sock",
    "/run/aliced.sock",
    "/var/run/alice.sock",
    "/tmp/aliced.sock",
    "/var/run/aliced/aliced.sock",
    "/data/quazar/aliced/aliced.sock",
    "/data/quazar/luna/aliced.sock",
    "/data/quazar/luna/data/aliced.sock",
)


def ipc_socket_path():
    for path in IPC_SOCKETS:
        if os.path.exists(path):
            return path
    return None


def amixer_path():
    for candidate in ("/opt/bin/amixer", "/usr/bin/amixer", "/bin/amixer"):
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return common.which("amixer")


def read_version():
    """Версия пульта из /data/myweb/version.json (рядом с cgi-bin)."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "version.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data.get("version"), data.get("date")
    except (OSError, ValueError):
        return None, None


def build():
    version, build_date = read_version()
    luna_latency = common.tcp_latency(8099)
    glagol_latency = common.tcp_latency(1961)
    ipc_tcp = common.port_open(common.IPC_PORT, timeout=0.3)
    ipc_socket = ipc_socket_path()
    tts = bool(ipc_tcp or ipc_socket)

    services = {
        "luna": luna_latency is not None,
        "glagol": glagol_latency is not None,
        "tts": tts,
        "amixer": bool(amixer_path()),
        "websocket": common.websocket_available(),
    }

    return {
        "ok": True,
        "version": version,
        "build": build_date,
        "luna": services["luna"],
        "glagol": services["glagol"],
        "services": services,
        "detail": {
            "luna_ms": luna_latency,
            "glagol_ms": glagol_latency,
            "tts_transport": "tcp:%d" % common.IPC_PORT if ipc_tcp else ("unix:%s" % ipc_socket if ipc_socket else None),
            "amixer": amixer_path(),
            "python": sys.version.split()[0],
        },
    }


def main():
    common.respond(200, build())


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:
        try:
            common.fail(500, "Внутренняя ошибка status.py: %s" % exc)
        except Exception:
            pass
