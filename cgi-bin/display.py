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
import math
from datetime import datetime, timezone
import os
import re
import signal
import subprocess
import sys
import time
import urllib.request

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

LED_GLOB = "/sys/class/leds/cucumber:white:clock-*/brightness"
BACKLIGHT = "/sys/class/backlight/fb0/brightness"
LED_UTIL = "/system/vendor/quasar/led_util"
LED_LIBS = "/system/vendor/quasar/libs"
ANIM_DIRS = (
    "/system/vendor/quasar/ledpatterns/ring",
    "/system/vendor/quasar/ledpatterns/oknix",
)
CUSTOM_ANIM_DIR = "/data/mypult/ring_anims"
RING_HIDDEN = "/data/mypult/ring_hidden.json"
ANIM_PID = "/tmp/mypult-ringanim.pid"
ANIM_NAME = "/tmp/mypult-ringanim.name"
CLOCK_ANIM_PID = "/tmp/mypult-clockanim.pid"
CLOCK_ANIM_FILE = "/tmp/mypult-clockanim.json"
CLOCK_ANIM_SCRIPT = "/data/mypult/clockanimd.py"
RING_CURRENT = (
    "/sys/bus/i2c/devices/1-0034/current",
    "/sys/bus/i2c/devices/1-0035/current",
)
SAVE = "/tmp/mypult-clock.json"
CLOCK_ANIMS = "/data/mypult/clock_anims.json"
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


TZ_SOURCES = (
    ("/data/mypult/alarms.json", "timezone"),
    ("/data/mypult/llm.json", "timezone"),
)


def timezone_name():
    """Часовой пояс пользователя: он же используется для будильников."""
    for path, key in TZ_SOURCES:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                value = json.load(fh).get(key)
        except (OSError, ValueError, TypeError):
            continue
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def format_clock(moment, tz_name=""):
    """Время для LED-часов в поясе пользователя, а не в UTC станции."""
    if tz_name and ZoneInfo is not None:
        try:
            moment = moment.astimezone(ZoneInfo(tz_name))
        except Exception:  # noqa: BLE001
            pass
    return moment.strftime("%H:%M")


def clock_text():
    return format_clock(datetime.now(timezone.utc), timezone_name())


def luna_clock(brightness, time_text=None):
    """Яркость дисплея; Luna требует time или segments даже для яркости."""
    payload = {"brightness": max(10, min(int(brightness), 255))}
    payload["time"] = time_text or clock_text()
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


def default_display_curve(min_level=10, max_level=170):
    """Кривая по умолчанию: темно → min, 200 lux → max."""
    mid = int(round((int(min_level) + int(max_level)) / 2))
    return [[0, int(min_level)], [50, mid], [200, int(max_level)]]


def clean_curve(raw):
    """Привести кривую к [[lux, level], …]: 2–16 точек, по возрастанию lux."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    if not isinstance(raw, list):
        return []
    points = []
    for item in raw:
        if isinstance(item, dict):
            lux, level = item.get("lux"), item.get("level")
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            lux, level = item[0], item[1]
        else:
            continue
        try:
            lux = max(0.0, min(float(lux), 100000.0))
            level = max(10, min(int(float(level)), 255))
        except (TypeError, ValueError):
            continue
        points.append([lux, level])
    points.sort(key=lambda pair: pair[0])
    result = []
    for point in points:
        if result and abs(point[0] - result[-1][0]) < 1e-6:
            result[-1] = point
        else:
            result.append(point)
    return result[:16]


def curve_level(lux, curve):
    """Яркость по кривой: линейно между точками в логарифме освещённости."""
    if not curve:
        return None
    try:
        lum = math.log10(max(0.0, float(lux)) + 1.0)
    except (TypeError, ValueError):
        return None
    if lum <= math.log10(curve[0][0] + 1.0):
        return int(curve[0][1])
    if lum >= math.log10(curve[-1][0] + 1.0):
        return int(curve[-1][1])
    for left, right in zip(curve, curve[1:]):
        x1 = math.log10(left[0] + 1.0)
        x2 = math.log10(right[0] + 1.0)
        if x1 <= lum <= x2:
            ratio = (lum - x1) / (x2 - x1) if x2 > x1 else 0.0
            return int(round(left[1] + (right[1] - left[1]) * ratio))
    return int(curve[-1][1])


def load_auto():
    defaults = {"enabled": False, "min": 10, "max": 150,
                "display_enabled": False, "display_min": 10, "display_max": 170,
                "display_curve": []}
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
    curve = clean_curve(defaults.get("display_curve"))
    defaults["display_curve"] = curve or default_display_curve(
        defaults["display_min"], defaults["display_max"])
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
    # Автояркость в полной темноте не должна гасить кольцо почти в ноль:
    # иначе штатная анимация музыки визуально исчезает.
    level = max(60, min(level, 255))
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
    level = curve_level(lux, config.get("display_curve"))
    if level is None:
        ratio = max(0.0, min(lux / 200.0, 1.0)) ** 0.6
        level = int(round(config["display_min"] +
                          (config["display_max"] - config["display_min"]) * ratio))
    level = max(10, min(int(level), 255))
    payload = luna_clock(level)
    if payload:
        save_state(read_all())
    return {"lux": lux, "level": level, "applied": bool(payload),
            "reason": "" if payload else "luna"}


def reset_display():
    """Сброс настроек дисплея и возврат управления Алисе/Luna."""
    save_display_brightness(DEFAULT_DISPLAY_BRIGHTNESS)
    segment_brightness(DEFAULT_DISPLAY_BRIGHTNESS)
    config = load_auto()
    config["display_enabled"] = False
    config["display_min"] = 10
    config["display_max"] = 170
    save_auto(config)
    # Снимаем ручной режим: иначе после «сброса» панель продолжает считать,
    # что дисплеем управляет пользователь, и не возвращает часы Алисе.
    save_mode(False, "clock")
    try:
        os.remove(SAVE)
    except OSError:
        pass
    # Важно: просто стереть состояние и вернуть mode=clock мало — если экран
    # был погашен или на нём остался кадр анимации, он таким и останется.
    # Рисуем текущее время через Luna, чтобы сброс действительно вернул часы.
    payload = sync_display(DEFAULT_DISPLAY_BRIGHTNESS)
    return {"brightness": DEFAULT_DISPLAY_BRIGHTNESS,
            "time": (payload or {}).get("time"),
            "synced": bool(payload),
            "mode": load_mode(), "auto": load_auto()}


def restore_clock(brightness=None):
    """Вернуть часы Luna с текущим временем и нормальной яркостью.

    Нужен после анимации/рисунка: сохранённый набор сегментов может быть
    старым кадром (неправильное время) или иметь низкую яркость.
    """
    value = load_display_brightness() if brightness is None else int(brightness)
    value = max(10, min(value, 255))
    clock_anim_stop()
    payload = sync_display(value)
    return {"brightness": value, "time": (payload or {}).get("time"),
            "synced": bool(payload), "mode": load_mode()}


def luna_ring_off():
    """Погасить кольцо штатным API Luna (без своего framebuffer)."""
    try:
        request = urllib.request.Request(
            common.LUNA_BASE + "/api/led/off/ring",
            data=b"{}", method="POST",
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=6) as response:
            response.read(1024)
        return True
    except Exception:  # noqa: BLE001
        return False


def reset_ring():
    """Сброс только кольца: выключить, вернуть яркость, снять автояркость."""
    animation_stop()
    luna_ring_off()
    value = set_ring_brightness(DEFAULT_RING_BRIGHTNESS)
    config = load_auto()
    config["enabled"] = False
    config["min"] = 10
    config["max"] = 150
    save_auto(config)
    return {"ring_brightness": value, "auto": load_auto(), "off": True}


def hidden_ring_anims():
    data = common.read_json(RING_HIDDEN, {"names": []}) or {}
    names = data.get("names")
    return [str(item) for item in names] if isinstance(names, list) else []


def save_hidden_ring_anims(names):
    common.write_json(RING_HIDDEN, {"names": [str(item) for item in names]})


def ring_animations():
    """Анимации кольца из прошивки и свои из /data/mypult/ring_anims."""
    items = []
    for folder in ANIM_DIRS + (CUSTOM_ANIM_DIR,):
        try:
            names = sorted(os.listdir(folder))
        except OSError:
            continue
        for name in names:
            if name.endswith(".led"):
                base = name[:-4]
            elif name.endswith(".binscled.zst"):
                base = name[: -len(".binscled.zst")]
            else:
                continue
            items.append({"name": base, "path": os.path.join(folder, name),
                          "custom": folder == CUSTOM_ANIM_DIR})
    return items


def ring_anim_path(name):
    safe = re.sub(r"[^\w .-]+", "", str(name or ""), flags=re.UNICODE).strip()[:40]
    if len(safe) < 2:
        raise ValueError("название анимации: 2–40 символов")
    return safe, os.path.join(CUSTOM_ANIM_DIR, safe + ".led")


def clean_ring_frames(raw):
    if not isinstance(raw, list) or not 1 <= len(raw) <= 60:
        raise ValueError("нужно от 1 до 60 кадров")
    frames = []
    for frame in raw:
        if not isinstance(frame, list) or len(frame) != 24:
            raise ValueError("в кадре должно быть 24 цвета")
        colors = []
        for color in frame:
            value = str(color or "").strip().lstrip("#")
            if not re.fullmatch(r"[0-9a-fA-F]{6}", value):
                raise ValueError("цвет должен быть RRGGBB")
            colors.append(value.lower())
        frames.append(colors)
    return frames


def save_ring_anim(data):
    name, path = ring_anim_path(data.get("name"))
    frames = clean_ring_frames(data.get("frames"))
    duration = common.to_int(data.get("duration"), 50, 10, 5000)
    existing = [item for item in ring_animations()
                if item["name"] == name and not item.get("custom")]
    if existing:
        raise ValueError("такая анимация уже есть в прошивке — выберите другое имя")
    os.makedirs(CUSTOM_ANIM_DIR, exist_ok=True)
    lines = ["loop"]
    tail = "%x" % duration
    for frame in frames:
        lines.append(" ".join(frame) + " " + tail)
    with open(path, "w", encoding="ascii") as fh:
        fh.write("\n".join(lines) + "\n")
    return {"name": name, "path": path}


def delete_ring_anim(name):
    safe, path = ring_anim_path(name)
    if not os.path.isfile(path):
        raise ValueError("нет такой своей анимации")
    try:
        os.remove(path)
    except OSError as exc:
        raise RuntimeError(str(exc)) from exc
    return safe


def animation_pid():
    try:
        with open(ANIM_PID, "r", encoding="utf-8") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return None


def animation_name():
    pid = animation_pid()
    if not pid or not _pid_alive(pid):
        return None
    try:
        with open(ANIM_NAME, "r", encoding="utf-8") as fh:
            return fh.read().strip() or None
    except OSError:
        return None


def animation_stop():
    pid = animation_pid()
    if pid:
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                os.kill(pid, sig)
            except OSError:
                break
            for _ in range(10):
                if not _pid_alive(pid):
                    break
                time.sleep(0.1)
            if not _pid_alive(pid):
                break
        if _pid_alive(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
    try:
        os.remove(ANIM_PID)
    except OSError:
        pass
    try:
        os.remove(ANIM_NAME)
    except OSError:
        pass
    return True


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def animation_play(name):
    """Проиграть анимацию прошивки; имя сверяется со списком файлов."""
    entries = [item for item in ring_animations() if item["name"] == name]
    if not entries:
        raise ValueError("нет такой анимации кольца")
    if not os.path.isfile(LED_UTIL):
        raise RuntimeError("нет %s" % LED_UTIL)
    animation_stop()
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = LED_LIBS
    try:
        proc = subprocess.Popen(
            [LED_UTIL, entries[0]["path"]],
            env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True, close_fds=True,
        )
    except OSError as exc:
        raise RuntimeError("led_util не запустился: %s" % exc) from exc
    with open(ANIM_PID, "w", encoding="utf-8") as fh:
        fh.write(str(proc.pid))
    with open(ANIM_NAME, "w", encoding="utf-8") as fh:
        fh.write(name)
    time.sleep(0.4)
    if proc.poll() is not None:
        animation_stop()
        raise RuntimeError("led_util завершился сразу (файл анимации не подошёл?)")
    return proc.pid


def clock_anim_stop():
    try:
        with open(CLOCK_ANIM_PID, "r", encoding="utf-8") as fh:
            pid = int(fh.read().strip())
    except (OSError, ValueError):
        pid = None
    if pid:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.kill(pid, sig)
            except OSError:
                break
            time.sleep(0.1)
    for path in (CLOCK_ANIM_PID, CLOCK_ANIM_FILE):
        try:
            os.remove(path)
        except OSError:
            pass
    return True


def luna_clock_off():
    """Убрать слой часов Luna перед кадрами анимации."""
    try:
        req = urllib.request.Request(
            common.LUNA_BASE + "/api/clock/off", data=b"{}", method="POST",
            headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5).read()
        return True
    except Exception:  # noqa: BLE001
        return False


def clock_anim_play(frames, duration):
    if not frames:
        raise ValueError("нет кадров анимации")
    if not os.path.isfile(CLOCK_ANIM_SCRIPT):
        raise RuntimeError("нет %s" % CLOCK_ANIM_SCRIPT)
    clock_anim_stop()
    luna_clock_off()
    with open(CLOCK_ANIM_FILE, "w", encoding="utf-8") as fh:
        json.dump({"frames": frames, "duration": duration}, fh)
    proc = subprocess.Popen(
        [sys.executable, CLOCK_ANIM_SCRIPT, CLOCK_ANIM_FILE],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True,
    )
    with open(CLOCK_ANIM_PID, "w", encoding="utf-8") as fh:
        fh.write(str(proc.pid))
    time.sleep(0.2)
    if proc.poll() is not None:
        clock_anim_stop()
        raise RuntimeError("проигрыватель анимации завершился сразу")
    return proc.pid


def clock_anims():
    data = common.read_json(CLOCK_ANIMS, {"items": []}) or {}
    items = data.get("items")
    return items if isinstance(items, list) else []


def hidden_clock_presets():
    data = common.read_json(CLOCK_ANIMS, {"items": []}) or {}
    hidden = data.get("hidden_presets")
    return [str(item) for item in hidden] if isinstance(hidden, list) else []


def save_clock_anims(items):
    data = common.read_json(CLOCK_ANIMS, {"items": []}) or {}
    data["items"] = items
    common.write_json(CLOCK_ANIMS, data)


def save_hidden_clock_presets(items):
    data = common.read_json(CLOCK_ANIMS, {"items": []}) or {}
    data["hidden_presets"] = [str(item) for item in items]
    common.write_json(CLOCK_ANIMS, data)


def clean_clock_anim(raw):
    if not isinstance(raw, dict):
        raise ValueError("анимация должна быть объектом")
    name = str(raw.get("name") or "").strip()[:40]
    if not name:
        raise ValueError("укажите название анимации")
    frames = raw.get("frames")
    if not isinstance(frames, list) or not 1 <= len(frames) <= 60:
        raise ValueError("нужно от 1 до 60 кадров")
    clean = []
    for frame in frames:
        if not isinstance(frame, list) or len(frame) != 4:
            raise ValueError("в кадре должно быть 4 цифры")
        digits = []
        for part in frame:
            segments = "".join(ch for ch in str(part or "") if ch in "abcdefg")
            digits.append("".join(sorted(set(segments))))
        clean.append(digits)
    duration = max(50, min(5000, common.to_int(raw.get("duration"), 300, 50, 5000)))
    return {
        "id": str(raw.get("id") or "anim-%d" % int(time.time() * 1000)),
        "name": name,
        "frames": clean,
        "duration": duration,
    }


def anim_preview(name, limit=24):
    """Кадры .led для превью в панели: текст «RRGGBB» по 24 штуки на кадр."""
    entries = [item for item in ring_animations() if item["name"] == name]
    if not entries:
        raise ValueError("нет такой анимации кольца")
    path = entries[0]["path"]
    if not path.endswith(".led"):
        raise ValueError("предпросмотр есть только у .led")
    try:
        with open(path, "r", encoding="ascii", errors="ignore") as fh:
            text = fh.read(400_000)
    except OSError as exc:
        raise RuntimeError("не читается анимация: %s" % exc) from exc
    tokens = re.findall(r"\b[0-9a-fA-F]{6}\b", text)
    frames = [tokens[index:index + 24]
              for index in range(0, len(tokens), 24)]
    frames = [frame for frame in frames if len(frame) == 24]
    if not frames:
        raise ValueError("не удалось разобрать кадры анимации")
    total = len(frames)
    if total > limit:
        step = total / float(limit)
        frames = [frames[int(index * step)] for index in range(limit)]
    return {
        "name": name,
        "loop": text.lstrip().startswith("loop"),
        "frames": frames,
        "total": total,
    }


def main():
    data = common.params()

    if data.get("ring_anim_hide") is not None:
        target = str(data.get("ring_anim_hide") or "").strip()
        hidden = hidden_ring_anims()
        if target and target not in hidden:
            hidden.append(target)
        save_hidden_ring_anims(hidden)
        common.ok(hidden_animations=hidden)
        return

    if common.truthy(data.get("ring_anim_restore")):
        save_hidden_ring_anims([])
        common.ok(hidden_animations=[])
        return

    if data.get("ring_anim_save") is not None:
        try:
            saved = save_ring_anim(data.get("ring_anim_save"))
        except (ValueError, OSError) as exc:
            common.fail(400, str(exc))
            return
        common.ok(saved=saved, animations=ring_animations())
        return

    if data.get("ring_anim_delete") is not None:
        target = str(data.get("ring_anim_delete") or "")
        try:
            delete_ring_anim(target)
        except (ValueError, RuntimeError) as exc:
            common.fail(400, str(exc))
            return
        if target:
            animation_stop()
        common.ok(animations=ring_animations())
        return

    if data.get("ring_anim") is not None:
        try:
            pid = animation_play(str(data.get("ring_anim") or "").strip())
        except (ValueError, RuntimeError) as exc:
            common.fail(400, str(exc))
            return
        common.ok(playing=True, pid=pid, animations=ring_animations())
        return

    if common.truthy(data.get("ring_anim_stop")):
        animation_stop()
        # keep=1 — только остановить проигрыватель, не гася кольцо:
        # так переключение на «Волну»/свой цвет не мигает.
        keep = common.truthy(data.get("keep"))
        if not keep:
            luna_ring_off()
            # Прошивка может успеть перерисовать последний штатный кадр
            # уже после остановки led_util — гасим ещё раз с задержкой.
            time.sleep(0.25)
            luna_ring_off()
        common.ok(playing=False, off=not keep)
        return

    if data.get("anim_preview") is not None:
        try:
            common.ok(**anim_preview(str(data.get("anim_preview") or "").strip()))
        except (ValueError, RuntimeError) as exc:
            common.fail(400, str(exc))
        return

    if data.get("clock_preset_hide") is not None:
        target = str(data.get("clock_preset_hide") or "").strip()
        hidden = hidden_clock_presets()
        if target and target not in hidden:
            hidden.append(target)
        save_hidden_clock_presets(hidden)
        common.ok(clock_anims=clock_anims(), hidden_presets=hidden)
        return

    if common.truthy(data.get("clock_preset_restore")):
        save_hidden_clock_presets([])
        common.ok(clock_anims=clock_anims(), hidden_presets=[])
        return

    if data.get("clock_anim_save") is not None:
        try:
            item = clean_clock_anim(data.get("clock_anim_save"))
        except ValueError as exc:
            common.fail(400, str(exc))
            return
        items = clock_anims()
        for index, current in enumerate(items):
            if current.get("id") == item["id"]:
                items[index] = item
                break
        else:
            items.append(item)
        save_clock_anims(items)
        common.ok(clock_anims=items)
        return

    if data.get("clock_anim_delete") is not None:
        target = str(data.get("clock_anim_delete") or "")
        items = [item for item in clock_anims() if item.get("id") != target]
        save_clock_anims(items)
        common.ok(clock_anims=items)
        return

    if data.get("clock_anim_play") is not None:
        try:
            item = clean_clock_anim(data.get("clock_anim_play"))
            pid = clock_anim_play(item["frames"], item["duration"])
        except (ValueError, RuntimeError) as exc:
            common.fail(400, str(exc))
            return
        common.ok(playing=True, pid=pid)
        return

    if common.truthy(data.get("clock_anim_stop")):
        clock_anim_stop()
        common.ok(playing=False)
        return

    if common.truthy(data.get("restore_clock")):
        brightness = common.to_int(data.get("brightness"), load_display_brightness(), 10, 255)
        common.ok(**restore_clock(brightness))
        return

    if common.truthy(data.get("reset_display")):
        clock_anim_stop()
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

    if data.get("display_curve") is not None or data.get("display_curve_reset") is not None:
        config = load_auto()
        if common.truthy(data.get("display_curve_reset")):
            config["display_curve"] = default_display_curve(
                config["display_min"], config["display_max"])
        else:
            curve = clean_curve(data.get("display_curve"))
            if len(curve) < 2:
                common.fail(400, "нужно минимум две точки: lux и яркость")
                return
            config["display_curve"] = curve
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
        clock_anim_stop()
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
        animations=ring_animations(),
        animation=animation_pid() if _pid_alive(animation_pid() or 0) else None,
        animation_name=animation_name(),
        clock_anims=clock_anims(),
        hidden_presets=hidden_clock_presets(),
        hidden_animations=hidden_ring_anims(),
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
