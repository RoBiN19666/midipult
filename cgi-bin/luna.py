#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Защищённый прокси к локальной Luna.

Панель больше не ходит напрямую в /luna/: lighttpd этот путь не проксирует,
а CGI проверяет PIN-куку и same-origin, затем пересылает запрос на
127.0.0.1:8099. Прокси только для /api/*; наружу ничего не отдаёт, кроме
ответа Luna.
"""

from __future__ import annotations

import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

LUNA = common.LUNA_BASE


def emit(status, body, content_type="application/json; charset=utf-8"):
    body = body or b""
    headers = (
        "Status: %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %d\r\n"
        "Cache-Control: no-store, max-age=0\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "\r\n"
        % (status, "OK" if status == 200 else "Error", content_type, len(body))
    ).encode("latin-1")
    sys.stdout.buffer.write(headers)
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def main():
    common.require_auth()
    method = (os.environ.get("REQUEST_METHOD") or "GET").upper()
    if method not in ("GET", "POST"):
        emit(405, b'{"ok":false,"error":"method"}')
        return
    if method == "POST" and not common.same_origin_ok():
        emit(403, b'{"ok":false,"error":"cross-origin"}')
        return

    query = urllib.parse.parse_qs(os.environ.get("QUERY_STRING") or "",
                                  keep_blank_values=True)
    path = (query.get("path") or [""])[-1].strip()
    if not path.startswith("/api/") or ".." in path or "\x00" in path:
        emit(400, b'{"ok":false,"error":"bad path"}')
        return

    body = None
    if method == "POST":
        raw = sys.stdin.buffer.read(min(int(os.environ.get("CONTENT_LENGTH") or 0),
                                        8 * 1024 * 1024))
        body = raw if raw else b""

    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(LUNA + path, data=body, method=method,
                                     headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=130) as response:
            data = response.read(8 * 1024 * 1024)
            emit(response.status, data,
                 response.headers.get("Content-Type") or "application/json; charset=utf-8")
    except urllib.error.HTTPError as exc:
        try:
            data = exc.read(8 * 1024 * 1024)
        except OSError:
            data = b""
        emit(exc.code, data,
             exc.headers.get("Content-Type") if exc.headers else "application/json; charset=utf-8")
    except (urllib.error.URLError, OSError) as exc:
        payload = ('{"ok":false,"error":"Luna недоступна"}').encode("utf-8")
        emit(502, payload)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            emit(500, ('{"ok":false,"error":"luna proxy: %s"}' % exc).encode("utf-8"))
        except Exception:
            pass
