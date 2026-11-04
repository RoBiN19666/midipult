#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Общие помощники CGI-скриптов пульта «Станция Миди».

Работает под lighttpd + mod_cgi, отдаёт только JSON и не требует
ничего, кроме стандартной библиотеки Python 3.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# --------------------------------------------------------------------------- #
#  Настройки (переопределяются переменными окружения lighttpd)
# --------------------------------------------------------------------------- #

LUNA_BASE = (os.environ.get("MYPULT_LUNA") or "http://127.0.0.1:8099").rstrip("/")
GLAGOL_WS = os.environ.get("MYPULT_GLAGOL") or "ws://127.0.0.1:1961"
IPC_PORT = int(os.environ.get("MYPULT_IPC_PORT") or "9875")

HERE = os.path.dirname(os.path.abspath(__file__))
CONF_PATH = os.path.join(HERE, "glagol.conf")

REASONS = {
    200: "OK",
    201: "Created",
    202: "Accepted",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    413: "Payload Too Large",
    415: "Unsupported Media Type",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
}

START = time.monotonic()


# --------------------------------------------------------------------------- #
#  Ответ CGI
# --------------------------------------------------------------------------- #

_AUTH_CHECKED = False


def _ensure_auth():
    global _AUTH_CHECKED
    if _AUTH_CHECKED:
        return
    _AUTH_CHECKED = True
    require_auth()


def respond(status: int, payload: dict, headers=None) -> None:
    """Отправить JSON-ответ и завершить работу скрипта."""
    _ensure_auth()
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    extra = ""
    for name, value in (headers or ()):
        extra += "%s: %s\r\n" % (name, value)
    head = (
        "Status: %d %s\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: %d\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "%s"
        "\r\n" % (status, REASONS.get(status, "OK"), len(body), extra)
    ).encode("latin-1")
    out = sys.stdout.buffer
    out.write(head)
    out.write(body)
    out.flush()


def fail(status: int, message: str, **extra) -> None:
    """Короткий ответ об ошибке: {"ok": false, "error": "..."}."""
    payload = {"ok": False, "error": message}
    payload.update(extra)
    respond(status, payload)


def ok(**payload) -> None:
    payload["ok"] = True
    respond(200, payload)


# --------------------------------------------------------------------------- #
#  Разбор входящего запроса
# --------------------------------------------------------------------------- #

def _read_stdin() -> bytes:
    try:
        length = int(os.environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if length <= 0:
        return b""
    length = min(length, 1_000_000)
    try:
        return sys.stdin.buffer.read(length)
    except (OSError, ValueError):
        return b""


AUTH_PATH = os.environ.get("MYPULT_AUTH_PATH") or "/data/mypult/auth.json"


def write_json(path, data, mode=0o600, **kwargs):
    """Атомарно записать JSON: временный файл + rename."""
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, **kwargs)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
    try:
        os.chmod(path, mode)
    except OSError:
        pass


def auth_config():
    try:
        with open(AUTH_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return {"enabled": True, "broken": True}
        return data
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        # Файл есть, но не читается/испорчен: fail-closed, иначе PIN
        # молча отключается. Восстановление — локально через auth.py.
        return {"enabled": True, "broken": True}


def auth_cookie_ok(config):
    token = str(config.get("token") or "")
    if not token:
        return False
    for part in (os.environ.get("HTTP_COOKIE") or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == "mypult_token" and hmac.compare_digest(value.strip(), token):
            return True
    return False


def require_auth():
    """Пускать к CGI только с PIN-кукой, кроме самого auth.py и localhost."""
    script = os.path.basename(os.environ.get("SCRIPT_NAME") or
                              os.environ.get("SCRIPT_FILENAME") or "")
    if script == "auth.py":
        return
    config = auth_config()
    if os.environ.get("REMOTE_ADDR") in ("127.0.0.1", "::1"):
        return
    if config.get("broken"):
        fail(503, "auth.json повреждён — нужен локальный доступ")
        sys.exit(0)
    if not config.get("enabled"):
        return
    if auth_cookie_ok(config):
        return
    fail(401, "Нужен PIN", auth=True)
    sys.exit(0)


# Действия, которые нельзя запускать GET-запросом/ссылкой. Читающие ключи
# (status/info/download/…) сюда не входят.
WRITE_KEYS = frozenset({
    "off", "on", "restore", "save", "auto_tick", "clock_tick", "auto_brightness",
    "display_auto_brightness", "segments_brightness", "manual", "sync_clock",
    "brightness", "ring_brightness", "backlight", "cleanup", "reboot",
    "poweroff", "disable", "logout", "logout_all", "login", "pin", "enabled",
    "disabled", "delete", "delete_custom", "rename_custom", "play_custom",
    "replace", "custom", "add", "remove", "start", "stop", "play", "pause",
    "next", "prev", "seek", "volume", "mute", "unmute", "pair", "scan",
    "connect", "disconnect", "dns", "dns_apply_saved", "command", "url",
    "profiles", "scenarios", "actions", "conditions", "phrases", "schedule",
    "tz_offset", "apply", "run", "tick", "data", "autostart", "draw",
    "append", "control", "ssid", "bssid", "psk", "max_volume", "delta",
    "chat_new", "chat_delete", "chat_rename", "chat_select", "chat_next",
    "chat_prev", "chat_name", "max_tokens", "system_prompt", "prompt",
    "provider", "key", "base_url", "model", "profile_id", "text", "color",
})
WRITE_ACTIONS = frozenset({
    "play", "pause", "stop", "next", "prev", "seek", "rewind", "setvolume",
    "volume", "mute", "unmute", "connect", "disconnect", "scan", "pair",
    "unpair", "power", "on", "off", "restart", "start", "add", "remove",
    "delete", "rename", "apply", "set", "toggle", "run", "draw", "send",
    "clear", "launch", "wake", "dns_apply_saved",
})


def _method() -> str:
    return (os.environ.get("REQUEST_METHOD") or "GET").upper()


def same_origin_ok() -> bool:
    """POST с другого сайта не должен проходить даже с Lax-Cookie."""
    if os.environ.get("REMOTE_ADDR") in ("127.0.0.1", "::1"):
        return True
    origin = (os.environ.get("HTTP_ORIGIN") or os.environ.get("HTTP_REFERER") or "").strip()
    host = (os.environ.get("HTTP_HOST") or "").strip().lower()
    if origin:
        try:
            parsed = urllib.parse.urlsplit(origin)
        except ValueError:
            return False
        if parsed.scheme not in ("http", "https"):
            return False
        return bool(host) and parsed.netloc.lower() == host
    # Android WebView/старые движки иногда не шлют Origin; свой заголовок
    # нельзя поставить cross-site формой без CORS-preflight.
    return os.environ.get("HTTP_X_REQUESTED_WITH") == "MidiPult"


def params() -> dict:
    method = _method()
    require_auth()
    if method not in ("GET", "HEAD") and not same_origin_ok():
        fail(403, "Запрос с другого сайта запрещён")
        sys.exit(0)
    data: dict = {}
    query = os.environ.get("QUERY_STRING") or ""
    if query:
        for key, values in urllib.parse.parse_qs(query, keep_blank_values=True).items():
            data[key] = values[-1]
        if method in ("GET", "HEAD"):
            if any(key in WRITE_KEYS for key in data):
                fail(405, "Действие требует POST")
                sys.exit(0)
            action = str(data.get("action") or "").strip().lower()
            if action in WRITE_ACTIONS:
                fail(405, "Действие требует POST")
                sys.exit(0)

    raw = _read_stdin()
    if not raw:
        return data

    ctype = (os.environ.get("CONTENT_TYPE") or "").split(";")[0].strip().lower()

    if ctype == "application/json" or raw.lstrip()[:1] in (b"{", b"["):
        try:
            body = json.loads(raw.decode("utf-8", "replace"))
        except ValueError:
            body = None
        if isinstance(body, dict):
            data.update(body)
        elif raw.strip() and not data.get("text"):
            data["text"] = raw.decode("utf-8", "replace").strip()
        return data

    if ctype == "application/x-www-form-urlencoded":
        for key, values in urllib.parse.parse_qs(
            raw.decode("utf-8", "replace"), keep_blank_values=True
        ).items():
            data[key] = values[-1]
        return data

    data["text"] = raw.decode("utf-8", "replace").strip()
    return data


def truthy(value) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in ("1", "true", "yes", "on", "y", "да")


def to_int(value, default=None, lo=None, hi=None):
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    if lo is not None:
        number = max(lo, number)
    if hi is not None:
        number = min(hi, number)
    return number


# --------------------------------------------------------------------------- #
#  Сеть: Luna
# --------------------------------------------------------------------------- #

class LunaError(RuntimeError):
    """Luna недоступна по HTTP."""


def luna_post(path: str, payload=None, timeout: float = 10.0):
    """POST в Luna API. Возвращает (http_status, text)."""
    url = LUNA_BASE + path
    data = json.dumps(payload if payload is not None else {}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(262144).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(262144).decode("utf-8", "replace")
        except OSError:
            body = ""
        return exc.code, body
    except (urllib.error.URLError, socket.timeout, OSError) as exc:
        raise LunaError(
            "Luna не отвечает на %s (%s)" % (LUNA_BASE, getattr(exc, "reason", exc))
        ) from exc


def luna_json(path: str, payload=None, timeout: float = 10.0):
    """POST в Luna API и разбор JSON-ответа (если он есть)."""
    status, text = luna_post(path, payload, timeout=timeout)
    try:
        parsed = json.loads(text) if text.strip() else {}
    except ValueError:
        parsed = {"raw": text}
    return status, parsed


# --------------------------------------------------------------------------- #
#  Сеть: проверки портов
# --------------------------------------------------------------------------- #

def port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.7) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def tcp_latency(port: int, host: str = "127.0.0.1", timeout: float = 0.7):
    started = time.monotonic()
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except OSError:
        return None
    try:
        return round((time.monotonic() - started) * 1000.0, 1)
    finally:
        try:
            sock.close()
        except OSError:
            pass


# --------------------------------------------------------------------------- #
#  Glagol (WebSocket)
# --------------------------------------------------------------------------- #

def websocket_available() -> bool:
    try:
        import websocket  # noqa: F401
        return True
    except Exception:
        return False


def glagol_send(payload: dict, url: str | None = None, connect_timeout: float = 3.0,
                reply_timeout: float = 1.2):
    """Отправить один JSON-кадр в Glagol и попробовать прочитать ответ.

    Возвращает (reply, error). `reply` — None, если сервер промолчал;
    `error` — строка, если соединение/отправка не удались.
    """
    try:
        import websocket
    except Exception as exc:  # pragma: no cover - зависит от станции
        return None, "python3-websocket-client не установлен: yse install python3-websocket-client"

    target = url or GLAGOL_WS
    ws = None
    try:
        ws = websocket.create_connection(target, timeout=connect_timeout, enable_multithread=False)
        ws.send(json.dumps(payload, ensure_ascii=False))
        try:
            ws.settimeout(reply_timeout)
            reply = ws.recv()
        except Exception:
            reply = None
        return reply, None
    except Exception as exc:
        return None, "%s: %s" % (type(exc).__name__, exc)
    finally:
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass


def load_glagol_conf() -> dict:
    """Необязательные переопределения формата команд Glagol."""
    conf = {}
    try:
        with open(CONF_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            conf = data
    except (OSError, ValueError):
        conf = {}
    return conf


# --------------------------------------------------------------------------- #
#  URL guard: SSRF / приватные адреса
# --------------------------------------------------------------------------- #

URL_ALLOW_PATH = "/data/mypult/url_allow.json"


def _url_allow_hosts() -> set:
    try:
        with open(URL_ALLOW_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError, TypeError):
        return set()
    hosts = data.get("hosts") if isinstance(data, dict) else data
    if not isinstance(hosts, list):
        return set()
    return {str(item).strip().lower() for item in hosts if str(item).strip()}


def url_guard(url, allow_http=False, allow_private=False, allow_loopback=False):
    """Проверить URL для исходящего запроса и вернуть его.

    Приватные/loopback-адреса запрещены, если явно не разрешены или хост
    не внесён в /data/mypult/url_allow.json ({"hosts": ["192.168.1.10"]}).
    Link-local/метаданные запрещены всегда.
    """
    raw = str(url or "").strip()
    parsed = urllib.parse.urlsplit(raw)
    if parsed.scheme not in ("https", "http") or (parsed.scheme == "http" and not allow_http):
        raise ValueError("нужен https-адрес" if not allow_http else "нужен http(s)-адрес")
    if parsed.username or parsed.password:
        raise ValueError("учётные данные в URL запрещены")
    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise ValueError("в URL нет хоста")
    allowed = _url_allow_hosts()
    allowed_host = host in allowed
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80),
                                   proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise ValueError("хост не разрешается: %s" % exc) from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_link_local or ip.is_unspecified or ip.is_multicast:
            raise ValueError("link-local/метаданные запрещены")
        allowed_ip = str(ip) in allowed
        if ip.is_loopback and not allow_loopback and not (allowed_host or allowed_ip):
            raise ValueError("loopback-адрес запрещён")
        if ip.is_private and not ip.is_loopback and not allow_private and not (allowed_host or allowed_ip):
            raise ValueError("приватный адрес запрещён")
        if not ip.is_global and not (allow_private or allow_loopback or allowed_host or allowed_ip):
            raise ValueError("непубличный адрес запрещён")
    return raw


# --------------------------------------------------------------------------- #
#  Процессы
# --------------------------------------------------------------------------- #

def run(argv, timeout: float = 6.0):
    """Запуск команды без shell. Возвращает (code, stdout, stderr)."""
    try:
        proc = subprocess.run(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError:
        return 127, "", "%s: not found" % argv[0]
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except OSError as exc:
        return 126, "", str(exc)
    return (
        proc.returncode,
        proc.stdout.decode("utf-8", "replace"),
        proc.stderr.decode("utf-8", "replace"),
    )


def which(name: str):
    for base in (os.environ.get("PATH", ""), "/opt/bin:/opt/sbin:/usr/bin:/bin:/sbin"):
        for folder in base.split(os.pathsep):
            if not folder:
                continue
            candidate = os.path.join(folder, name)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    return None
