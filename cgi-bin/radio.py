#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Интернет-радио через штатный плеер станции.

    GET  /cgi-bin/radio.py                  — список станций (встроенные + свои)
    POST /cgi-bin/radio.py {"index":3}      — включить станцию
    POST /cgi-bin/radio.py {"stop":1}       — выключить
    POST /cgi-bin/radio.py {"add":"Радио X"} — добавить свой канал
    POST /cgi-bin/radio.py {"remove":"Радио X"} — удалить свой канал

Станция сама умеет играть радио по фразе «включи радио …», поэтому мы
не тянем потоки в обход: отправляем текст в Glagol и читаем состояние
плеера. Свои каналы хранятся в /data/mypult/radio.json.
"""

from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

try:
    import glagol  # noqa: E402
except Exception:  # noqa: BLE001
    glagol = None

CUSTOM_FILE = "/data/mypult/radio.json"

# (id, подпись в пульте, фраза для Алисы)
BUILTIN = [
    ("europa", "Европа Плюс", "Европа Плюс"),
    ("record", "Радио Рекорд", "Радио Рекорд"),
    ("dfm", "DFM", "DFM"),
    ("russian", "Русское радио", "Русское радио"),
    ("mayak", "Маяк", "Маяк"),
    ("retro", "Ретро FM", "Ретро FM"),
    ("avtoradio", "Авторадио", "Авторадио"),
    ("humor", "Юмор FM", "Юмор FM"),
    ("love", "Love Radio", "Love Radio"),
    ("dacha", "Радио Дача", "Радио Дача"),
    ("nashe", "Наше радио", "Наше радио"),
    ("relax", "Relax FM", "Relax FM"),
    ("vesti", "Вести FM", "Вести FM"),
    ("dorozhnoe", "Дорожное радио", "Дорожное радио"),
    ("shanson", "Радио Шансон", "Радио Шансон"),
    ("radio_si", "Радио Си (ЕКБ)", "Радио Си"),
    ("silver", "Серебряный дождь", "Серебряный дождь"),
    ("business", "Business FM", "Business FM"),
    ("kids", "Детское радио", "Детское радио"),
    ("rock", "ROCK FM", "Rock FM"),
    ("militia", "Милицейская волна", "Милицейская волна"),
    ("vera", "Радио Вера", "Радио Вера"),
    ("zvezda", "Радио Звезда", "Радио Звезда"),
    ("comedy", "Comedy Radio", "Comedy Radio"),
    ("energy", "Радио ENERGY", "Радио ENERGY"),
    ("monte", "Монте-Карло", "Монте-Карло"),
    ("jazz", "Радио JAZZ", "Джаз FM"),
    ("culture", "Радио Культура", "Радио Культура"),
    ("orfeus", "Орфей", "Орфей"),
]


def load_custom():
    try:
        with open(CUSTOM_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            data = data.get("stations") or []
        return [str(item).strip() for item in data if str(item).strip()]
    except (OSError, ValueError):
        return []


def save_custom(names):
    common.write_json(CUSTOM_FILE, {"stations": names}, indent=2)


def all_stations():
    result = [
        {"index": i, "id": item[0], "name": item[1], "query": item[2], "custom": False}
        for i, item in enumerate(BUILTIN)
    ]
    for name in load_custom():
        if any(item["name"] == name for item in result):
            continue
        result.append({
            "index": len(result), "id": "custom", "name": name,
            "query": name, "custom": True,
        })
    return result


def state_brief():
    reply = glagol.send({"command": "softwareVersion"}, timeout=12)
    state = (reply or {}).get("state") or {}
    player = state.get("playerState") or {}
    return {
        "playing": bool(state.get("playing")),
        "alice": state.get("aliceState"),
        "title": player.get("title"),
        "kind": player.get("type"),
        "volume": state.get("volume"),
    }


def main():
    if glagol is None:
        common.fail(501, "Модуль glagol недоступен")
        return

    data = common.params()

    if common.truthy(data.get("stop")):
        try:
            glagol.send({"command": "stop"}, timeout=10)
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "Не удалось остановить: %s" % exc)
            return
        common.ok(playing=False)
        return

    if data.get("add") is not None:
        name = str(data.get("add") or "").strip()
        if not (2 <= len(name) <= 40):
            common.fail(400, "Название канала: от 2 до 40 символов")
            return
        custom = load_custom()
        if name not in custom:
            custom.append(name)
            save_custom(custom)
        common.ok(added=name, stations=all_stations())
        return

    if data.get("remove") is not None:
        name = str(data.get("remove") or "").strip()
        custom = [item for item in load_custom() if item != name]
        save_custom(custom)
        common.ok(removed=name, stations=all_stations())
        return

    if data.get("index") is not None:
        stations = all_stations()
        index = common.to_int(data.get("index"), 0, 0, len(stations) - 1)
        station = stations[index]
        try:
            glagol.send({"command": "sendText", "text": "включи радио " + station["query"]}, timeout=20)
            time.sleep(2.5)
            brief = state_brief()
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "Радио не включилось: %s" % exc)
            return
        brief["station"] = {"index": index, "name": station["name"]}
        common.respond(200, brief)
        return

    common.respond(200, {"ok": True, "stations": all_stations()})


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка radio.py: %s" % exc)
        except Exception:
            pass
