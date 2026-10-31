#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Настройки голоса: потолок громкости ответов LLM.

    GET  /cgi-bin/voicecfg.py
    POST /cgi-bin/voicecfg.py {"max_volume": 20}
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

STORE = "/data/mypult/voice.json"


def load():
    try:
        with open(STORE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save(data):
    common.write_json(STORE, data)


def main():
    data = common.params()

    if data.get("max_volume") is not None:
        value = common.to_int(data.get("max_volume"), 45, 1, 100)
        config = load()
        config["max_volume"] = value
        save(config)
        common.ok(config=config)
        return

    common.ok(config=load(), max_volume=load().get("max_volume", 45))


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка voicecfg.py: %s" % exc)
        except Exception:
            pass
