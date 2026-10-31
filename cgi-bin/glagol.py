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

import json
import os
import re
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


def _device():
    try:
        with open(DEVICES, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        device = data["devices"][0]
        return device["id"], device["platform"]
    except (OSError, ValueError, KeyError, IndexError) as exc:
        raise GlagolError("не читается devices.json: %s" % exc)


def _fetch_token():
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


def token(force=False):
    if not force:
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as fh:
                cached = json.load(fh)
            if cached.get("token") and time.time() - cached.get("ts", 0) < TTL:
                return cached["token"]
        except (OSError, ValueError):
            pass

    value = _fetch_token()
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        os.chmod(CACHE_DIR, 0o700)
        with open(CACHE_PATH, "w", encoding="utf-8") as fh:
            json.dump({"token": value, "ts": int(time.time())}, fh)
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
