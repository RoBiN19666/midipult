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
DISPLAY_STATE = "/data/mypult/display.json"
MODE_PATH = "/data/mypult/display_mode.json"
AUTO_PATH = "/data/mypult/auto_brightness.json"
LUNA_CLOCK = common.LUNA_BASE + "/api/clock"
DEFAULT_DISPLAY_BRIGHTNESS = 170
DEFAULT_RING_BRIGHTNESS = 255


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


def load_display_brightness(default=170):
    try:
        with open(DISPLAY_STATE, "r", encoding="utf-8") as fh:
            value = int(json.load(fh).get("brightness"))
        return max(10, min(value, 255))
    except (OSError, ValueError, TypeError):
        return default


def save_display_brightness(value):
    try:
        common.write_json(DISPLAY_STATE, {"brightness": max(10, min(int(value), 255))})
    except (OSError, ValueError, TypeError):
        pass


def load_mode():
    try:
        with open(MODE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return {"manual": bool(data.get("manual")), "kind": str(data.get("kind") or "clock")}
    except (OSError, ValueError, TypeError):
        return {"manual": False, "kind": "clock"}


def save_mode(manual, kind="clock"):
    try:
        common.write_json(MODE_PATH, {"manual": bool(manual), "kind": str(kind)})
    except OSError:
        pass


def segment_brightness(value):
    """Яркость уже нарисованного содержимого: 0 остаётся 0, горящие — value."""
    value = max(10, min(int(value), 255))
    changed = 0
    for path, current in read_all().items():
        if current <= 0:
            continue
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(str(value))
            changed += 1
        except OSError:
            pass
    if changed:
        # При погашенном экране все сегменты = 0; не затираем сохранённый
        # рисунок, иначе «включить экран» вернёт чёрный дисплей.
        save_state(read_all())
    save_display_brightness(value)
    return changed


def luna_clock(brightness, time_text=None):
    """Яркость дисплея без установки времени (время ставит Алиса/Luna)."""
    payload = {"brightness": max(10, min(int(brightness), 255))}
    if time_text:
        payload["time"] = time_text
    try:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(LUNA_CLOCK, data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=6).read()
        return payload
    except Exception:  # noqa: BLE001
        return None


def sync_display(brightness=None):
    """Яркость/рисунок дисплея; время панель не переставляет."""
    value = load_display_brightness() if brightness is None else int(brightness)
    value = max(10, min(value, 255))
    payload = luna_clock(value)
    if payload:
        save_display_brightness(value)
        save_state(read_all())
        save_mode(False, "clock")
    return payload


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
    defaults = {"enabled": False, "min": 10, "max": 150,
                "display_enabled": False, "display_min": 10, "display_max": 170}
    try:
        with open(AUTO_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        defaults.update({key: data[key] for key in defaults if key in data})
    except (OSError, ValueError, TypeError):
        pass
    defaults["enabled"] = bool(defaults.get("enabled"))
    defaults["min"] = max(0, min(int(defaults.get("min", 10)), 255))
    defaults["max"] = max(defaults["min"], min(int(defaults.get("max", 150)), 255))
    defaults["display_enabled"] = bool(defaults.get("display_enabled"))
    defaults["display_min"] = max(10, min(int(defaults.get("display_min", 10)), 255))
    defaults["display_max"] = max(defaults["display_min"],
                                  min(int(defaults.get("display_max", 170)), 255))
    return defaults


def save_auto(config):
    try:
        common.write_json(AUTO_PATH, config)
    except OSError:
        pass


def ambient_lux():
    try:
        with urllib.request.urlopen(common.LUNA_BASE + "/api/sensors", timeout=4) as response:
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


def display_auto_apply():
    """Автояркость дисплея: тот же датчик lux, яркость уходит в Luna."""
    config = load_auto()
    if not config["display_enabled"]:
        return {"applied": False, "reason": "disabled"}
    if load_mode().get("manual"):
        return {"applied": False, "reason": "manual"}
    lux = ambient_lux()
    if lux is None:
        return {"applied": False, "reason": "sensor"}
    ratio = max(0.0, min(lux / 200.0, 1.0)) ** 0.6
    level = int(round(config["display_min"] + (config["display_max"] - config["display_min"]) * ratio))
    payload = luna_clock(level)
    if payload:
        save_state(read_all())
    return {"lux": lux, "level": level, "applied": bool(payload)}


def reset_display():
    """Сброс настроек дисплея и возврат управления Алисе/Luna."""
    save_display_brightness(DEFAULT_DISPLAY_BRIGHTNESS)
    segment_brightness(DEFAULT_DISPLAY_BRIGHTNESS)
    config = load_auto()
    config["display_enabled"] = False
    config["display_min"] = 10
    config["display_max"] = 170
    save_auto(config)
    save_mode(False, "clock")
    try:
        os.remove(SAVE)
    except OSError:
        pass
    return {"brightness": DEFAULT_DISPLAY_BRIGHTNESS,
            "mode": load_mode(), "auto": load_auto()}


def reset_ring():
    """Сброс только кольца: яркость/автояркость кольца; дисплей не трогаем."""
    value = set_ring_brightness(DEFAULT_RING_BRIGHTNESS)
    config = load_auto()
    config["enabled"] = False
    config["min"] = 10
    config["max"] = 150
    save_auto(config)
    return {"ring_brightness": value, "auto": load_auto()}


def main():
    data = common.params()

    if common.truthy(data.get("reset_display")):
        # Не восстанавливаем сохранённый рисунок/время: дисплей снова
        # отдаётся Алисе/Luna, панель только сбрасывает свои настройки.
        common.ok(**reset_display())
        return

    if common.truthy(data.get("reset_ring")):
        common.ok(**reset_ring())
        return

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

    if data.get("segments_brightness") is not None:
        value = common.to_int(data.get("segments_brightness"), load_display_brightness(), 10, 255)
        changed = segment_brightness(value)
        common.ok(brightness=value, segments=changed)
        return

    if data.get("manual") is not None:
        save_mode(common.truthy(data.get("manual")), str(data.get("kind") or "manual"))
        common.ok(manual=load_mode())
        return

    if data.get("brightness") is not None:
        value = common.to_int(data.get("brightness"), load_display_brightness(), 10, 255)
        payload = sync_display(value)
        common.ok(brightness=value, time=(payload or {}).get("time"), synced=bool(payload))
        return

    if common.truthy(data.get("save")):
        # Запомнить текущий рисунок, чтобы «включить экран» не вернул пустоту.
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

    if data.get("display_auto_brightness") is not None:
        config = load_auto()
        config["display_enabled"] = common.truthy(data.get("display_auto_brightness"))
        if data.get("display_min") is not None:
            config["display_min"] = common.to_int(data.get("display_min"), config["display_min"], 10, 255)
        if data.get("display_max") is not None:
            config["display_max"] = common.to_int(data.get("display_max"), config["display_max"], 10, 255)
        save_auto(config)
        applied = display_auto_apply() if config["display_enabled"] else None
        common.ok(auto=load_auto(), display=applied, mode=load_mode())
        return

    if common.truthy(data.get("auto_tick")):
        ring = auto_apply()
        display = display_auto_apply()
        common.ok(auto=load_auto(), ring=ring, display=display)
        return

    if common.truthy(data.get("off")):
        save_mode(True, "off")
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
            # нет, экран просто остаётся тёмным до рисования.
            common.ok(off=False, segments=len(paths()), lit=lit_count(),
                      note="нет сохранённого рисунка")
            return
        written = write_all(saved)
        # Если автояркость включена, после включения экрана не залипаем в
        # manual: auto_tick снова начнёт управлять яркостью.
        save_mode(not load_auto()["display_enabled"], "restore")
        lit = lit_count()
        common.ok(off=False, segments=written, lit=lit)
        return

    common.ok(
        segments=len(paths()),
        lit=lit_count(),
        saved=bool(load_state()),
        available=bool(paths()),
        backlight=ring_backlight(),
        ring_brightness=load_ring_brightness(),
        display_brightness=load_display_brightness(),
        current=ring_current(),
        auto=load_auto(),
        mode=load_mode(),
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
