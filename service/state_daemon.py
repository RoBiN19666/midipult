#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Постоянный процесс состояния пульта на 127.0.0.1:8057.

lighttpd проксирует /state сюда, поэтому панель получает статус и плеер
без запуска нового Python-процесса на каждый запрос.

Данные обновляются в фоне раз в 2 секунды. Если процесс недоступен,
панель автоматически возвращается к CGI /cgi-bin/state.py.
"""

from __future__ import annotations

import hmac
import json
import os
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, "/data/myweb/cgi-bin")
import common  # noqa: E402
import player  # noqa: E402
import sounds  # noqa: E402
import status  # noqa: E402
import system  # noqa: E402

try:
    import discovery  # noqa: E402
except ImportError:
    discovery = None

PORT = int(os.environ.get("MYPULT_STATE_PORT") or "8057")
LOCK = threading.Lock()
PLAYER_LOCK = threading.Lock()
STATE = {"ok": True, "status": {}, "player": {}}
SYSTEM_STATE = {}
SOUNDS_STATE = {}
PLAYER_STATE = {}
PLAYER_INTERVAL = 10.0


def player_now():
    """Свежий снимок Glagol, не ожидая 10-секундного фонового цикла."""
    with PLAYER_LOCK:
        try:
            return player.snapshot()
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)[:200]}


def cookie_ok(headers):
    config = common.auth_config()
    if not config.get("enabled"):
        return True
    token = str(config.get("token") or "")
    if not token:
        return False
    for part in (headers.get("Cookie") or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == "mypult_token" and hmac.compare_digest(value.strip(), token):
            return True
    return False


def refresh_loop():
    global STATE, PLAYER_STATE
    last_player = 0.0
    while True:
        payload = {"ok": True, "status": {}, "player": {}}
        try:
            payload["status"] = status.build()
        except Exception as exc:  # noqa: BLE001
            payload["status"] = {"ok": False, "error": str(exc)[:200]}
        if time.time() - last_player >= PLAYER_INTERVAL:
            PLAYER_STATE = player_now()
            last_player = time.time()
        payload["player"] = PLAYER_STATE
        with LOCK:
            payload["system"] = SYSTEM_STATE
            payload["sounds"] = SOUNDS_STATE
            STATE = payload
        time.sleep(2)


def system_loop():
    global SYSTEM_STATE
    while True:
        try:
            value = system.snapshot()
        except Exception as exc:  # noqa: BLE001
            value = {"error": str(exc)[:200]}
        with LOCK:
            SYSTEM_STATE = value
        time.sleep(10)


def sounds_loop():
    global SOUNDS_STATE
    while True:
        try:
            value = sounds.snapshot()
        except Exception as exc:  # noqa: BLE001
            value = {"error": str(exc)[:200]}
        with LOCK:
            SOUNDS_STATE = value
        time.sleep(30)


class Handler(BaseHTTPRequestHandler):
    server_version = "mypult-state/1.0"

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in ("/state", "/state/"):
            self.send_error(404)
            return
        if not cookie_ok(self.headers):
            body = b'{"ok":false,"error":"\xd0\x9d\xd1\x83\xd0\xb6\xd0\xb5\xd0\xbd PIN","auth":true}'
            self.send_response(401)
        else:
            query = urllib.parse.parse_qs(parsed.query)
            full = "full" in query
            if "player" in query:
                fresh = player_now()
                with LOCK:
                    PLAYER_STATE = fresh
                    STATE["player"] = fresh
            with LOCK:
                value = STATE if full else {
                    "ok": STATE.get("ok", True),
                    "status": STATE.get("status", {}),
                    "player": STATE.get("player", {}),
                }
                body = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # noqa: D401
        return


def main():
    threading.Thread(target=refresh_loop, daemon=True).start()
    threading.Thread(target=system_loop, daemon=True).start()
    threading.Thread(target=sounds_loop, daemon=True).start()
    if discovery is not None:
        try:
            discovery.start()
        except OSError:
            pass
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
