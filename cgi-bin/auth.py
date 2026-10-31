#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""PIN-защита пульта (по умолчанию выключена).

    GET  /cgi-bin/auth.py?status=1      — включён ли PIN и авторизован ли браузер
    POST /cgi-bin/auth.py {"login":1,"pin":"1234"}
    POST /cgi-bin/auth.py {"pin":"1234","enabled":1}   — включить/сменить PIN
    POST /cgi-bin/auth.py {"disable":1}                — выключить
    POST /cgi-bin/auth.py {"logout":1}
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

STORE = "/data/mypult/auth.json"
COOKIE = "mypult_token"
MAX_AGE = 30 * 24 * 3600


def load():
    try:
        with open(STORE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save(data):
    common.write_json(STORE, data)


def pin_hash(pin, salt):
    return hashlib.sha256((salt + ":" + pin).encode("utf-8")).hexdigest()


def make_token(salt, hashed):
    return hashlib.sha256(("mypult:" + salt + ":" + hashed).encode("utf-8")).hexdigest()


def cookie_header(token, age=MAX_AGE):
    return ("Set-Cookie",
            "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax" % (COOKIE, token, age))


def status():
    config = load()
    enabled = bool(config.get("enabled"))
    return {
        "ok": True,
        "enabled": enabled,
        "authed": bool(enabled and common.auth_cookie_ok(config)),
        "has_pin": bool(config.get("pin_hash")),
    }


def can_manage(config):
    """Менять PIN/отключать защиту можно только с localhost или после входа."""
    if not config.get("enabled"):
        return True
    if os.environ.get("REMOTE_ADDR") in ("127.0.0.1", "::1"):
        return True
    return common.auth_cookie_ok(config)


def main():
    data = common.params()

    if common.truthy(data.get("logout_all")):
        config = load()
        if not can_manage(config):
            common.fail(403, "Сначала введите PIN")
            return
        if config.get("enabled"):
            config["token"] = secrets.token_hex(32)
            save(config)
        common.respond(200, {"ok": True, "authed": False},
                       [cookie_header("", 0)])
        return

    if common.truthy(data.get("logout")):
        common.respond(200, {"ok": True, "authed": False},
                       [cookie_header("", 0)])
        return

    if common.truthy(data.get("login")):
        config = load()
        pin = str(data.get("pin") or "").strip()
        if not config.get("enabled"):
            common.fail(400, "PIN не включён")
            return
        if not pin or not hmac.compare_digest(pin_hash(pin, config.get("salt", "")),
                                              str(config.get("pin_hash", ""))):
            common.fail(403, "Неверный PIN")
            return
        token = str(config.get("token") or "")
        if not token:
            token = make_token(config.get("salt", ""), config.get("pin_hash", ""))
        common.respond(200, {"ok": True, "authed": True}, [cookie_header(token)])
        return

    if common.truthy(data.get("disable")):
        config = load()
        if not can_manage(config):
            common.fail(403, "Сначала введите PIN")
            return
        config["enabled"] = False
        save(config)
        common.respond(200, {"ok": True, "enabled": False},
                       [cookie_header("", 0)])
        return

    if data.get("pin") is not None and common.truthy(data.get("enabled")):
        current = load()
        if not can_manage(current):
            common.fail(403, "Сначала введите текущий PIN")
            return
        pin = str(data.get("pin") or "").strip()
        if not (4 <= len(pin) <= 8) or not pin.isdigit():
            common.fail(400, "PIN: 4–8 цифр")
            return
        salt = secrets.token_hex(8)
        hashed = pin_hash(pin, salt)
        config = {"enabled": True, "salt": salt, "pin_hash": hashed,
                  "token": make_token(salt, hashed)}
        save(config)
        # Не оставляем текущий браузер «уже вошедшим»: новая соль
        # инвалидирует старые куки, а эту — гасим.
        common.respond(200, {"ok": True, "enabled": True, "authed": False},
                       [cookie_header("", 0)])
        return

    common.respond(200, status())


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка auth.py: %s" % exc)
        except Exception:
            pass
