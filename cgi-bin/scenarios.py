#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Сценарии пульта: свои команды по образцу «Дома с Алисой».

    GET  /cgi-bin/scenarios.py                 — сценарии и готовые команды
    POST /cgi-bin/scenarios.py {"name","phrases","actions"} — создать/обновить
    POST /cgi-bin/scenarios.py {"delete":"Имя"} — удалить
    POST /cgi-bin/scenarios.py {"run":"Имя"}    — выполнить
    POST /cgi-bin/scenarios.py {"match":"текст"} — найти по фразе и выполнить

Действия — список объектов {"type": ..., ...}:
    speak      {"text"}          сказать голосом Алисы
    led        {"color"}         залить кольцо цветом
    led_off    {}                погасить кольцо
    radio      {"name"}          включить радиостанцию
    volume     {"value"}         громкость 0…100
    clock_text {"text"}          бегущая строка на дисплее
    vpn        {"on": true}      включить/выключить VPN
    llm        {"on": true}      включить/выключить нейросеть
    pause      {}                пауза плеера
    sleep      {"seconds"}       пауза перед следующим действием

Хранится в /data/mypult/scenarios.json (600).
"""

from __future__ import annotations

import datetime
import json
import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

try:
    import radio  # noqa: E402
except Exception:  # noqa: BLE001
    radio = None

STORE = "/data/mypult/scenarios.json"
TZ_PATH = "/data/mypult/tz.json"
LUNA = "http://127.0.0.1:8099"
BASE = "http://127.0.0.1:8055"
ACTION_TYPES = ("speak", "led", "led_off", "radio", "play_sound", "volume",
                "clock_text", "vpn", "llm", "pause", "sleep", "http")

BUILTIN = [
    {"phrase": "Алиса, включи впн", "what": "включает VPN"},
    {"phrase": "Алиса, выключи впн", "what": "выключает VPN"},
    {"phrase": "Алиса, включи нейросеть", "what": "включает LLM"},
    {"phrase": "Алиса, выключи нейросеть", "what": "выключает LLM"},
    {"phrase": "Алиса, включи радио …", "what": "отдаёт радио Алисе"},
    {"phrase": "Алиса, какие радио ты знаешь", "what": "перечисляет все станции"},
]


def load():
    try:
        with open(STORE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        items = data.get("scenarios") if isinstance(data, dict) else data
        return [item for item in (items or []) if isinstance(item, dict)]
    except (OSError, ValueError):
        return []


def save(items):
    common.write_json(STORE, {"scenarios": items}, indent=2)


def normalize(text):
    low = (text or "").lower().replace("ё", "е")
    low = re.sub(r"[^a-zа-я0-9 ]+", " ", low)
    low = re.sub(r"\s+", " ", low).strip()
    return re.sub(r"^(алиса|алеса|алекс)\s+", "", low)


def post_json(url, payload, timeout=30):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST",
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", "replace")
    return json.loads(body) if body.strip() else {}


def post_cgi(script, payload, timeout=30):
    return post_json(BASE + "/cgi-bin/" + script, payload, timeout)


def run_action(action):
    kind = action.get("type")
    if kind == "speak":
        # Голосовой запуск мог заглушить штатную Алису — вернуть звук.
        try:
            post_cgi("volume.py", {"unmute": 1}, timeout=8)
        except Exception:
            pass
        post_cgi("speak.py", {"text": str(action.get("text") or "")[:1900]}, timeout=30)
    elif kind == "led":
        color = str(action.get("color") or "#00E676")
        if not re.match(r"^#[0-9A-Fa-f]{6}$", color):
            color = "#00E676"
        post_json(LUNA + "/api/led/ring", {"colors": [color] * 24}, timeout=8)
    elif kind == "led_off":
        post_json(LUNA + "/api/led/off/ring", {}, timeout=8)
    elif kind == "radio":
        name = str(action.get("name") or "").strip()
        stations = radio.all_stations() if radio else []
        found = next((item for item in stations if item["name"].lower() == name.lower()), None)
        if found:
            post_cgi("radio.py", {"index": found["index"]}, timeout=40)
        elif name:
            post_cgi("command.py", {"text": "включи радио " + name}, timeout=25)
    elif kind == "play_sound":
        post_cgi("sounds.py", {"play_custom": str(action.get("name") or "")},
                 timeout=130)
    elif kind == "volume":
        post_cgi("volume.py", {"level": common.to_int(action.get("value"), 30, 0, 100)}, timeout=15)
    elif kind == "clock_text":
        text = str(action.get("text") or "")[:32]
        duration = min(15000, max(3000, 1000 + len(text) * 200))
        post_json(LUNA + "/api/clock/text",
                  {"text": text, "duration_ms": duration},
                  timeout=5 + duration / 1000.0)
    elif kind == "vpn":
        if common.truthy(action.get("on")):
            post_cgi("vpn.py", {"start": 1}, timeout=120)
        else:
            post_cgi("vpn.py", {"stop": 1}, timeout=30)
    elif kind == "llm":
        post_cgi("llm.py", {"enabled": 1 if common.truthy(action.get("on")) else 0}, timeout=15)
    elif kind == "pause":
        post_cgi("media.py", {"action": "pause"}, timeout=15)
    elif kind == "sleep":
        seconds = float(action.get("seconds") or 1)
        time.sleep(max(0.0, min(seconds, 10.0)))
    elif kind == "http":
        url = str(action.get("url") or "").strip()
        if not url.startswith(("http://", "https://")):
            raise RuntimeError("нужен http(s)-адрес")
        try:
            url = common.url_guard(url, allow_http=True, allow_private=True,
                                   allow_loopback=False)
        except ValueError as exc:
            raise RuntimeError("адрес запрещён: %s" % exc)
        request = urllib.request.Request(url, method="GET",
                                         headers={"User-Agent": "mypult-scenario"})
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read(1024)
    else:
        raise RuntimeError("неизвестное действие: %s" % kind)


def run_scenario(item):
    errors = []
    for action in item.get("actions") or []:
        try:
            run_action(action)
        except Exception as exc:  # noqa: BLE001
            errors.append("%s: %s" % (action.get("type"), exc))
    return {"ok": not errors, "errors": errors, "actions": len(item.get("actions") or [])}


def find_by_phrase(text):
    norm = normalize(text)
    if not norm:
        return None
    for item in load():
        for phrase in item.get("phrases") or []:
            if normalize(phrase) and normalize(phrase) in norm:
                return item
    return None


def load_tz():
    try:
        with open(TZ_PATH, "r", encoding="utf-8") as fh:
            return max(-12, min(int(json.load(fh).get("offset")), 14))
    except (OSError, ValueError, TypeError):
        return 0


def save_tz(offset):
    try:
        common.write_json(TZ_PATH, {"offset": max(-12, min(int(offset), 14))})
    except OSError:
        pass


def local_now():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=load_tz())


def parse_days(value):
    if not value:
        return []
    if isinstance(value, list):
        return [int(item) for item in value]
    days = set()
    for part in str(value).split(","):
        part = part.strip()
        if "-" in part:
            try:
                start, end = part.split("-", 1)
                days.update(range(int(start), int(end) + 1))
            except ValueError:
                continue
        elif part.isdigit():
            days.add(int(part))
    return sorted(day for day in days if 1 <= day <= 7)


def get_json(url, timeout=6):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


def conditions_ok(scenario):
    cond = scenario.get("conditions") or {}
    now = local_now()

    days = parse_days(cond.get("days"))
    if days and now.isoweekday() not in days:
        return False

    time_from = cond.get("time_from")
    time_to = cond.get("time_to")
    current = now.strftime("%H:%M")
    if time_from and current < time_from:
        return False
    if time_to and current > time_to:
        return False

    vpn = cond.get("vpn")
    if vpn in ("on", "off"):
        try:
            running = bool(get_json(BASE + "/cgi-bin/vpn.py?info=1").get("running"))
        except Exception:
            running = False
        if (vpn == "on") != running:
            return False

    music = cond.get("music")
    if music in ("playing", "paused"):
        try:
            playing = bool(get_json(BASE + "/cgi-bin/player.py").get("playing"))
        except Exception:
            playing = False
        if (music == "playing") != playing:
            return False

    return True


def scheduled_for(scenario, now):
    schedule = scenario.get("schedule") or {}
    when = str(schedule.get("time") or "").strip()
    if not when or when != now.strftime("%H:%M"):
        return False
    days = parse_days(schedule.get("days"))
    if days and now.isoweekday() not in days:
        return False
    return True


SCHED_STATE = "/tmp/mypult-sched.json"


def tick():
    now = local_now()
    stamp = now.strftime("%Y-%m-%d %H:%M")
    try:
        with open(SCHED_STATE, "r", encoding="utf-8") as fh:
            state = json.load(fh)
    except (OSError, ValueError):
        state = {}

    ran = []
    for scenario in load():
        if not scheduled_for(scenario, now):
            continue
        if state.get(scenario.get("name")) == stamp:
            continue
        if not conditions_ok(scenario):
            continue
        try:
            run_scenario(scenario)
            ran.append(scenario.get("name"))
        except Exception:
            pass
        state[scenario.get("name")] = stamp

    try:
        common.write_json(SCHED_STATE, state)
    except OSError:
        pass
    return ran


def validate(data, existing=None):
    name = str(data.get("name") or "").strip()
    if not (2 <= len(name) <= 40):
        raise ValueError("название: 2–40 символов")
    phrases = data.get("phrases") or []
    if isinstance(phrases, str):
        phrases = [part.strip() for part in phrases.split(",")]
    phrases = [str(item).strip() for item in phrases if str(item).strip()]
    if not phrases:
        raise ValueError("нужна хотя бы одна фраза")

    actions = data.get("actions") or []
    if not isinstance(actions, list) or not actions:
        raise ValueError("нужно хотя бы одно действие")
    clean = []
    for action in actions[:20]:
        if not isinstance(action, dict):
            continue
        kind = str(action.get("type") or "").strip()
        if kind not in ACTION_TYPES:
            raise ValueError("неизвестный тип действия: %s" % kind)
        item = {"type": kind}
        for key in ("text", "color", "name", "value", "seconds", "on", "url"):
            if key in action:
                item[key] = action[key]
        clean.append(item)
    if not clean:
        raise ValueError("действия не распознаны")

    schedule = {}
    raw_schedule = data.get("schedule") or {}
    if isinstance(raw_schedule, dict) and raw_schedule.get("time"):
        schedule = {
            "time": str(raw_schedule.get("time"))[:5],
            "days": parse_days(raw_schedule.get("days")),
        }

    conditions = {}
    raw_cond = data.get("conditions") or {}
    if isinstance(raw_cond, dict):
        days = parse_days(raw_cond.get("days"))
        if days:
            conditions["days"] = days
        for key in ("time_from", "time_to"):
            if raw_cond.get(key):
                conditions[key] = str(raw_cond.get(key))[:5]
        for key in ("vpn", "music"):
            if raw_cond.get(key) in ("on", "off", "playing", "paused"):
                conditions[key] = raw_cond.get(key)

    if data.get("tz_offset") is not None:
        save_tz(common.to_int(data.get("tz_offset"), 0, -12, 14))

    return {"name": name, "phrases": phrases, "actions": clean,
            "schedule": schedule, "conditions": conditions}


def main():
    data = common.params()

    if common.truthy(data.get("tick")):
        common.ok(ran=tick())
        return

    if data.get("delete") is not None:
        name = str(data.get("delete") or "").strip()
        items = [item for item in load() if item.get("name") != name]
        save(items)
        common.ok(deleted=name, scenarios=items)
        return

    if data.get("run") is not None:
        name = str(data.get("run") or "").strip()
        item = next((entry for entry in load() if entry.get("name") == name), None)
        if not item:
            common.fail(404, "Сценарий не найден: %s" % name)
            return
        common.respond(200, {"ran": name, "result": run_scenario(item)})
        return

    if data.get("match") is not None:
        item = find_by_phrase(str(data.get("match") or ""))
        if not item:
            common.ok(matched=None)
            return
        # Голосовой запуск: сначала гасим штатный диалог Алисы, иначе
        # первый speak встаёт в очередь за её TTS и действия перемешиваются.
        try:
            post_json(LUNA + "/api/alice/speech/cancel", {}, timeout=5)
        except Exception:
            pass
        time.sleep(0.35)
        common.respond(200, {"matched": item.get("name"), "result": run_scenario(item)})
        return

    if data.get("name") is not None:
        try:
            item = validate(data)
        except ValueError as exc:
            common.fail(400, str(exc))
            return
        items = [entry for entry in load() if entry.get("name") != item["name"]]
        items.append(item)
        save(items)
        common.respond(200, {"ok": True, "saved": item["name"], "scenarios": items})
        return

    common.respond(200, {"ok": True, "scenarios": load(), "builtin": BUILTIN,
                         "types": list(ACTION_TYPES)})


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка scenarios.py: %s" % exc)
        except Exception:
            pass
