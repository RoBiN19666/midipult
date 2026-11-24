#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Интерактивный терминал колонки: WebSocket + PTY.

Слушает 127.0.0.1:8898; lighttpd проксирует /term (с Upgrade). Одна сессия
на соединение, PTY с /bin/sh -i, авто-закрытие после 15 минут простоя.
Требует включённый PIN: без него root-терминал был бы доступен всей сети.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import pty
import select
import signal
import socket
import struct
import sys
import threading
import time
import fcntl
import termios
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8898
AUTH_PATH = "/data/mypult/auth.json"
LOG_PATH = "/data/mypult/termd.log"
IDLE_TIMEOUT = 15 * 60
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
ENV = {
    "PATH": "/opt/sbin:/opt/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "HOME": "/data/mypult",
    "TERM": "xterm-256color",
    "LANG": "C.UTF-8",
}


def log(message):
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), message))
        os.chmod(LOG_PATH, 0o600)
    except OSError:
        pass


def auth_config():
    try:
        with open(AUTH_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def cookie_token(header):
    for part in str(header or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == "mypult_token":
            return value.strip()
    return ""


def authorized(handler):
    config = auth_config()
    if not config.get("enabled"):
        return False, "PIN не включён — терминал отключён"
    token = str(config.get("token") or "")
    if not token:
        return False, "нет токена авторизации"
    cookie = cookie_token(handler.headers.get("Cookie"))
    if not hmac.compare_digest(cookie, token):
        return False, "нужен вход по PIN"
    origin = str(handler.headers.get("Origin") or "")
    if origin:
        host = str(handler.headers.get("Host") or "")
        if origin.split("//", 1)[-1] != host:
            return False, "чужой Origin"
    return True, ""


class WS:
    """Минимальный серверный WebSocket: текстовые кадры, ping/pong, close."""

    def __init__(self, sock):
        self.sock = sock

    def send(self, opcode, payload=b""):
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        header = bytearray([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header.append(length)
        elif length < 65536:
            header.append(126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(127)
            header.extend(struct.pack("!Q", length))
        self.sock.sendall(bytes(header) + payload)

    def _read(self, size):
        data = b""
        while len(data) < size:
            chunk = self.sock.recv(size - len(data))
            if not chunk:
                raise ConnectionError("closed")
            data += chunk
        return data

    def recv(self):
        first = self._read(2)
        opcode = first[0] & 0x0F
        masked = bool(first[1] & 0x80)
        length = first[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._read(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._read(8))[0]
        mask = self._read(4) if masked else b""
        payload = self._read(length) if length else b""
        if masked:
            payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        return opcode, payload


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _reject(self, code, message):
        body = message.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.path.startswith("/term"):
            self._reject(404, "not found")
            return
        ok, reason = authorized(self)
        if not ok:
            self._reject(403, reason)
            return
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self._reject(400, "websocket only")
            return
        accept = base64.b64encode(
            hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.close_connection = True
        self._session()

    def _session(self):
        ws = WS(self.connection)
        pid, fd = pty.fork()
        if pid == 0:  # child
            try:
                os.chdir("/data/mypult")
                os.execve("/bin/sh", ["/bin/sh", "-i"], ENV)
            finally:
                os._exit(1)
        fcntl.fcntl(fd, fcntl.F_SETFL, os.O_NONBLOCK)
        decoder = __import__("codecs").getincrementaldecoder("utf-8")("replace")
        last = time.time()
        log("сессия PTY pid=%d" % pid)
        try:
            while True:
                try:
                    ready, _, _ = select.select([self.connection, fd], [], [], 5)
                except (OSError, ValueError):
                    break
                if time.time() - last > IDLE_TIMEOUT:
                    ws.send(0x1, "\r\n[сессия закрыта по простою]\r\n")
                    break
                if self.connection in ready:
                    try:
                        opcode, payload = ws.recv()
                    except (ConnectionError, OSError):
                        break
                    if opcode == 0x8:
                        break
                    if opcode == 0x9:
                        ws.send(0xA, payload)
                        continue
                    if opcode not in (0x1, 0x2):
                        continue
                    last = time.time()
                    try:
                        message = json.loads(payload.decode("utf-8", "replace"))
                    except ValueError:
                        continue
                    kind = message.get("type")
                    if kind == "input":
                        data = str(message.get("data") or "")
                        if data:
                            os.write(fd, data.encode("utf-8"))
                    elif kind == "resize":
                        cols = max(20, min(300, int(message.get("cols") or 80)))
                        rows = max(5, min(120, int(message.get("rows") or 24)))
                        fcntl.ioctl(fd, termios.TIOCSWINSZ,
                                    struct.pack("HHHH", rows, cols, 0, 0))
                    elif kind == "close":
                        break
                if fd in ready:
                    try:
                        chunk = os.read(fd, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    last = time.time()
                    text = decoder.decode(chunk)
                    if text:
                        ws.send(0x1, text)
        finally:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
            try:
                os.waitpid(pid, os.WNOHANG)
            except OSError:
                pass
            try:
                os.close(fd)
            except OSError:
                pass
            try:
                ws.send(0x8, b"")
            except OSError:
                pass
            log("сессия PTY pid=%d закрыта" % pid)


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    log("termd на %s:%d" % (HOST, PORT))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
