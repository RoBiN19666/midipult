#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Настройки голоса: потолок громкости ответов LLM и режим прослушивания.

    GET  /cgi-bin/voicecfg.py
    POST /cgi-bin/voicecfg.py {"max_volume": 20}
    POST /cgi-bin/voicecfg.py {"enabled": false}   — пользователь выключил пульт
    POST /cgi-bin/voicecfg.py {"idle": "auto"}     — не слушать вхолостую

`idle`:
    always — держать сессию распознавания постоянно (поведение Миди);
    auto   — открывать её только когда есть что обрабатывать: есть сценарии
             или включена нейросеть. На не-Миди (например Station 2) это
             значение по умолчанию: там каждая сессия подсвечивает кольцо.

`mic_mode`:
    continuous — своя сессия распознавания всё время;
    econom     — короткие сессии по 18 секунд с паузами;
    alice      — своей сессии нет: пульт читает фразы, которые уже
                 распознала Алиса, и перехватывает только свои.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

STORE = "/data/mypult/voice.json"
LUNA = "http://127.0.0.1:8099"
IDLE_MODES = ("always", "auto")
MIC_MODES = ("continuous", "econom", "alice")
MUSIC_DEFAULTS = ("", "youtube", "soundcloud", "zvuk")
MIDI_MODELS = ("yandexmidi",)


def load():
    try:
        with open(STORE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save(data):
    common.write_json(STORE, data)


def device_model():
    """Модель станции по Luna. Пусто — Luna не ответила."""
    try:
        with urllib.request.urlopen(LUNA + "/api/device", timeout=4) as response:
            data = json.loads(response.read().decode("utf-8", "replace"))
        return str(data.get("model") or "").strip().lower()
    except Exception:  # noqa: BLE001
        return ""


def default_idle(model=None):
    """По умолчанию не держим микрофон без дела ни на одной модели.

    Штатная Алиса живёт в той же Luna, и постоянная сессия пульта задерживает
    её ответы. `auto` открывает микрофон только когда есть сценарии или
    включена нейросеть; `always` остаётся явным выбором пользователя.
    """
    return "auto"


def default_mic_mode(model=None):
    """На Миди по умолчанию читаем фразы Алисы, на остальных — как раньше.

    Режим `alice` проверен на Миди; на Station 2/Mini его ещё не гоняли,
    поэтому там остаётся непрерывная сессия, пока не проверим.
    """
    return "alice" if (model or "").strip().lower() in MIDI_MODELS else "continuous"


def resolve_mic_mode(config, model=None):
    mode = str((config or {}).get("mic_mode") or "").strip().lower()
    return mode if mode in MIC_MODES else default_mic_mode(model)


def resolve_idle(config, model=None):
    mode = str((config or {}).get("idle") or "").strip().lower()
    if mode in IDLE_MODES:
        return mode
    return default_idle(model)


def is_enabled(config):
    """Пользовательский тумблер. По умолчанию включён (как раньше)."""
    return (config or {}).get("enabled") is not False


def music_voice_enabled(config):
    """Голосовые команды внешних музыкальных сервисов (по умолчанию выкл)."""
    return (config or {}).get("music_voice") is True


def resolve_music_default(config):
    """Сервис для «включи музыку»; пусто — отдаём Алисе."""
    mode = str((config or {}).get("music_default") or "").strip().lower()
    return mode if mode in MUSIC_DEFAULTS else ""


def state(config=None):
    config = load() if config is None else config
    model = device_model()
    return {
        "enabled": is_enabled(config),
        "idle": resolve_idle(config, model),
        "device": model,
        "max_volume": common.to_int(config.get("max_volume"), 45, 1, 100),
        "mic_mode": resolve_mic_mode(config, model),
        "music_voice": music_voice_enabled(config),
        "music_default": resolve_music_default(config),
    }


def main():
    data = common.params()

    if data.get("max_volume") is not None:
        config = load()
        config["max_volume"] = common.to_int(data.get("max_volume"), 45, 1, 100)
        save(config)
        common.ok(config=config, **state(config))
        return

    if data.get("enabled") is not None:
        config = load()
        config["enabled"] = common.truthy(data.get("enabled"))
        save(config)
        common.ok(config=config, **state(config))
        return

    if data.get("mic_mode") is not None:
        mode = str(data.get("mic_mode") or "").strip().lower()
        if mode not in MIC_MODES:
            common.fail(400, "режим микрофона: %s" % ", ".join(MIC_MODES))
            return
        config = load()
        config["mic_mode"] = mode
        save(config)
        common.ok(config=config, **state(config))
        return

    if data.get("idle") is not None:
        mode = str(data.get("idle") or "").strip().lower()
        if mode not in IDLE_MODES:
            common.fail(400, "режим простоя: %s" % ", ".join(IDLE_MODES))
            return
        config = load()
        config["idle"] = mode
        save(config)
        common.ok(config=config, **state(config))
        return

    if data.get("music_voice") is not None:
        config = load()
        config["music_voice"] = common.truthy(data.get("music_voice"))
        save(config)
        common.ok(config=config, **state(config))
        return

    if data.get("music_default") is not None:
        mode = str(data.get("music_default") or "").strip().lower()
        if mode not in MUSIC_DEFAULTS:
            common.fail(400, "сервис: %s" % ", ".join(MUSIC_DEFAULTS))
            return
        config = load()
        config["music_default"] = mode
        save(config)
        common.ok(config=config, **state(config))
        return

    common.ok(config=load(), **state())


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
