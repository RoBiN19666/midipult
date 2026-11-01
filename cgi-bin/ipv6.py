#!/usr/bin/env python3
"""IPv6: переключатель для сетей без глобального IPv6.

В провайдерской сети без IPv6 глобального маршрута нет, но AAAA-записи
существуют. Отключение IPv6 заставляет приложения сразу идти по IPv4.
Настройка хранится в /data/mypult/ipv6.json и применяется при загрузке.
"""

from __future__ import annotations

import json
import os
import sys

import common

STATE = "/data/mypult/ipv6.json"
ALL = "/proc/sys/net/ipv6/conf/all/disable_ipv6"
DEFAULT = "/proc/sys/net/ipv6/conf/default/disable_ipv6"


def _read_disabled():
    try:
        with open(ALL, "r", encoding="ascii") as fh:
            return fh.read().strip() == "1"
    except OSError:
        return None


def _set(disabled):
    value = "1" if disabled else "0"
    for path in (ALL, DEFAULT):
        try:
            with open(path, "w", encoding="ascii") as fh:
                fh.write(value)
        except OSError as exc:
            raise RuntimeError("не удалось записать %s: %s" % (path, exc))
    return _read_disabled()


def _saved():
    try:
        with open(STATE, "r", encoding="utf-8") as fh:
            return bool(json.load(fh).get("disabled"))
    except (OSError, ValueError, TypeError):
        return None


def _save(disabled):
    common.write_json(STATE, {"disabled": bool(disabled)}, mode=0o600)


def apply_saved(default_disabled=True):
    saved = _saved()
    if saved is None:
        saved = default_disabled
        _save(saved)
    return _set(saved)


def status():
    return {
        "ok": True,
        "disabled": _read_disabled(),
        "saved": _saved(),
        "supported": os.path.exists(ALL),
    }


def main():
    if "--apply" in sys.argv:
        apply_saved(default_disabled=True)
        return

    common.require_auth()
    data = common.params()
    method = (os.environ.get("REQUEST_METHOD") or "GET").upper()
    if method == "POST" and "disabled" in data:
        disabled = common.truthy(data.get("disabled"))
        result = _set(disabled)
        _save(disabled)
        common.ok(disabled=result, saved=disabled, reboot=False)
        return
    common.ok(**status())


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "IPv6: %s" % exc)
        except Exception:
            pass
