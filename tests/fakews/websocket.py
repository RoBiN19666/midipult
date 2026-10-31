# -*- coding: utf-8 -*-
"""Минимальная подмена websocket-client для локальных тестов media.py.

Реализует только то, что использует common.glagol_send:
create_connection(url, timeout, enable_multithread), send(), recv(),
settimeout(), close(). Транспорт — строки JSON с переводом строки,
никакого WebSocket-фрейминга: проверяется логика скрипта, не библиотека.
"""

import socket
from urllib.parse import urlparse

__version__ = "0.0-fake"


class WebSocketTimeoutException(Exception):
    pass


class WebSocketConnectionClosedException(Exception):
    pass


class _FakeSocket(object):
    def __init__(self, sock, timeout):
        self._sock = sock
        self._sock.settimeout(timeout)

    def send(self, data):
        self._sock.sendall((str(data) + "\n").encode("utf-8"))

    def settimeout(self, value):
        self._sock.settimeout(value)

    def recv(self):
        buf = b""
        while not buf.endswith(b"\n"):
            try:
                chunk = self._sock.recv(4096)
            except socket.timeout:
                raise WebSocketTimeoutException("timed out")
            if not chunk:
                if not buf:
                    raise WebSocketConnectionClosedException("closed")
                break
            buf += chunk
        return buf.decode("utf-8").rstrip("\r\n")

    def close(self):
        try:
            self._sock.close()
        except OSError:
            pass


def create_connection(url, timeout=3.0, enable_multithread=False):  # noqa: ARG001
    parsed = urlparse(url)
    if parsed.scheme != "ws":
        raise ValueError("fake websocket supports ws:// only")
    sock = socket.create_connection((parsed.hostname, parsed.port or 80), timeout=timeout)
    return _FakeSocket(sock, timeout)
