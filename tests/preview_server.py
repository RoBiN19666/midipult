#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Заглушка для локального просмотра интерфейса без колонки.

  python3 tests/preview_server.py [порт]

Отдаёт index.html и отвечает на /luna/* и /cgi-bin/* фиктивными JSON,
чтобы можно было снять скриншот или потыкать кнопки в браузере.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

STATUS = {
    "ok": True,
    "luna": True,
    "glagol": True,
    "services": {"luna": True, "glagol": True, "tts": True, "amixer": True, "websocket": True},
    "detail": {"luna_ms": 4.2, "glagol_ms": 3.1, "tts_transport": "tcp:9875"},
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            body = {}
        path = self.path.split("?")[0]

        if path == "/cgi-bin/status.py":
            self._json(STATUS)
        elif path == "/cgi-bin/speak.py":
            self._json({"ok": True, "started": True, "completed": False, "transport": "tcp:9875"})
        elif path == "/cgi-bin/media.py":
            self._json({"ok": True, "action": body.get("action", "play"), "confirmed": True,
                        "reply": {"ok": True}})
        elif path == "/cgi-bin/volume.py":
            self._json({"ok": True, "level": int(body.get("level", 40)), "method": "amixer",
                        "control": "Master"})
        elif path.startswith("/luna/api/alice/recognize"):
            self._json({"transcript": "Алиса, включи свет в гостиной"})
        elif path.startswith("/luna/"):
            self._json({"ok": True})
        else:
            self._json({"ok": False, "error": "stub: no route"}, 404)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/cgi-bin/status.py":
            return self._json(STATUS)
        if path.endswith(".py") and path.startswith("/cgi-bin/"):
            return self._json({"ok": True, "started": True, "level": 40})
        return super().do_GET()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("preview: http://127.0.0.1:%d/" % port, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
