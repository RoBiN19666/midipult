#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Микрофонный tap: статус, запись WAV, включение и выключение.

    GET  /cgi-bin/mic.py                 — состояние tap-а и каналов
    GET  /cgi-bin/mic.py?wav=mic-…wav    — скачать запись
    POST {"action":"record","seconds":5,"channel":"6:0"}
    POST {"action":"config","channel":"6:0","gain":1.0}
    POST {"action":"apply"}              — поставить .so и смонтировать launch.json
    POST {"action":"remove"}             — выключить
    POST {"action":"restart"}            — перезапустить quasar (Алиса замолчит)

Сам приём звука живёт в service/micd.py на 127.0.0.1:8058: CGI не может
держать unixgram-сокет и кольцевой буфер. Если демон не поднялся, статус
собирается по файлам — панель показывает честное «выключено».
"""

from __future__ import annotations

import http.client
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

DAEMON_PORT = 8058
SOCKET = os.environ.get("MYPULT_MIC_SOCKET") or "/tmp/mypult/mic.sock"
STATE = "/data/mypult/mictap.json"
RECORD_DIR = "/data/mypult/micrec"
DEPLOY = "/data/myweb/deploy/mic-tap.sh"
LOCKED_ACTIONS = ("apply", "remove", "restart")


def daemon(method: str, path: str, payload: dict | None = None, timeout: float = 20.0):
    """Запрос к micd.py; None, если демон недоступен."""
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"X-Requested-With": "MidiPult"}
    cookie = os.environ.get("HTTP_COOKIE")
    if cookie:
        headers["Cookie"] = cookie
    if body is not None:
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = str(len(body))
    connection = http.client.HTTPConnection("127.0.0.1", DAEMON_PORT, timeout=timeout)
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read(200000)
        if response.status != 200:
            return {"ok": False, "error": "micd: %d" % response.status}
        return json.loads(raw.decode("utf-8") or "{}")
    except (OSError, http.client.HTTPException, ValueError):
        return None
    finally:
        connection.close()


def read_state() -> dict:
    try:
        with open(STATE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def seen_channels() -> list:
    rows = []
    try:
        with open(SOCKET + ".seen", "r", encoding="utf-8") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) >= 3 and parts[0] == "channel":
                    rows.append({"kind": int(parts[1]), "index": int(parts[2]),
                                 "frames": int(parts[3] or 0)})
    except (OSError, ValueError):
        pass
    return rows[:32]


def fallback_status() -> dict:
    state = read_state()
    mounted = os.path.exists("/data/mypult/mictap/launch.json")
    return {
        "ok": True,
        "daemon": False,
        "listening": False,
        "mounted": mounted and bool(state.get("enabled")),
        "arch": state.get("arch", ""),
        "socket": SOCKET,
        "seen": seen_channels(),
        "channels": [],
        "selected": "",
        "config": {},
        "record_dir": RECORD_DIR,
        "hint": "micd.py не запущен: звук не принимается (см. /tmp/mypult.log)",
    }


def status() -> dict:
    fresh = daemon("GET", "/status", timeout=4.0)
    if fresh is None:
        return fallback_status()
    fresh["daemon"] = True
    state = read_state()
    fresh["arch"] = state.get("arch", "")
    fresh["installed"] = os.path.exists("/data/mypult/mictap/vqe_tap.so")
    return fresh


def send_wav(name: str) -> None:
    safe = os.path.basename(name)
    path = os.path.join(RECORD_DIR, safe)
    if not safe.endswith(".wav") or not os.path.isfile(path):
        common.fail(404, "Запись не найдена")
        return
    size = os.path.getsize(path)
    head = (
        "Status: 200 OK\r\n"
        "Content-Type: audio/wav\r\n"
        "Content-Disposition: attachment; filename=\"%s\"\r\n"
        "Content-Length: %d\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "Cache-Control: no-store\r\n"
        "\r\n" % (safe, size)
    ).encode("latin-1")
    out = sys.stdout.buffer
    out.write(head)
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(65536)
            if not chunk:
                break
            out.write(chunk)
    out.flush()


def deploy(action: str) -> dict:
    import subprocess

    if not os.path.isfile(DEPLOY):
        return {"ok": False, "error": "нет %s" % DEPLOY}
    try:
        result = subprocess.run(
            ["/bin/sh", DEPLOY, action],
            capture_output=True, timeout=90,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "error": str(exc)[:300]}
    output = (result.stdout + result.stderr).decode("utf-8", "replace").strip()
    return {"ok": result.returncode == 0, "code": result.returncode,
            "output": output[-2000:]}


def main():
    data = common.params()
    if data.get("wav"):
        send_wav(str(data.get("wav")))
        return

    action = str(data.get("action") or "").strip()

    if not action:
        common.respond(200, status())
        return

    if action == "record":
        try:
            seconds = max(1.0, min(30.0, float(data.get("seconds") or 5)))
        except (TypeError, ValueError):
            seconds = 5.0
        result = daemon("POST", "/record",
                        {"seconds": seconds, "channel": str(data.get("channel") or "")},
                        timeout=30.0)
        if result is None:
            common.fail(503, "micd.py не отвечает", hint="проверьте /tmp/mypult.log")
            return
        common.respond(200 if result.get("ok") else 400, result)
        return

    if action == "config":
        payload = {key: data[key] for key in ("channel", "gain") if key in data}
        result = daemon("POST", "/config", payload, timeout=8.0)
        if result is None:
            common.fail(503, "micd.py не отвечает")
            return
        common.respond(200 if result.get("ok") else 400, result)
        return

    if action in LOCKED_ACTIONS:
        # Действия меняют launch.json и перезапускают Алису: только POST,
        # только со своего origin и только после PIN (это делает params()).
        if common._method() != "POST":  # noqa: SLF001 - свой же модуль
            common.fail(405, "Только POST")
            return
        result = deploy(action)
        result["status"] = status()
        common.respond(200 if result.get("ok") else 500, result)
        return

    common.fail(400, "Неизвестное действие", actions=["record", "config", "apply", "remove", "restart"])


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка mic.py: %s" % exc)
        except Exception:  # noqa: BLE001
            pass
