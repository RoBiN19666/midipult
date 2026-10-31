#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Один запрос вместо status.py + player.py.

    GET /cgi-bin/state.py

Экономит запуск Python и один HTTP-запрос при периодическом опросе.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import player  # noqa: E402
import status  # noqa: E402


def main():
    payload = {"ok": True, "status": status.build()}
    try:
        payload["player"] = player.snapshot()
    except Exception as exc:  # noqa: BLE001
        payload["player"] = {"error": str(exc)[:200]}
    common.respond(200, payload)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка state.py: %s" % exc)
        except Exception:
            pass
