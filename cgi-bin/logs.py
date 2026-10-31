#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Просмотр логов пульта и lighttpd.

    GET /cgi-bin/logs.py?name=voice&lines=120
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

LOGS = {
    "mypult": "/tmp/mypult.log",
    "voice": "/data/mypult/voice.log",
    "lighttpd": "/tmp/mypult-lighttpd-error.log",
}


def tail(path, limit):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return "".join(fh.readlines()[-limit:])
    except OSError as exc:
        return "(нет файла: %s)" % exc


def main():
    data = common.params()
    name = str(data.get("name") or "mypult")
    if name not in LOGS:
        name = "mypult"
    limit = common.to_int(data.get("lines"), 120, 20, 500)
    common.ok(
        name=name,
        lines=limit,
        text=tail(LOGS[name], limit),
        files=[{"id": key, "path": value} for key, value in LOGS.items()],
    )


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка logs.py: %s" % exc)
        except Exception:
            pass
