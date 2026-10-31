#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Текстовая команда Алисе через локальный glagol (`sendText`).

    POST /cgi-bin/command.py {"text": "Алиса, какая погода?"}

Luna `/api/alice/command` для этого не подходит (long-poll, POST запрещён),
поэтому команда уходит в glagol тем же путём, что и у Home Assistant.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

try:
    import glagol  # noqa: E402
except Exception:  # noqa: BLE001
    glagol = None


def main():
    data = common.params()
    text = (data.get("text") or "").strip()

    if not text:
        common.fail(400, "Пустой текст", hint='Передайте {"text": "Алиса, ..."}')
        return
    if len(text) > 500:
        common.fail(413, "Команда длиннее 500 символов")
        return
    if glagol is None:
        common.fail(501, "Модуль glagol недоступен", hint="проверьте cgi-bin/glagol.py")
        return

    try:
        reply = glagol.send({"command": "sendText", "text": text}, timeout=20)
    except glagol.GlagolError as exc:
        common.fail(
            502,
            "Не удалось отправить команду: %s" % exc,
            hint="Токен glagol берётся из account_storage.dat; проверьте diag.py",
        )
        return

    common.ok(
        text=text,
        confirmed=reply is not None,
        reply=reply,
    )


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка command.py: %s" % exc)
        except Exception:
            pass
