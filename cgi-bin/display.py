#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Экран часов: реальное гашение LED-сегментов.

На Миди часы — это не framebuffer, а набор LED `cucumber:white:clock-*`
(45 сегментов). Luna `/api/clock/off` убирает только её слой, а сами
сегменты продолжают гореть, поэтому гасим их напрямую и запоминаем
прежнюю яркость каждого, чтобы вернуть рисунок как был.

    GET  /cgi-bin/display.py            — сколько сегментов горит
    POST /cgi-bin/display.py {"off":1}  — погасить
    POST /cgi-bin/display.py {"on":1}   — вернуть
"""

from __future__ import annotations

import glob
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

LED_GLOB = "/sys/class/leds/cucumber:white:clock-*/brightness"
BACKLIGHT = "/sys/class/backlight/fb0/brightness"
RING_CURRENT = (
    "/sys/bus/i2c/devices/1-0034/current",
    "/sys/bus/i2c/devices/1-0035/current",
)
SAVE = "/tmp/mypult-clock.json"
RING_STATE = "/data/mypult/ring.json"
AUTO_PATH = "/data/mypult/auto_brightness.json"


def paths():
    return sorted(glob.glob(LED_GLOB))


def read_int(path, default=0):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return default


def read_all():
    return {path: read_int(path) for path in paths()}


def write_all(values):
    written = 0
    for path, value in values.items():
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(str(max(0, min(int(value), 255))))
            written += 1
        except OSError:
            pass
    return written


def save_state(values):
    try:
        with open(SAVE, "w", encoding="utf-8") as fh:
            json.dump(values, fh)
    except OSError:
        pass


def load_state():
    try:
        with open(SAVE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return {str(k): int(v) for k, v in data.items() if os.path.exists(k)}
    except (OSError, ValueError, TypeError):
        return {}


def lit_count():
    return sum(1 for value in read_all().values() if value > 0)


def ring_backlight():
    """Подсветка framebuffer кольца: при 0 диоды не горят вообще."""
    try:
        with open(BACKLIGHT, "r", encoding="utf-8") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return None


def load_ring_brightness(default=255):
    try:
        with open(RING_STATE, "r", encoding="utf-8") as fh:
            value = int(json.load(fh).get("brightness"))
        return max(0, min(value, 255))
    except (OSError, ValueError, TypeError):
        return default


def save_ring_brightness(value):
    try:
        common.write_json(RING_STATE, {"brightness": value})
    except OSError:
        pass


RING_CURRENT_LEVEL = 80

def ring_current_on(level=RING_CURRENT_LEVEL):
    """Ток LED-контроллеров кольца: 0 — темно, 255 — максимум."""
    level = max(0, min(int(level), 255))
    result = []
    for path in RING_CURRENT:
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(str(level))
            result.append(level)
        except OSError:
            result.append(None)
    return result


def set_ring_brightness(value):
    """Яркость кольца = ток LED-контроллеров, подсветка fb0 всегда на максимум.

    Если писать яркость в fb0, драйвер на миг ставит ток = яркости и кольцо
    вспыхивает, а потом всё равно живёт на своём токе. Поэтому управляем
    именно током — это и есть реальная яркость.
    """
    value = max(0, min(int(value), 255))
    try:
        with open(BACKLIGHT, "w", encoding="utf-8") as fh:
            fh.write("255")
    except OSError:
        pass
    ring_current_on(value)
    save_ring_brightness(value)
    return value


def ring_backlight_on(level=None):
    if level is None:
        level = load_ring_brightness()
    return set_ring_brightness(level)


def ring_current():
    values = []
    for path in RING_CURRENT:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                values.append(int(fh.read().strip()))
        except (OSError, ValueError):
            values.append(None)
    return values


def load_auto():
    defaults = {"enabled": False, "min": 10, "max": 150}
    try:
        with open(AUTO_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        defaults.update({key: data[key] for key in ("enabled", "min", "max") if key in data})
    except (OSError, ValueError, TypeError):
        pass
    defaults["enabled"] = bool(defaults.get("enabled"))
    defaults["min"] = max(0, min(int(defaults.get("min", 10)), 255))
    defaults["max"] = max(defaults["min"], min(int(defaults.get("max", 150)), 255))
    return defaults


def save_auto(config):
    try:
        common.write_json(AUTO_PATH, config)
    except OSError:
        pass


def ambient_lux():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8099/api/sensors", timeout=4) as response:
            sensors = json.loads(response.read().decode("utf-8"))
        for item in sensors:
            if isinstance(item, dict) and item.get("kind") == "ambient_light":
                return float(item.get("value") or 0)
    except Exception:  # noqa: BLE001
        pass
    return None


def auto_apply():
    config = load_auto()
    if not config["enabled"]:
        return None
    lux = ambient_lux()
    if lux is None:
        return None
    ratio = max(0.0, min(lux / 200.0, 1.0)) ** 0.6
    level = int(round(config["min"] + (config["max"] - config["min"]) * ratio))
    set_ring_brightness(level)
    return {"lux": lux, "level": level}


def main():
    data = common.params()

    if common.truthy(data.get("backlight")):
        value = ring_backlight_on()
        current = ring_current()
        common.ok(backlight=value, current=current)
        return

    if data.get("ring_brightness") is not None:
        value = set_ring_brightness(common.to_int(data.get("ring_brightness"), RING_CURRENT_LEVEL, 0, 255))
        current = ring_current()
        common.ok(backlight=value, current=current)
        return

    if common.truthy(data.get("restore")):
        value = ring_backlight_on(load_ring_brightness())
        common.ok(backlight=value)
        return

    if common.truthy(data.get("save")):
        # Запомнить текущий рисунок (после синхронизации времени Luna),
        # чтобы «включить экран» не вернуло старое время.
        save_state(read_all())
        common.ok(saved=True, lit=lit_count())
        return

    if data.get("auto_brightness") is not None:
        config = load_auto()
        config["enabled"] = common.truthy(data.get("auto_brightness"))
        if data.get("min") is not None:
            config["min"] = common.to_int(data.get("min"), config["min"], 0, 255)
        if data.get("max") is not None:
            config["max"] = common.to_int(data.get("max"), config["max"], 0, 255)
        save_auto(config)
        common.ok(auto=load_auto())
        return

    if common.truthy(data.get("auto_tick")):
        common.ok(auto=auto_apply())
        return

    if common.truthy(data.get("off")):
        values = read_all()
        # Если часы уже погашены, не затираем сохранённый «живой» рисунок нулями.
        if any(value > 0 for value in values.values()):
            save_state(values)
        write_all({path: 0 for path in values})
        common.ok(off=True, segments=len(values), lit=0)
        return

    if common.truthy(data.get("on")):
        saved = load_state()
        if not saved:
            # Не зажигаем все 45 сегментов «на всякий случай»: если рисунка
            # нет, экран просто остаётся тёмным до синхронизации/рисования.
            common.ok(off=False, segments=len(paths()), lit=lit_count(),
                      note="нет сохранённого рисунка")
            return
        written = write_all(saved)
        lit = lit_count()
        time_text = str(data.get("time") or "").strip()
        if lit == 0 and time_text:
            # Рисунок не восстановился — просим Luna нарисовать время заново.
            try:
                import json as _json
                import urllib.request as _ur
                body = _json.dumps({"time": time_text, "brightness": 170}).encode()
                req = _ur.Request("http://127.0.0.1:8099/api/clock", data=body,
                                  headers={"Content-Type": "application/json"}, method="POST")
                _ur.urlopen(req, timeout=6).read()
                lit = lit_count()
            except Exception:  # noqa: BLE001
                pass
        common.ok(off=False, segments=written, lit=lit)
        return

    common.ok(
        segments=len(paths()),
        lit=lit_count(),
        saved=bool(load_state()),
        available=bool(paths()),
        backlight=ring_backlight(),
        ring_brightness=load_ring_brightness(),
        current=ring_current(),
        auto=load_auto(),
    )


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка display.py: %s" % exc)
        except Exception:
            pass
