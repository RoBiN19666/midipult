#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Клиент musicd: ленивый старт и локальные вызовы очереди."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import urllib.request

HOST = "127.0.0.1"
PORT = int(os.environ.get("MYPULT_MUSICD_PORT") or "8899")
SCRIPT = "/data/mypult/musicd.py"
URL = "http://%s:%d" % (HOST, PORT)


def _listening():
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((HOST, PORT)) == 0


def ensure(timeout=6.0):
    """Поднять musicd, если он ещё не запущен."""
    if _listening():
        return True
    if not os.path.isfile(SCRIPT):
        raise RuntimeError("нет %s" % SCRIPT)
    log = open("/data/mypult/musicd.out", "ab")
    try:
        subprocess.Popen(
            ["/opt/bin/python3", SCRIPT],
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            start_new_session=True, close_fds=True, cwd="/data/mypult",
        )
    finally:
        log.close()
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _listening():
            return True
        time.sleep(0.2)
    raise RuntimeError("musicd не стартовал")


def call(action, payload=None, timeout=120, retry=True):
    ensure()
    data = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        URL + "/" + action, data=data, method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", "replace")
    except (ConnectionError, OSError):
        if not retry:
            raise
        ensure()
        return call(action, payload, timeout, retry=False)
    return json.loads(body) if body.strip() else {}


def status(timeout=10):
    if not _listening():
        return {"ok": True, "active": False}
    try:
        with urllib.request.urlopen(URL + "/status", timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        return {"ok": True, "active": False}
