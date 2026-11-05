#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Локальные проверки CGI-скриптов без колонки.

Запускает speak.py как настоящий CGI (stdin + CONTENT_LENGTH) против
подставного IPC-сервера, а media/volume/status — против пустой среды.

    python3 tests/run_cgi_tests.py
"""

from __future__ import annotations

import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
CGI_DIR = os.path.normpath(os.path.join(HERE, "..", "cgi-bin"))
PY = sys.executable

sys.path.insert(0, CGI_DIR)
import speak  # noqa: E402

RESULTS = []


def check(name, condition, detail=""):
    RESULTS.append((name, bool(condition), detail))
    mark = "PASS" if condition else "FAIL"
    print("[%s] %s%s" % (mark, name, ("  — " + detail) if detail and not condition else ""))


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def recv_exact(conn, size):
    buf = bytearray()
    while len(buf) < size:
        chunk = conn.recv(size - len(buf))
        if not chunk:
            raise ConnectionError("closed")
        buf.extend(chunk)
    return bytes(buf)


def run_cgi(script, body=None, query="", env_extra=None, timeout=40):
    env = os.environ.copy()
    env.update({
        "REQUEST_METHOD": "POST" if body is not None else "GET",
        "QUERY_STRING": query,
        "CONTENT_TYPE": "application/json" if body is not None else "",
        "CONTENT_LENGTH": str(len(body) if body else 0),
        "GATEWAY_INTERFACE": "CGI/1.1",
        "SCRIPT_NAME": "/" + script,
        "SERVER_PROTOCOL": "HTTP/1.1",
        "REMOTE_ADDR": "127.0.0.1",
    })
    if env_extra:
        env.update(env_extra)

    proc = subprocess.run(
        [PY, os.path.join(CGI_DIR, script)],
        input=body or b"",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=CGI_DIR,
        env=env,
        timeout=timeout,
    )
    head, _, payload = proc.stdout.partition(b"\r\n\r\n")
    headers = {}
    for line in head.decode("latin-1").split("\r\n"):
        if ":" in line:
            key, value = line.split(":", 1)
            headers[key.strip().lower()] = value.strip()
    status = int(headers.get("status", "500").split()[0])
    try:
        data = json.loads(payload.decode("utf-8")) if payload else {}
    except ValueError:
        data = {"_raw": payload.decode("utf-8", "replace")}
    return status, data, headers, proc.stderr.decode("utf-8", "replace")


# --------------------------------------------------------------------------- #
#  Подставной aliced: принимает кадры, отвечает TTS_STARTED
# --------------------------------------------------------------------------- #

class FakeIPC(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(1)
        self.port = self.sock.getsockname()[1]
        self.frames = []
        self.error = None

    def run(self):
        try:
            conn, _ = self.sock.accept()
            conn.settimeout(6)
            for _ in range(2):
                size = int.from_bytes(recv_exact(conn, 4), "little")
                self.frames.append(recv_exact(conn, size))
            remote = speak.byte_field(18, speak.integer(1, speak.TTS_STARTED))
            envelope = speak.byte_field(252, remote) + speak.integer(253, 3)
            conn.sendall(len(envelope).to_bytes(4, "little") + envelope)
            time.sleep(0.4)
            conn.close()
        except Exception as exc:  # noqa: BLE001
            self.error = exc
        finally:
            try:
                self.sock.close()
            except OSError:
                pass


def test_frames():
    server = FakeIPC()
    server.start()
    text = "Проверка связи"
    body = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
    status, data, headers, err = run_cgi(
        "speak.py", body,
        env_extra={"MYPULT_IPC_PORT": str(server.port)},
    )
    server.join(timeout=5)

    check("speak: HTTP 200 при живом IPC", status == 200, "status=%s err=%s" % (status, err or data))
    check("speak: Content-Type JSON", headers.get("content-type", "").startswith("application/json"))
    check("speak: started=true", data.get("started") is True, str(data))
    check("speak: транспорт tcp", str(data.get("transport", "")).startswith("tcp:"), str(data.get("transport")))

    check("ipc: получено ровно 2 кадра", len(server.frames) == 2, str(len(server.frames)))
    if len(server.frames) == 2:
        sub = speak.fields(server.frames[0])
        req = speak.fields(server.frames[1])
        sub_remote = speak.fields(sub.get(252, b""))
        check("ipc: подписка rpc=20",
              sub_remote.get(20) is not None
              and speak.fields(sub_remote[20]).get(1) == b"AliceCapability",
              str(sub_remote))
        check("ipc: конверт 253=210", sub.get(253) == 210 and req.get(253) == 210)
        inner = speak.fields(speak.fields(req.get(252, b"")).get(8, b""))
        check("ipc: START_VOCALIZE=18", inner.get(1) == 18, str(inner))
        directive = speak.fields(inner.get(13, b""))
        check("ipc: текст в директиве", directive.get(1) == text.encode("utf-8"), str(directive))
        check("ipc: append=1", directive.get(2) == 1)


def test_speak_check_ok():
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]

    def serve():
        try:
            conn, _ = listener.accept()
            time.sleep(0.2)
            conn.close()
        except OSError:
            pass
        finally:
            listener.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()

    status, data, _, _ = run_cgi(
        "speak.py", query="check=1",
        env_extra={"MYPULT_IPC_PORT": str(port)},
    )
    thread.join(timeout=5)
    check("speak?check=1: 200", status == 200, str(data))
    check("speak?check=1: транспорт указан", bool(data.get("transport")), str(data))


def test_speak_closed_port():
    port = free_port()
    status, data, _, _ = run_cgi(
        "speak.py", json.dumps({"text": "привет"}).encode(),
        env_extra={"MYPULT_IPC_PORT": str(port)},
    )
    check("speak: 502 без IPC", status == 502, "status=%s" % status)
    check("speak: есть hint", bool(data.get("hint")), str(data)[:200])
    check("speak: ok=false", data.get("ok") is False)


def test_speak_validation():
    status, data, _, _ = run_cgi("speak.py", b"{}")
    check("speak: 400 на пустой текст", status == 400, str(data))

    long_text = json.dumps({"text": "я" * 2001}, ensure_ascii=False).encode("utf-8")
    status, data, _, _ = run_cgi("speak.py", long_text)
    check("speak: 413 на длинный текст", status == 413, str(data))


def test_media():
    has_ws = False
    try:
        import websocket  # noqa: F401
        has_ws = True
    except Exception:
        has_ws = False

    if has_ws:
        print("[SKIP] media: websocket-client установлен, тест заглушки не применим")
        return

    status, data, _, _ = run_cgi("media.py", json.dumps({"action": "play"}).encode())
    check("media: 501 без websocket-client", status == 501, "status=%s" % status)
    check("media: hint про yse", "python3-websocket-client" in str(data.get("hint", "")), str(data))

    status, data, _, _ = run_cgi("media.py", query="action=list")
    check("media: 501 и на list", status == 501, str(data))


def test_volume():
    status, data, _, _ = run_cgi("volume.py", query="info=1")
    check("volume?info=1: 200", status == 200, str(data)[:200])
    check("volume?info=1: amixer поле", "amixer" in data, str(data)[:200])

    status, data, _, _ = run_cgi("volume.py", json.dumps({"level": 40}).encode())
    check("volume: 501 без микшера", status == 501, "status=%s %s" % (status, str(data)[:160]))
    check("volume: hint alsa-utils", "alsa-utils" in str(data.get("hint", "")), str(data)[:200])


def test_media_fake_ws():
    """media.py целиком: подставной websocket-client + подставной Glagol."""
    stub = WsStub()
    stub.start()
    env = {
        "PYTHONPATH": os.path.join(HERE, "fakews"),
        "MYPULT_GLAGOL": "ws://127.0.0.1:%d" % stub.port,
    }

    status, data, _, err = run_cgi("media.py", json.dumps({"action": "play"}).encode(), env_extra=env)
    check("media(ws): play -> 200", status == 200, "status=%s %s %s" % (status, data, err[:200]))
    check("media(ws): ответ разобран", isinstance(data.get("reply"), dict), str(data.get("reply")))
    check("media(ws): confirmed=true", data.get("confirmed") is True, str(data))
    check("media(ws): отправлен event=play",
          data.get("sent") == {"event": "play"}, str(data.get("sent")))

    status, data2, _, err = run_cgi(
        "media.py", json.dumps({"action": "setVolume", "volume": 37}).encode(), env_extra=env
    )
    check("media(ws): setVolume -> 200", status == 200, str(data2))
    check("media(ws): громкость числом",
          data2.get("sent") == {"event": "setVolume", "volume": 37}, str(data2.get("sent")))
    check("media(ws): Glagol получил 37",
          {"event": "setVolume", "volume": 37} in stub.received, str(stub.received))

    status, data3, _, _ = run_cgi(
        "media.py", json.dumps({"raw": {"event": "stop"}}).encode(), env_extra=env
    )
    check("media(ws): raw кадр отправлен", status == 200 and data3.get("sent") == {"event": "stop"},
          str(data3))

    stub.stop_now()
    stub.join(timeout=3)

    closed = free_port()
    status, data4, _, _ = run_cgi(
        "media.py", json.dumps({"action": "next"}).encode(),
        env_extra={"PYTHONPATH": os.path.join(HERE, "fakews"),
                   "MYPULT_GLAGOL": "ws://127.0.0.1:%d" % closed},
    )
    check("media(ws): 502 если Glagol закрыт", status == 502, "status=%s %s" % (status, str(data4)[:150]))


class WsStub(threading.Thread):
    """Принимает JSON-строки и отвечает эхом (см. tests/fakews/websocket.py)."""

    def __init__(self):
        super().__init__(daemon=True)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(5)
        self.sock.settimeout(0.4)
        self.port = self.sock.getsockname()[1]
        self.received = []
        self._halt = False
        self.error = None

    def stop_now(self):
        self._halt = True
        try:
            self.sock.close()
        except OSError:
            pass

    def run(self):
        while not self._halt:
            try:
                conn, _ = self.sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                conn.settimeout(3)
                data = b""
                while not data.endswith(b"\n"):
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                if not data.strip():
                    continue
                payload = json.loads(data.decode("utf-8").strip())
                self.received.append(payload)
                conn.sendall((json.dumps({"ok": True, "echo": payload}) + "\n").encode("utf-8"))
            except Exception as exc:  # noqa: BLE001
                self.error = exc
            finally:
                try:
                    conn.close()
                except OSError:
                    pass


def test_status():
    status, data, _, _ = run_cgi("status.py")
    check("status: 200", status == 200, str(data))
    services = data.get("services") or {}
    check("status: все ключи", all(k in services for k in ("luna", "glagol", "tts", "amixer", "websocket")),
          str(services))
    check("status: luna bool", isinstance(data.get("luna"), bool))


def test_csrf_guard():
    status, data, _, _ = run_cgi("maintenance.py", query="reboot=yes")
    check("csrf: GET reboot запрещён", status == 405, str(data))
    status, data, _, _ = run_cgi("auth.py", query="disable=1")
    check("csrf: GET disable PIN запрещён", status == 405, str(data))

    body = json.dumps({}).encode("utf-8")
    env = {"REMOTE_ADDR": "192.168.1.50", "HTTP_HOST": "station:8055",
           "HTTP_ORIGIN": "http://evil.example"}
    status, data, _, _ = run_cgi("auth.py", body=body, env_extra=env)
    check("csrf: cross-origin POST запрещён", status == 403, str(data))

    env_ok = {"REMOTE_ADDR": "192.168.1.50", "HTTP_HOST": "station:8055",
              "HTTP_ORIGIN": "http://station:8055"}
    status, data, _, _ = run_cgi("auth.py", body=body, env_extra=env_ok)
    check("csrf: same-origin POST разрешён", status == 200, str(data))


def test_auth_and_luna_guard():
    fd, path = tempfile.mkstemp(prefix="mypult-auth-", suffix=".json")
    os.close(fd)
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"enabled": True, "salt": "s", "pin_hash": "x",
                       "token": "tok"}, fh)
        base = {"REMOTE_ADDR": "192.168.1.50", "HTTP_HOST": "station:8055",
                "MYPULT_AUTH_PATH": path}
        status, data, _, _ = run_cgi("status.py", env_extra=base)
        check("auth: CGI без cookie — 401", status == 401, str(data))

        status, data, _, _ = run_cgi("status.py", env_extra=dict(
            base, HTTP_COOKIE="mypult_token=tok"))
        check("auth: CGI с cookie — 200", status == 200, str(data))

        status, data, _, _ = run_cgi(
            "display.py", query="off=1",
            env_extra=dict(base, HTTP_COOKIE="mypult_token=tok"))
        check("auth: GET display off с cookie — 405", status == 405, str(data))

        status, data, _, _ = run_cgi("luna.py", env_extra=base)
        check("luna: без cookie — 401", status == 401, str(data))
        status, data, _, _ = run_cgi(
            "luna.py", env_extra=dict(base, HTTP_COOKIE="mypult_token=tok"))
        check("luna: с cookie без path — 400", status == 400, str(data))
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def main():
    tests = [
        test_frames,
        test_speak_check_ok,
        test_speak_closed_port,
        test_speak_validation,
        test_media,
        test_media_fake_ws,
        test_volume,
        test_status,
        test_csrf_guard,
        test_auth_and_luna_guard,
    ]
    for test in tests:
        print("\n— %s" % test.__name__)
        try:
            test()
        except Exception as exc:  # noqa: BLE001
            check(test.__name__ + " (исключение)", False, repr(exc))

    failed = [name for name, ok, _ in RESULTS if not ok]
    print("\n%d проверок, %d провалов" % (len(RESULTS), len(failed)))
    if failed:
        for name in failed:
            print("  ✗", name)
        return 1
    print("ВСЁ ЗЕЛЁНОЕ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
