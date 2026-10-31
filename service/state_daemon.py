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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, "/data/myweb/cgi-bin")
import common  # noqa: E402
import player  # noqa: E402
import status  # noqa: E402

PORT = int(os.environ.get("MYPULT_STATE_PORT") or "8057")
LOCK = threading.Lock()
STATE = {"ok": True, "status": {}, "player": {}}


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
    global STATE
    while True:
        payload = {"ok": True, "status": {}, "player": {}}
        try:
            payload["status"] = status.build()
        except Exception as exc:  # noqa: BLE001
            payload["status"] = {"ok": False, "error": str(exc)[:200]}
        try:
            payload["player"] = player.snapshot()
        except Exception as exc:  # noqa: BLE001
            payload["player"] = {"error": str(exc)[:200]}
        with LOCK:
            STATE = payload
        time.sleep(2)


class Handler(BaseHTTPRequestHandler):
    server_version = "mypult-state/1.0"

    def do_GET(self):  # noqa: N802
        if self.path.split("?")[0] not in ("/state", "/state/"):
            self.send_error(404)
            return
        if not cookie_ok(self.headers):
            body = b'{"ok":false,"error":"\xd0\x9d\xd1\x83\xd0\xb6\xd0\xb5\xd0\xbd PIN","auth":true}'
            self.send_response(401)
        else:
            with LOCK:
                body = json.dumps(STATE, ensure_ascii=False).encode("utf-8")
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
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
