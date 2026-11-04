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
import time
import urllib.request

CACHE_DIR = "/data/mypult"
CACHE_PATH = os.path.join(CACHE_DIR, "glagol.json")
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
    tokens = [m.group(0).decode("ascii") for m in re.finditer(rb"y0__[A-Za-z0-9_\-]{20,}", raw)]
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


def _device():
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
    except GlagolError:
        raise
    except (OSError, ValueError, KeyError, IndexError) as exc:
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


def _jwt_exp(value):
    """Вернуть exp JWT без проверки подписи (нам нужен только срок)."""
    try:
        part = str(value).split(".")[1]
        part += "=" * (-len(part) % 4)
        payload = json.loads(base64.urlsafe_b64decode(part).decode("utf-8"))
        exp = payload.get("exp")
        return float(exp) if exp else 0.0
    except (ValueError, TypeError, KeyError, IndexError, UnicodeDecodeError):
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
