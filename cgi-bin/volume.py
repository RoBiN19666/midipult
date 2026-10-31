#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Громкость колонки: amixer с автопоиском микшера, затем Glagol.

Luna-эндпоинт /api/volume падает с «amixer: Invalid command!», поэтому
скрипт сам находит карту и регулятор:

    1. читает /proc/asound/cards;
    2. для каждой карты спрашивает `amixer -c N scontrols`;
    3. выбирает первый регулятор из списка предпочтений
       (Master, PCM, Digital, Speaker, …) или первый доступный;
    4. запоминает рабочую пару карта/регулятор в /tmp/mypult-volume.json.

Если amixer недоступен или не нашёл регулятор — пробует Glagol
(WS 1961, setVolume) и честно сообщает, какой способ сработал.

CGI:  POST /cgi-bin/volume.py  {"level": 45}
      GET  /cgi-bin/volume.py?level=45
      GET  /cgi-bin/volume.py?delta=-5
      POST /cgi-bin/volume.py  {"mute": 1}   или  {"unmute": 1}
      GET  /cgi-bin/volume.py?info=1
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

CACHE_PATH = "/tmp/mypult-volume.json"
VOLUME_PATH = "/data/mypult/volume.json"
MUTE_PATH = "/tmp/mypult-mute.json"

PRIORITY = (
    "Master", "PCM", "Digital", "Speaker", "Playback", "Headphone",
    "Line", "Softvol", "Main", "Audio", "Music", "Wave", "DAC",
)


# --------------------------------------------------------------------------- #
#  amixer
# --------------------------------------------------------------------------- #

def find_amixer():
    for name in ("amixer",):
        path = common.which(name)
        if path:
            return path
    for path in ("/opt/bin/amixer", "/usr/bin/amixer", "/bin/amixer", "/usr/sbin/amixer"):
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def card_args(card):
    return [] if card is None else ["-c", str(card)]


def list_cards():
    """Номера звуковых карт из /proc/asound/cards."""
    cards = []
    try:
        with open("/proc/asound/cards", "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                match = re.match(r"\s*(\d+)\s*\[", line)
                if match:
                    cards.append(int(match.group(1)))
    except OSError:
        pass
    return cards or [0, 1, 2]


def scontrols(amixer, card):
    code, out, err = common.run([amixer] + card_args(card) + ["scontrols"], timeout=6)
    names = re.findall(r"Simple mixer control '([^']+)'", out)
    if not names:
        names = re.findall(r"'([^']+)'", out)
    return names, code, err


def sget(amixer, card, control):
    code, out, err = common.run([amixer] + card_args(card) + ["sget", control], timeout=6)
    if code != 0:
        return None
    percent = re.search(r"\[(\d+)%\]", out)
    muted = "[off]" in out
    return {
        "level": int(percent.group(1)) if percent else None,
        "muted": muted,
        "raw": out.strip().splitlines()[-1] if out.strip() else "",
    }


def sset(amixer, card, control, value):
    code, out, err = common.run([amixer] + card_args(card) + ["sset", control, value], timeout=6)
    if code != 0:
        return False, (err or out).strip()
    return True, (out or err).strip()


def choose_control(names):
    lowered = {name.lower(): name for name in names}
    for preferred in PRIORITY:
        if preferred.lower() in lowered:
            return lowered[preferred.lower()]
    return names[0] if names else None


def load_cache():
    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and data.get("control"):
            return data
    except (OSError, ValueError):
        pass
    return None


def read_mute():
    try:
        with open(MUTE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def write_mute(data):
    try:
        with open(MUTE_PATH, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
    except OSError:
        pass


def clear_mute():
    try:
        os.remove(MUTE_PATH)
    except OSError:
        pass


def save_cache(card, control):
    try:
        with open(CACHE_PATH, "w", encoding="utf-8") as fh:
            json.dump({"card": card, "control": control}, fh)
    except OSError:
        pass


def save_volume(level):
    if not isinstance(level, int) or level <= 0:
        return
    try:
        common.write_json(VOLUME_PATH, {"level": level})
    except OSError:
        pass


def discover(amixer, forced_card=None, forced_control=None):
    """Найти рабочую пару (card, control). Возвращает (choice, diagnostics)."""
    diagnostics = {"cards": [], "tried": []}

    if forced_control:
        cards = [forced_card] if forced_card is not None else [None] + list_cards()
        for card in cards:
            state = sget(amixer, card, forced_control)
            diagnostics["tried"].append({"card": card, "control": forced_control, "ok": state is not None})
            if state is not None:
                return {"card": card, "control": forced_control}, diagnostics
        return None, diagnostics

    cached = load_cache()
    if cached:
        card = cached.get("card")
        control = cached.get("control")
        # Если в кэше карточный контрол, сначала проверяем тот же контрол
        # на default: softvol Master из asound.conf важнее аппаратного.
        if card is not None and control:
            default_state = sget(amixer, None, control)
            if default_state is not None:
                save_cache(None, control)
                return {"card": None, "control": control}, diagnostics
        state = sget(amixer, card, control)
        if state is not None:
            return {"card": card, "control": control}, diagnostics

    # Сначала микшер по умолчанию, без -c: на станциях звук идёт через
    # /etc/asound.conf -> softvol Master, и «amixer set Master N%» меняет
    # именно его. Карточные контролы (DAC/PCM) к громкости Алисы отношения
    # не имеют — поэтому default проверяем первым.
    names, code, err = scontrols(amixer, None)
    diagnostics["cards"].append({
        "card": "default", "controls": names, "exit": code, "stderr": (err or "").strip()[:200]
    })
    if names:
        control = choose_control(names)
        if sget(amixer, None, control) is not None:
            save_cache(None, control)
            return {"card": None, "control": control}, diagnostics

    for card in list_cards():
        names, code, err = scontrols(amixer, card)
        diagnostics["cards"].append({
            "card": card,
            "controls": names,
            "exit": code,
            "stderr": (err or "").strip()[:200],
        })
        if not names:
            continue
        control = choose_control(names)
        state = sget(amixer, card, control)
        diagnostics["tried"].append({"card": card, "control": control, "ok": state is not None})
        if state is not None:
            save_cache(card, control)
            return {"card": card, "control": control}, diagnostics

    return None, diagnostics


def glagol_volume(level):
    payload, error = common.glagol_send({"event": "setVolume", "volume": level})
    if error:
        return False, error
    return True, "glagol"


# --------------------------------------------------------------------------- #
#  Точка входа
# --------------------------------------------------------------------------- #

def main():
    data = common.params()

    level = common.to_int(data.get("level"), default=None, lo=0, hi=100)
    delta = common.to_int(data.get("delta"), default=None, lo=-100, hi=100)
    mute = common.truthy(data.get("mute"))
    unmute = common.truthy(data.get("unmute"))
    info = common.truthy(data.get("info"))
    method = str(data.get("method") or "auto").strip().lower()
    forced_card = common.to_int(data.get("card"), default=None, lo=0, hi=9)
    forced_control = (data.get("control") or "").strip() or None

    amixer = find_amixer()
    wants_action = level is not None or delta is not None or mute or unmute

    if info or (not amixer and not wants_action):
        diagnostics = {"amixer": amixer, "cards": [], "tried": []}
        if amixer:
            _, diagnostics = discover(amixer, forced_card, forced_control)
        common.respond(200, {
            "ok": True,
            "info": True,
            "amixer": amixer,
            "diagnostics": diagnostics,
            "websocket": common.websocket_available(),
            "glagol_url": common.GLAGOL_WS,
            "hint": None if amixer else "Установите alsa-utils: yse install alsa-utils",
        })
        return

    diagnostics = {}
    chosen = None

    if amixer and method in ("auto", "amixer"):
        chosen, diagnostics = discover(amixer, forced_card, forced_control)

    # --- громкость через Glagol (если amixer не справился) ------------------
    if not chosen:
        if mute or unmute:
            common.fail(
                501,
                "Mute недоступен: микшер не найден",
                detail={"amixer": amixer, "diagnostics": diagnostics},
                hint="yse install alsa-utils",
            )
            return
        if level is None and delta is None:
            common.respond(200, {
                "ok": True,
                "level": None,
                "muted": None,
                "method": None,
                "diagnostics": diagnostics,
                "warning": "Микшер не найден и уровень не задан",
            })
            return
        target = level if level is not None else delta
        target = max(0, min(100, target))
        if common.websocket_available() and method in ("auto", "glagol", "amixer"):
            sent, error = glagol_volume(target)
            if sent:
                common.ok(level=target, method="glagol", note="amixer не найден, использован Glagol")
                return
            common.fail(
                501,
                "Громкость недоступна: amixer не найден, Glagol не ответил",
                detail={"amixer": amixer, "glagol": error, "diagnostics": diagnostics},
                hint="yse install alsa-utils  (и/или python3-websocket-client)",
            )
            return
        common.fail(
            501,
            "Микшер не найден",
            detail={"amixer": amixer, "diagnostics": diagnostics},
            hint="yse install alsa-utils",
        )
        return

    card = chosen["card"]
    control = chosen["control"]

    if info:
        common.ok(level=sget(amixer, card, control), card=card, control=control)
        return

    if mute or unmute:
        # Softvol Master на станции не имеет переключателя: amixer sset mute
        # отвечает «Invalid command!» (из-за этого и Luna /api/volume/mute
        # падает). Делаем mute программно: запомнить уровень и выставить 0%.
        state = sget(amixer, card, control) or {}
        current = state.get("level")

        if mute:
            # Повторный mute при уже выключенном звуке не должен затирать
            # сохранённый уровень нулём.
            if current:
                write_mute({"level": current, "card": card, "control": control})
            ok_flag, output = sset(amixer, card, control, "0%")
            if not ok_flag:
                common.fail(502, "Не удалось выключить звук", detail={"output": output})
                return
            common.ok(
                muted=True,
                level=0,
                previous=current,
                card=card,
                control=control,
                method="amixer-softmute",
            )
            return

        saved = read_mute() or {}
        target = saved.get("level")
        if not target:
            # Звук и не был выключен — ничего не меняем (раньше здесь
            # принудительно ставилось 50%).
            state = sget(amixer, card, control) or {}
            common.ok(
                muted=False,
                level=state.get("level"),
                card=card,
                control=control,
                method="amixer-softmute",
                unchanged=True,
            )
            return
        ok_flag, output = sset(amixer, card, control, "%d%%" % target)
        if not ok_flag:
            common.fail(502, "Не удалось вернуть звук", detail={"output": output})
            return
        clear_mute()
        common.ok(
            muted=False,
            level=target,
            card=card,
            control=control,
            method="amixer-softmute",
        )
        return

    if level is None and delta is None:
        state = sget(amixer, card, control)
        common.ok(
            level=state["level"] if state else None,
            muted=state["muted"] if state else None,
            card=card,
            control=control,
            method="amixer",
        )
        return

    if delta is not None:
        state = sget(amixer, card, control) or {}
        base = state.get("level")
        if base is None:
            base = 50
        level = max(0, min(100, base + delta))

    ok_flag, output = sset(amixer, card, control, "%d%%" % level)
    if not ok_flag:
        ok_flag, output = sset(amixer, card, control, "%d%% unmute" % level)

    state = sget(amixer, card, control)
    if not ok_flag or state is None:
        if common.websocket_available():
            sent, error = glagol_volume(level)
            if sent:
                save_volume(level)
                common.ok(level=level, method="glagol", note="amixer отказал, использован Glagol")
                return
            output = "%s / glagol: %s" % (output, error)
        common.fail(
            502,
            "amixer не смог изменить громкость",
            detail={"card": card, "control": control, "output": output[:400], "diagnostics": diagnostics},
            hint="Проверьте ?info=1 — список регуляторов может отличаться",
        )
        return

    clear_mute()
    save_volume(state["level"])
    common.ok(
        level=state["level"],
        muted=state["muted"],
        card=card,
        control=control,
        requested=level,
        method="amixer",
    )


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:
        try:
            common.fail(500, "Внутренняя ошибка volume.py: %s" % exc)
        except Exception:
            pass
