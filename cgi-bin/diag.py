#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Самодиагностика пульта: что на самом деле отвечают Luna, Glagol и IPC.

    GET /cgi-bin/diag.py            — безопасные пробы
    GET /cgi-bin/diag.py?voice=1    — плюс реальная команда Алисе (она ответит)

Отдаёт JSON: коды, заголовки (включая Allow у 405), тела ответов, кто слушает
порты, какие процессы запущены, время колонки. Ничего не меняет, кроме
пробных запросов /api/clock* — их результат виден на дисплее.
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import ssl
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

PORTS = (8055, 8099, 9875, 1961)
PROCESS_KEYS = ("luna", "glagol", "aliced", "alice_light", "lighttpd", "mypult")


# --------------------------------------------------------------------------- #
#  HTTP-пробы
# --------------------------------------------------------------------------- #

def http_probe(port: int, method: str, path: str, payload=None, timeout: float = 6.0):
    started = time.monotonic()
    headers = {"Accept": "*/*", "Host": "127.0.0.1:%d" % port}
    body = None
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"

    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        raw = resp.read(4096)
        text = raw.decode("utf-8", "replace")
        interesting = {}
        for key, value in resp.getheaders():
            low = key.lower()
            if low in ("content-type", "allow", "server", "content-length"):
                interesting[low] = value
        return {
            "method": method,
            "path": path,
            "status": resp.status,
            "reason": resp.reason,
            "headers": interesting,
            "body": text[:600],
            "ms": int((time.monotonic() - started) * 1000),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "method": method,
            "path": path,
            "error": "%s: %s" % (type(exc).__name__, exc),
            "ms": int((time.monotonic() - started) * 1000),
        }
    finally:
        conn.close()


def luna_probes(voice: bool):
    now = time.strftime("%H:%M")
    probes = [
        ("GET", "/api/clock/off", None, 3.0),
        ("POST", "/api/clock/off", {}, 3.0),
        ("GET", "/api/clock", None, 3.0),
        ("POST", "/api/clock", {"time": now, "brightness": 170}, 3.0),
        ("GET", "/api/alice/command", None, 3.0),
        ("OPTIONS", "/api/alice/command", None, 3.0),
        ("POST", "/api/alice/command", {"text": "" if not voice else "Алиса, проверка связи"}, 3.0),
    ]
    return [http_probe(8099, method, path, payload, timeout=timeout)
            for method, path, payload, timeout in probes]


# --------------------------------------------------------------------------- #
#  Кто слушает порты
# --------------------------------------------------------------------------- #

def listening_inodes():
    found = {}
    for proc_file in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            with open(proc_file, "r", encoding="utf-8", errors="replace") as fh:
                lines = fh.read().splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            parts = line.split()
            if len(parts) < 10 or parts[3] != "0A":
                continue
            try:
                port = int(parts[1].split(":")[1], 16)
            except (IndexError, ValueError):
                continue
            found.setdefault(port, set()).add(parts[9])
    return found


def process_cmdline(pid: str):
    try:
        with open("/proc/%s/cmdline" % pid, "rb") as fh:
            raw = fh.read().replace(b"\x00", b" ").strip()
        return raw.decode("utf-8", "replace")
    except OSError:
        return ""


def port_owner(inodes):
    wanted = {"socket:[%s]" % inode for inode in inodes}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        fd_dir = "/proc/%s/fd" % pid
        try:
            fds = os.listdir(fd_dir)
        except OSError:
            continue
        for fd in fds:
            try:
                target = os.readlink(os.path.join(fd_dir, fd))
            except OSError:
                continue
            if target in wanted:
                return pid, process_cmdline(pid)
    return None, None


def ports_info():
    table = listening_inodes()
    result = []
    for port in PORTS:
        inodes = table.get(port)
        item = {"port": port, "listening": bool(inodes)}
        if inodes:
            pid, cmd = port_owner(inodes)
            item["pid"] = pid
            item["cmd"] = cmd
        result.append(item)
    return result


def processes():
    found = []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        cmd = process_cmdline(pid)
        low = cmd.lower()
        if any(key in low for key in PROCESS_KEYS):
            found.append({"pid": pid, "cmd": cmd[:300]})
    return found


def unix_sockets():
    paths = []
    try:
        with open("/proc/net/unix", "r", encoding="utf-8", errors="replace") as fh:
            next(fh, None)
            for line in fh:
                parts = line.split()
                if len(parts) >= 8 and parts[7].startswith("/"):
                    path = parts[7]
                    if "alice" in path.lower() or "glagol" in path.lower():
                        if path not in paths:
                            paths.append(path)
    except OSError:
        pass
    return paths


# --------------------------------------------------------------------------- #
#  Glagol
# --------------------------------------------------------------------------- #

def tcp_probe(port: int, payload: bytes, timeout: float = 1.5):
    started = time.monotonic()
    try:
        sock = socket.create_connection(("127.0.0.1", port), timeout=timeout)
    except OSError as exc:
        return {"connect": False, "error": str(exc)}
    try:
        sock.settimeout(timeout)
        sock.sendall(payload)
        try:
            data = sock.recv(2048)
        except socket.timeout:
            data = b""
        return {
            "connect": True,
            "sent": payload.decode("utf-8", "replace"),
            "reply": data.decode("utf-8", "replace")[:400],
            "ms": int((time.monotonic() - started) * 1000),
        }
    except OSError as exc:
        return {"connect": True, "error": str(exc)}
    finally:
        try:
            sock.close()
        except OSError:
            pass


def glagol_probes():
    urls = [
        "ws://127.0.0.1:1961",
        "ws://127.0.0.1:1961/",
    ]
    results = []
    for url in urls:
        reply, error = common.glagol_send({"event": "ping"}, url=url, reply_timeout=1.0)
        results.append({"url": url, "reply": reply, "error": error})
    return {
        "websocket_module": common.websocket_available(),
        "ws": results,
        "http": http_probe(1961, "GET", "/", None, timeout=3.0),
        "raw_tcp": tcp_probe(1961, b'{"event":"ping"}\n'),
    }


def glagol_token():
    """Токен устройства, если пользователь положил его в secrets.json."""
    path = "/data/mypult/secrets.json"
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        token = data.get("glagol_token")
        return token if isinstance(token, str) else None
    except (OSError, ValueError):
        return None


def wss_probe(url: str, token: str, timeout: float = 4.0):
    """Локальный glagol: wss с самоподписанным сертификатом + JSON-конверт."""
    try:
        import websocket
    except Exception:
        return {"url": url, "error": "нет websocket-client"}

    try:
        ws = websocket.create_connection(
            url, timeout=timeout,
            sslopt={"cert_reqs": ssl.CERT_NONE, "check_hostname": False},
            enable_multithread=False,
        )
    except Exception as exc:  # noqa: BLE001
        return {"url": url, "connect_error": "%s: %s" % (type(exc).__name__, exc)}

    try:
        ws.send(json.dumps({
            "conversationToken": token,
            "id": "diag-%d" % int(time.time() * 1000),
            "payload": {"command": "softwareVersion"},
            "sentTime": int(round(time.time() * 1000)),
        }))
        ws.settimeout(3.0)
        try:
            reply = ws.recv()
        except Exception as exc:  # noqa: BLE001
            reply = None
            return {"url": url, "connected": True,
                    "error": "%s: %s" % (type(exc).__name__, exc)}
        return {"url": url, "connected": True, "reply": str(reply)[:600]}
    finally:
        try:
            ws.close()
        except Exception:
            pass


def wss_probes():
    token = glagol_token()
    out = {
        "token_present": bool(token),
        "token_source": "/data/mypult/secrets.json" if token else None,
        "probes": [],
    }
    for url in ("wss://127.0.0.1:1961", "wss://127.0.0.1:1961/"):
        out["probes"].append(wss_probe(url, token or ""))
    return out


# --------------------------------------------------------------------------- #
#  Точечные пробы Luna: команда и сегменты
# --------------------------------------------------------------------------- #

def command_probes(text: str):
    """GET-варианты отправки текста: какой параметр понимает Luna."""
    import urllib.parse
    results = []
    for param in ("text", "q", "command", "query"):
        path = "/api/alice/command?%s=%s" % (param, urllib.parse.quote(text))
        results.append(http_probe(8099, "GET", path, None, timeout=4.0))
    return results


def draw_probes(restore_time: str):
    """Рисование сегментами: Lua ждёт карту имя_сегмента -> яркость 0…255."""
    segments = {name: 255 for name in ("A1", "B1", "C1", "D1", "E1", "F1")}
    results = [http_probe(8099, "POST", "/api/clock", {"segments": segments})]
    results.append(http_probe(8099, "POST", "/api/clock", {"segments": {}}))
    results.append(http_probe(8099, "POST", "/api/clock",
                              {"time": restore_time, "brightness": 170}))
    return results


# --------------------------------------------------------------------------- #
#  Точка входа
# --------------------------------------------------------------------------- #

def main():
    data = common.params()
    voice = common.truthy(data.get("voice"))

    version, build_date = None, None
    try:
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "version.json"), "r", encoding="utf-8") as fh:
            info = json.load(fh)
        version, build_date = info.get("version"), info.get("date")
    except (OSError, ValueError):
        pass

    payload = {
        "ok": True,
        "version": version,
        "build": build_date,
        "time": {
            "local": time.strftime("%Y-%m-%d %H:%M:%S"),
            "utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
            "epoch": int(time.time()),
            "tz": os.environ.get("TZ"),
        },
        "ports": ports_info(),
        "processes": processes(),
        "unix_sockets": unix_sockets(),
        "luna": luna_probes(voice),
        "glagol": glagol_probes(),
        "ipc": {
            "tcp_9875": common.port_open(9875, timeout=0.3),
            "python": sys.version.split()[0],
        },
        "note": "voice=1 — команда Алисе; commands=1 — GET-варианты; draw=1 — сегменты; glagol=1 — wss",
    }

    if common.truthy(data.get("commands")):
        payload["commands"] = command_probes("Алиса, проверка связи")

    if common.truthy(data.get("draw")):
        payload["draw"] = draw_probes(time.strftime("%H:%M"))

    if common.truthy(data.get("wss")):
        payload["glagol_tls"] = wss_probes()

    common.respond(200, payload)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка diag.py: %s" % exc)
        except Exception:
            pass
