#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Локальный glagol: wss://127.0.0.1:1961 + conversationToken.

Токен берётся из OAuth-сессии самой колонки
(/data/quasar/account_storage.dat -> quasar.yandex.net/glagol/token)
и кэшируется в /data/mypult/glagol.json с правами 600. Наружу токен
не отдаётся: CGI только сообщает, получилось ли отправить команду.

Формат кадра (проверено на прошивке):

    {"conversationToken": "...", "id": "...",
     "payload": {"command": "play"}, "sentTime": 1234567890}
"""

from __future__ import annotations

import base64
import json
import os
import re
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request

CACHE_DIR = "/data/mypult"
CACHE_PATH = os.path.join(CACHE_DIR, "glagol.json")
OVERRIDE_PATH = os.path.join(CACHE_DIR, "glagol_device.json")
ACCOUNT = "/data/quasar/account_storage.dat"
DEVICES = "/data/quasar/devices.json"
URL = "wss://127.0.0.1:1961"
TOKEN_URL = "https://quasar.yandex.net/glagol/token"
TTL = 3600
MIDI_PLATFORMS = ("yandexmidi", "cucumber")


class GlagolError(RuntimeError):
    pass


def _oauth_tokens():
    try:
        with open(ACCOUNT, "rb") as fh:
            raw = fh.read()
    except OSError as exc:
        raise GlagolError("нет доступа к %s: %s" % (ACCOUNT, exc))
    # По документации Яндекса токен — «y», цифра 0–3 и «_»; встречаются оба
    # варианта: y0__… (в хранилище этой прошивки) и y0_Ag…/y3_…. Раньше regex
    # требовал ровно «y0__» и не находил токены других форматов.
    tokens = [m.group(0).decode("ascii")
              for m in re.finditer(rb"y[0-9]_[A-Za-z0-9_\-]{20,}", raw)]
    if not tokens:
        raise GlagolError("в account_storage.dat не найден OAuth-токен")
    return tokens


def _local_endpoints():
    """IP и MAC этой колонки: по ним выбираем её среди устройств аккаунта."""
    ips = set()
    macs = set()
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("8.8.8.8", 80))
            ips.add(sock.getsockname()[0])
        finally:
            sock.close()
    except OSError:
        pass
    try:
        for iface in os.listdir("/sys/class/net"):
            try:
                with open("/sys/class/net/%s/address" % iface, encoding="ascii") as fh:
                    mac = fh.read().strip().lower()
                if mac and mac != "00:00:00:00:00:00":
                    macs.add(mac)
            except OSError:
                pass
    except OSError:
        pass
    return ips, macs


def _network_info(device):
    info = device.get("networkInfo") or device.get("network_info") or {}
    ips = info.get("ip_addresses") or info.get("ipAddresses") or []
    macs = info.get("mac_addresses") or info.get("macAddresses") or []
    if isinstance(ips, str):
        ips = [ips]
    if isinstance(macs, str):
        macs = [macs]
    return ({str(value) for value in ips if value},
            {str(value).lower() for value in macs if value})


def _override():
    """Ручной device_id/platform в glagol_device.json — когда devices.json нет.

    Формат: {"device_id": "R103JQ000BMYYK", "platform": "yandexmidi"}
    Нужен для станций (например Station 2), где список устройств на колонке
    не хранится, а id можно взять только из аккаунта.
    """
    try:
        with open(OVERRIDE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    device_id = str(data.get("device_id") or "").strip()
    if not device_id:
        return None
    platform = str(data.get("platform") or "").strip() or "yandexmidi"
    return device_id, platform


LOG_FILES = (
    "/data/quasar/daemons_logs/yiod.log",
    "/data/quasar/daemons_logs/maind.log",
    "/data/quasar/daemons_logs/updatesd.log",
    "/data/quasar/daemons_logs/telemetry.log",
)
LOG_LIMIT = 4 * 1024 * 1024
KNOWN_PLATFORMS = ("yandexmidi", "cucumber", "yandexstation", "yandexstation_2", "station_2")
DEVICE_ID_RE = re.compile(rb"device[_-]?id[=:\"\s]+([A-Z0-9]{8,24})", re.IGNORECASE)
PLATFORM_RE = re.compile(rb"platform[=:\"\s]+([a-z0-9_]+)", re.IGNORECASE)


def _read_log(path, limit=LOG_LIMIT):
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            if size > limit:  # хвост важнее начала: там свежие запросы
                fh.seek(size - limit)
            return fh.read()
    except OSError:
        return b""


def _device_from_logs():
    """device_id из логов демонов: прошивка сама подставляет его в запросы.

    На Station 2 `devices.json` не создаётся, зато в `yiod.log` есть строка
    `…/register?device_id=U00…&platform=yandexmidi`. Это единственный
    локальный источник настоящего id.
    """
    for path in LOG_FILES:
        blob = _read_log(path)
        if not blob:
            continue
        match = DEVICE_ID_RE.search(blob)
        if not match:
            continue
        device_id = match.group(1).decode("ascii", "ignore")
        window = blob[max(0, match.start() - 200):match.end() + 200]
        platform_match = PLATFORM_RE.search(window)
        platform = "yandexmidi"
        if platform_match:
            value = platform_match.group(1).decode("ascii", "ignore")
            # В логах рядом бывает «platform=linux»; берём только станционные имена.
            if value in KNOWN_PLATFORMS:
                platform = value
        return device_id, platform
    return None


def _device():
    manual = _override()
    if manual:
        return manual
    try:
        with open(DEVICES, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        devices = data.get("devices") or []
        if not devices:
            raise GlagolError("в devices.json нет устройств")
        targets = [device for device in devices
                   if device.get("platform") in MIDI_PLATFORMS]
        local_ips, local_macs = _local_endpoints()
        for device in targets:
            ips, macs = _network_info(device)
            if local_ips & ips or local_macs & macs:
                return device["id"], device["platform"]
        if targets:
            return targets[0]["id"], targets[0]["platform"]
        raise GlagolError(
            "в devices.json нет устройства yandexmidi/cucumber; "
            "проверьте, что колонка привязана к аккаунту")
    except GlagolError as exc:
        found = _device_from_logs()
        if found:
            return found
        raise exc
    except (OSError, ValueError, KeyError, IndexError) as exc:
        found = _device_from_logs()
        if found:
            return found
        raise GlagolError("не читается devices.json: %s" % exc)


def _fetch_token(device_id=None, platform=None):
    if device_id is None or platform is None:
        device_id, platform = _device()
    for candidate in _oauth_tokens():
        url = "%s?device_id=%s&platform=%s" % (TOKEN_URL, device_id, platform)
        request = urllib.request.Request(url, headers={
            "Authorization": "OAuth " + candidate,
            "User-Agent": "okhttp/3.12.13",
        })
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                body = json.loads(response.read().decode("utf-8"))
        except Exception:
            continue
        token_value = body.get("token")
        if token_value:
            return token_value
    raise GlagolError("Яндекс не выдал glagol-токен")


def _jwt_claims(value):
    """Поля JWT без проверки подписи: нужны exp и sub (device_id)."""
    try:
        part = str(value).split(".")[1]
        part += "=" * (-len(part) % 4)
        claims = json.loads(base64.urlsafe_b64decode(part).decode("utf-8"))
        return claims if isinstance(claims, dict) else {}
    except (ValueError, TypeError, KeyError, IndexError, UnicodeDecodeError):
        return {}


def _jwt_exp(value):
    """Вернуть exp JWT без проверки подписи (нам нужен только срок)."""
    exp = _jwt_claims(value).get("exp")
    try:
        return float(exp) if exp else 0.0
    except (TypeError, ValueError):
        return 0.0


def token(force=False):
    device_id, platform = _device()
    cached_token = None
    if not force:
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as fh:
                cached = json.load(fh)
            if (cached.get("token")
                    and cached.get("device_id") == device_id
                    and cached.get("platform") == platform):
                cached_token = cached["token"]
                exp = _jwt_exp(cached_token)
                fresh = exp > time.time() + 300
                try:
                    cached_ts = float(cached.get("ts") or 0)
                except (TypeError, ValueError):
                    cached_ts = 0.0
                # Старый TTL в час заставлял обновлять ещё живой токен.
                if fresh or (not exp and time.time() - cached_ts < TTL):
                    return cached_token
        except (OSError, ValueError, TypeError):
            pass

    try:
        value = _fetch_token(device_id, platform)
    except GlagolError:
        if cached_token and _jwt_exp(cached_token) > time.time():
            return cached_token
        raise
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        os.chmod(CACHE_DIR, 0o700)
        with open(CACHE_PATH, "w", encoding="utf-8") as fh:
            json.dump({"token": value, "ts": int(time.time()),
                       "device_id": device_id, "platform": platform}, fh)
        os.chmod(CACHE_PATH, 0o600)
    except OSError:
        pass
    return value


def _connect(timeout):
    try:
        import websocket
    except Exception as exc:  # noqa: BLE001
        raise GlagolError("нет websocket-client: %s" % exc)
    return websocket.create_connection(
        URL,
        timeout=timeout,
        sslopt={"cert_reqs": ssl.CERT_NONE, "check_hostname": False},
        enable_multithread=False,
    )


def _envelope(payload, request_id, access_token):
    return json.dumps({
        "conversationToken": access_token,
        "id": request_id,
        "payload": payload,
        "sentTime": int(round(time.time() * 1000)),
    })


# --------------------------------------------------------------------------- #
#  Постоянный watcher: Glagol сам присылает state при изменениях
# --------------------------------------------------------------------------- #
# Один WebSocket на процесс: как в yapanel-web. Панель получает свежий трек,
# громкость и прогресс без запроса softwareVersion на каждый опрос.

_watch_lock = threading.Lock()
_watch = {"state": None, "updated": 0.0, "connected": False, "error": None}
_watcher = None
_watch_callbacks = []


def latest(max_age=None):
    """Последний state от Glagol (None, если ещё не приходил или устарел)."""
    with _watch_lock:
        state = _watch["state"]
        updated = _watch["updated"]
    if not isinstance(state, dict):
        return None
    if max_age is not None and time.time() - updated > max_age:
        return None
    return state


def watch_status():
    with _watch_lock:
        return dict(_watch)


def on_state(callback):
    """Подписаться на каждый state от watcher (без HTTP-запросов)."""
    if callback not in _watch_callbacks:
        _watch_callbacks.append(callback)


class _Watcher(threading.Thread):
    def __init__(self):
        super().__init__(name="glagol-watch", daemon=True)
        self.stop_event = threading.Event()

    def stop(self):
        self.stop_event.set()

    def run(self):
        delay = 1.0
        while not self.stop_event.is_set():
            try:
                self._session()
                delay = 1.0
            except Exception as exc:  # noqa: BLE001
                with _watch_lock:
                    _watch["connected"] = False
                    _watch["error"] = str(exc)[:200]
                self.stop_event.wait(delay)
                delay = min(delay * 2, 30.0)

    def _session(self):
        import websocket

        access_token = token()
        connection = _connect(35.0)
        try:
            connection.settimeout(30.0)
            request_id = "mypult-watch-%d" % int(time.time() * 1000)
            connection.send(_envelope({"command": "softwareVersion"},
                                      request_id, access_token))
            with _watch_lock:
                _watch["connected"] = True
                _watch["error"] = None
            last_ping = time.time()
            while not self.stop_event.is_set():
                try:
                    raw = connection.recv()
                except websocket.WebSocketTimeoutException:
                    raw = None
                if raw:
                    try:
                        message = json.loads(raw)
                    except ValueError:
                        message = None
                    if isinstance(message, dict):
                        state = message.get("state")
                        if isinstance(state, dict):
                            with _watch_lock:
                                _watch.update(state=state, updated=time.time(),
                                              connected=True, error=None)
                            for callback in list(_watch_callbacks):
                                try:
                                    callback(state)
                                except Exception:  # noqa: BLE001
                                    pass
                if time.time() - last_ping > 20:
                    try:
                        connection.send(_envelope(
                            {"command": "ping"},
                            "mypult-ping-%d" % int(time.time() * 1000),
                            access_token))
                    except Exception:  # noqa: BLE001
                        break
                    last_ping = time.time()
        finally:
            try:
                connection.close()
            except Exception:  # noqa: BLE001
                pass


def start_watcher():
    """Запустить постоянный watcher (идемпотентно)."""
    global _watcher
    if _watcher is not None and _watcher.is_alive():
        return _watcher
    _watcher = _Watcher()
    _watcher.start()
    return _watcher



def send(payload, timeout=8.0):
    """Отправить JSON-конверт и вернуть первое/подтверждающее сообщение."""
    last_error = None

    for attempt in (0, 1):
        connection = None
        try:
            access_token = token(force=bool(attempt))
            connection = _connect(timeout)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            continue

        request_id = "mypult-%d" % int(time.time() * 1000)
        try:
            connection.send(json.dumps({
                "conversationToken": access_token,
                "id": request_id,
                "payload": payload,
                "sentTime": int(round(time.time() * 1000)),
            }))
            connection.settimeout(timeout)
            reply = None
            while True:
                try:
                    raw = connection.recv()
                except Exception:
                    break
                if not raw:
                    break
                try:
                    message = json.loads(raw)
                except ValueError:
                    continue
                reply = message
                if message.get("id") == request_id or message.get("requestId") == request_id:
                    break
            return reply
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        finally:
            try:
                connection.close()
            except Exception:
                pass

    raise GlagolError("glagol недоступен: %s" % last_error)


# --------------------------------------------------------------------------- #
#  Диагностика: /opt/bin/python3 /data/myweb/cgi-bin/glagol.py --probe
# --------------------------------------------------------------------------- #

def _read_text(path):
    try:
        with open(path, "rb") as fh:
            return fh.read().replace(b"\x00", b"").decode("utf-8", "replace").strip()
    except OSError:
        return ""


def _resolve(host):
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return []
    return sorted({info[4][0] for info in infos})


def _is_private(ip):
    parts = str(ip or "").split(".")
    if len(parts) != 4 or not all(part.isdigit() for part in parts):
        return False
    first, second = int(parts[0]), int(parts[1])
    return (first == 10 or first == 127 or (first == 192 and second == 168)
            or (first == 172 and 16 <= second <= 31))


def _status(url, access_token):
    request = urllib.request.Request(url, headers={"Authorization": "OAuth " + access_token})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read(300).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(200).decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        return 0, str(exc)[:200]


def probe(argv=None):
    """Что известно про устройство и что отвечает токен-эндпоинт.

        glagol.py --probe [--device-id R...] [--platform ...] [--host ...]
    """
    import argparse

    parser = argparse.ArgumentParser(description="Glagol token probe")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--device-id", default="")
    parser.add_argument("--platform", default="")
    parser.add_argument("--host", default="",
                        help="другой хост вместо quasar.yandex.net (для проверки подмены DNS)")
    args = parser.parse_args(argv)

    host = args.host or "quasar.yandex.net"
    token_url = "https://%s/glagol/token" % host
    resolved = _resolve(host)

    devices = []
    try:
        with open(DEVICES, "r", encoding="utf-8") as fh:
            devices = (json.load(fh) or {}).get("devices") or []
    except (OSError, ValueError, AttributeError):
        pass

    try:
        tokens = _oauth_tokens()
        token_error = ""
    except GlagolError as exc:
        tokens, token_error = [], str(exc)

    manual = _override()
    source = ""
    device_id = args.device_id
    platform = args.platform
    if device_id:
        source = "arg"
    if not device_id and manual:
        device_id, platform = manual
        source = "glagol_device.json"
    if not device_id and devices:
        device_id = str(devices[0].get("id") or "")
        platform = platform or str(devices[0].get("platform") or "yandexmidi")
        source = "devices.json"
    if not device_id:
        found = _device_from_logs()
        if found:
            device_id, platform = found
            source = "daemons_logs"
    platform = platform or "yandexmidi"

    report = {
        "model": _read_text("/proc/device-tree/model"),
        "compatible": _read_text("/proc/device-tree/compatible"),
        "host": host,
        "resolved": resolved,
        "devices_json": bool(devices),
        "devices": [{key: item.get(key) for key in ("id", "platform")} for item in devices],
        "override": manual,
        "device_id_source": source or None,
        "account_tokens": len(tokens),
        "token_error": token_error,
        "checked_device_id": device_id,
        "checks": [],
    }

    if resolved and all(_is_private(ip) for ip in resolved):
        report["dns_hint"] = ("%s резолвится в локальный адрес (%s) — возможно, "
                              "подмена DNS; тогда 403/404 ниже ничего не значат"
                              % (host, ", ".join(resolved)))
    if not device_id:
        report["hint"] = ("device_id неизвестен: укажите --device-id R... или "
                          "положите его в %s" % OVERRIDE_PATH)

    for index, value in enumerate(tokens):
        if not device_id:
            break
        code, body = _status("%s?device_id=%s&platform=%s" % (token_url, device_id, platform), value)
        entry = {
            "index": index,
            "token": value[:5] + "…",
            "code": code,
            "message": body[:200],
        }
        if code == 200:
            try:
                claims = _jwt_claims(json.loads(body).get("token") or "")
                entry["sub"] = claims.get("sub")
            except Exception:  # noqa: BLE001
                pass
        report["checks"].append(entry)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    probe(sys.argv[1:])
