#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Голосовой пульт: слушает recognize и выполняет команды.

Особенность: Алиса сама реагирует на «включи …» и может запустить музыку
раньше, чем демон получит текст. Поэтому при совпадении команды мы сначала
останавливаем плеер, потом выполняем действие.

Проверка без микрофона:
    /opt/bin/python3 voice_daemon.py --match "Алиса, включи впн"
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import urllib.request

BASE = "http://127.0.0.1:8055"
LUNA = "http://127.0.0.1:8099"


def log(message):
    print(time.strftime("%H:%M:%S"), message, flush=True)


def post(url, payload, timeout=60):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", "replace")
    return json.loads(body) if body.strip() else {}


def get(url, timeout=10):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        body = response.read().decode("utf-8", "replace")
    return json.loads(body) if body.strip() else {}


def volume_level(default=40):
    try:
        data = get(BASE + "/cgi-bin/volume.py", timeout=8) or {}
        level = data.get("level")
        return int(level) if isinstance(level, (int, float)) else default
    except Exception:
        return default


def set_volume(level):
    try:
        post(BASE + "/cgi-bin/volume.py", {"level": int(level)}, timeout=10)
    except Exception:
        pass


def stop_alice_speech():
    """Отменить текущую речь Алисы: текстовое «стоп» отменяет TTS-директиву."""
    try:
        post(BASE + "/cgi-bin/command.py", {"text": "стоп"}, timeout=10)
    except Exception:
        pass


def chunk_text(text, limit=1700):
    """Разбить длинный ответ на куски по предложениям (лимит speak.py)."""
    text = re.sub(r"\s+", " ", text or "").strip()
    if not text:
        return []
    if len(text) <= limit:
        return [text]
    chunks = []
    current = ""
    for part in re.split(r"(?<=[.!?…])\s+", text):
        while len(part) > limit:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(part[:limit])
            part = part[limit:]
        if not current:
            current = part
        elif len(current) + 1 + len(part) <= limit:
            current += " " + part
        else:
            chunks.append(current)
            current = part
    if current:
        chunks.append(current)
    return chunks


def say(text, append=1):
    if not text:
        return
    # Перед озвучкой всегда возвращаем звук: до этого мы могли глушить Алису.
    try:
        post(BASE + "/cgi-bin/volume.py", {"unmute": 1}, timeout=8)
    except Exception:
        pass
    chunks = chunk_text(text)
    for index, chunk in enumerate(chunks):
        try:
            payload = {"text": chunk, "wait": 0.8}
            if append == 0:
                payload["append"] = 0
            post(BASE + "/cgi-bin/speak.py", payload, timeout=25)
        except Exception:
            pass
        if index + 1 < len(chunks):
            time.sleep(0.4)


def hush_native():
    """Перебить текущую речь штатной Алисы TTS-директивой с append=0."""
    try:
        post(BASE + "/cgi-bin/speak.py",
             {"text": "\u200b", "append": 0, "wait": 3}, timeout=8)
    except Exception:
        pass


def announce(text, pause=False):
    """Отменить ответ Алисы и сказать своё подтверждение один раз."""
    if pause:
        pause_music()
    for _ in range(2):
        stop_alice_speech()
        time.sleep(0.6)
    say(text)


def pause_music():
    try:
        post(BASE + "/cgi-bin/media.py", {"action": "pause"}, timeout=10)
    except Exception:
        pass


def stop_music_soon(rounds=6, delay=0.8):
    """Алиса запускает музыку с задержкой — гасим её ещё несколько секунд."""
    pause_music()

    def worker():
        for _ in range(rounds):
            time.sleep(delay)
            pause_music()

    threading.Thread(target=worker, daemon=True).start()


def normalize(text):
    low = (text or "").lower().replace("ё", "е")
    low = re.sub(r"[^a-zа-я0-9 ]+", " ", low)
    low = re.sub(r"\s+", " ", low).strip()
    low = re.sub(r"^(алиса|алеса|алекс|алиса )\s*", "", low)
    return low


VPN_WORDS = ("впн", "vpn", "в п н", "вэ пэ эн", "ви пи эн", "впэн", "впиэн")
LLM_WORDS = ("нейросет", "нейронк", "нейро сеть", "нейро", "жпт", "gpt", "чат гпт")
RADIO_LIST = ("какие радио", "какие станции", "список радио", "перечисли радио",
              "что за радио", "какие есть радио", "какие радиостанции",
              "какие радио ты знаешь", "какие радиостанции ты знаешь",
              "перечисли список радио", "что за радиостанции",
              "что ты знаешь про радио")
ON_WORDS = ("включи", "включить", "вруби", "запусти", "подними", "активируй")
OFF_WORDS = ("выключи", "выключить", "отключи", "отключить", "выруби", "останови", "опусти")


def has_any(text, words):
    return any(word in text for word in words)


def match(text):
    """Вернуть (kind, action) или None. kind: vpn/llm/light."""
    low = normalize(text)
    if not low:
        return None

    # «какие радио ты знаешь» — перечисляем станции, это важнее on/off
    if has_any(low, RADIO_LIST):
        return ("radio_list", "list")

    # сначала выключение: «выключи» содержит «ключи», порядок важен
    off = has_any(low, OFF_WORDS)
    on = (not off) and has_any(low, ON_WORDS)

    if has_any(low, VPN_WORDS) and (on or off):
        return ("vpn", "off" if off else "on")

    if has_any(low, LLM_WORDS) and (on or off):
        return ("llm", "off" if off else "on")

    # «свет» намеренно не перехватываем: этим словом управляет реле через
    # «Дом с Алисой», пульт не должен вмешиваться.

    # «включи радио …» Алиса понимает сама — не перехватываем и не отдаём в LLM.
    if "радио" in low and (on or off):
        return ("radio", "off" if off else "on")

    return None


def recognize():
    try:
        data = post(LUNA + "/api/alice/recognize", {}, timeout=120)
    except Exception:
        return ""
    for key in ("transcript", "text"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    result = data.get("result") or {}
    value = result.get("transcript")
    return value.strip() if isinstance(value, str) else ""


def llm_enabled():
    try:
        info = get(BASE + "/cgi-bin/llm.py?info=1")
        if "enabled" in info:
            return bool(info.get("enabled"))
        return bool((info.get("config") or {}).get("enabled"))
    except Exception:
        return False


def wait_alice_finish(timeout=15):
    """Дать штатной Алисе договорить, чтобы наш ответ не наложился."""
    time.sleep(1.2)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            data = get(BASE + "/cgi-bin/player.py", timeout=6) or {}
            if data.get("alice") == "IDLE":
                return
        except Exception:
            return
        time.sleep(0.7)


_NATIVE_LAST_ACTIVE = 0.0


def native_alice_busy():
    """Не запускать свой recognize, пока штатная Алиса слушает/говорит.

    После окончания её речи держим паузу: Алиса часто задаёт встречный
    вопрос и переходит в LISTENING; если сразу открыть свой микрофон,
    продолжение диалога задерживается.
    """
    global _NATIVE_LAST_ACTIVE
    try:
        data = get(BASE + "/cgi-bin/player.py", timeout=5) or {}
        if data.get("alice") in ("LISTENING", "SPEAKING"):
            _NATIVE_LAST_ACTIVE = time.time()
            return True
        if time.time() - _NATIVE_LAST_ACTIVE < 5.0:
            return True
        return False
    except Exception:
        return False


def radio_names():
    try:
        data = get(BASE + "/cgi-bin/radio.py", timeout=10)
        return [str(item.get("name")) for item in (data.get("stations") or []) if item.get("name")]
    except Exception:
        return []


LLM_ALIASES = {
    "deepseek": ("дипсик", "дип сик", "deepseek"),
    "openai": ("чатжпт", "чат гпт", "chatgpt", "опенаи", "openai"),
    "openrouter": ("опенроутер", "open router", "openrouter"),
}


def llm_info():
    try:
        return get(BASE + "/cgi-bin/llm.py?info=1", timeout=10) or {}
    except Exception:
        return {}


def llm_profile_target(text):
    """Найти профиль LLM по фразе: имя, провайдер или известный синоним."""
    info = llm_info()
    for profile in info.get("profiles") or []:
        candidates = [profile.get("name"), profile.get("provider"), profile.get("id")]
        candidates += list(LLM_ALIASES.get(profile.get("provider") or "", ()))
        for candidate in candidates:
            word = normalize(str(candidate or ""))
            if word and word in text:
                return profile
    return None


CHAT_NAME_LIMIT = 40


def clean_chat_name(raw):
    """Имя чата из произнесённой фразы: без кавычек, хвостов и лишних пробелов."""
    name = " ".join(str(raw or "").split()).strip()
    name = name.strip("\"'«»“”").strip()
    for tail in ("пожалуйста", "пожалйста", "пжлст", "плиз"):
        if name.casefold().endswith(" " + tail):
            name = name[: -len(tail) - 1].strip(" ,.")
    return name[:CHAT_NAME_LIMIT]


def parse_chat_command(text):
    """("create"|"switch", имя) или None. Имя может быть пустым."""
    raw = str(text or "")
    create = re.search(
        r"(?:созда[йт]|сдела[йт]|добав[ьи]|нов(?:ый|ая|ое))\s+"
        r"(?:нов(?:ый|ая|ое)\s+)?чат\b\s*(.*)$", raw, re.IGNORECASE | re.DOTALL)
    if create:
        return ("create", clean_chat_name(create.group(1)))
    switch = re.search(
        r"(?:переключ(?:и|ись|ите)|перейд(?:и|ите)|открой(?:те)?)\s+"
        r"(?:на\s+)?чат\b\s*(.*)$", raw, re.IGNORECASE | re.DOTALL)
    if switch:
        return ("switch", clean_chat_name(switch.group(1)))
    return None


def _chat_key(name):
    return clean_chat_name(name).casefold().replace("ё", "е")


def chat_by_name(items, name):
    """Чат по имени без учёта регистра; частичное совпадение — если оно одно."""
    query = _chat_key(name)
    if not query:
        return None
    for item in items or []:
        if isinstance(item, dict) and _chat_key(item.get("name")) == query:
            return item
    partial = [item for item in items or []
               if isinstance(item, dict) and query in _chat_key(item.get("name"))]
    return partial[0] if len(partial) == 1 else None


def chat_create(name):
    payload = {"chat_new": 1}
    if name:
        payload["chat_name"] = name
    try:
        data = post(BASE + "/cgi-bin/llm.py", payload, timeout=15) or {}
    except Exception as exc:  # noqa: BLE001
        log("chat create error: %s" % exc)
        announce("Не удалось создать чат")
        return True
    if not data.get("ok") or not data.get("active_chat_name"):
        log("chat create failed: %s" % str(data.get("error") or data)[:200])
        announce("Не удалось создать чат")
        return True
    created = clean_chat_name(data.get("active_chat_name")) or name or "чат"
    announce("Создан чат " + created)
    log("чат создан: %s" % created)
    return True


def chat_select_by_name(name):
    info = llm_info()
    chat = chat_by_name(info.get("chats") or [], name)
    if chat is None:
        names = [clean_chat_name(item.get("name")) for item in info.get("chats") or []
                 if isinstance(item, dict) and item.get("name")]
        hint = (" Есть: " + ", ".join(names[:5]) + ".") if names else ""
        announce("Чат " + name + " не найден." + hint)
        log("чат не найден: %r (есть: %s)" % (name, ", ".join(names)))
        return True
    try:
        data = post(BASE + "/cgi-bin/llm.py", {"chat_select": chat.get("id")}, timeout=15) or {}
    except Exception as exc:  # noqa: BLE001
        log("chat select error: %s" % exc)
        announce("Не удалось переключить чат")
        return True
    if not data.get("ok") or not data.get("active_chat_name"):
        log("chat select failed: %s" % str(data.get("error") or data)[:200])
        announce("Не удалось переключить чат")
        return True
    current = clean_chat_name(data.get("active_chat_name")) or name
    announce("Переключился на чат " + current)
    log("чат: %s" % current)
    return True


def llm_switch(text):
    low = normalize(text)

    command = parse_chat_command(text)
    if command:
        kind, name = command
        if kind == "create":
            return chat_create(name)
        if not name:
            announce("Назовите чат: например, переключись на чат Работа")
            return True
        return chat_select_by_name(name)

    if "чат" in low:
        info = llm_info()
        if "какой чат" in low or "текущий чат" in low:
            announce("Сейчас " + str(info.get("active_chat_name") or "чат"))
            return True
        if "удал" in low or "закрой" in low:
            if not info.get("active_chat"):
                return False
            try:
                post(BASE + "/cgi-bin/llm.py",
                     {"chat_delete": info.get("active_chat")}, timeout=15)
                updated = llm_info()
                announce("Чат удалён. Сейчас " + str(updated.get("active_chat_name") or "чат"))
                return True
            except Exception as exc:  # noqa: BLE001
                log("chat delete error: %s" % exc)
                return False
        if "следующ" in low:
            payload = {"chat_next": 1}
        elif "предыдущ" in low or "прошл" in low:
            payload = {"chat_prev": 1}
        elif "нов" in low:
            payload = {"chat_new": 1}
        else:
            payload = None
        if payload:
            try:
                post(BASE + "/cgi-bin/llm.py", payload, timeout=15)
                info = llm_info()
                name = info.get("active_chat_name") or "чат"
                announce("Переключил на " + str(name))
                log("чат: %s" % name)
                return True
            except Exception as exc:  # noqa: BLE001
                log("chat switch error: %s" % exc)
                return False

    if not any(word in low for word in
               ("нейросет", "профил", "переключ", "включ", "выключ", "отключ", "запуст")):
        return False

    profile = llm_profile_target(low)
    if profile:
        off = any(word in low for word in ("выключ", "отключ", "стоп"))
        try:
            if off:
                post(BASE + "/cgi-bin/llm.py", {"enabled": 0}, timeout=15)
                message = "Выключаю " + str(profile.get("name") or "нейросеть")
            else:
                post(BASE + "/cgi-bin/llm.py",
                     {"activate": profile.get("id"), "enabled": 1}, timeout=15)
                message = "Включаю " + str(profile.get("name") or "нейросеть")
            # Алиса на «включи …» запускает музыку с задержкой. Отменяем её
            # речь после старта TTS и гасим музыку.
            announce(message, pause=True)
            # Музыка может стартовать и после ответа — паузим ещё несколько секунд.
            stop_music_soon(rounds=8, delay=0.8)
            return True
        except Exception as exc:  # noqa: BLE001
            log("llm switch error: %s" % exc)
            return False

    if any(phrase in low for phrase in ("какая нейросеть", "что за нейросеть", "какой профиль")):
        info = llm_info()
        active = info.get("active_name")
        if info.get("enabled") and active:
            announce("Сейчас включена нейросеть " + str(active))
        elif active:
            announce("Нейросеть выключена. Активный профиль: " + str(active))
        else:
            announce("Профили нейросети не настроены")
        return True
    return False


def perform(kind, action):
    if kind == "vpn":
        stop_music_soon()
        if action == "on":
            post(BASE + "/cgi-bin/vpn.py", {"start": 1}, timeout=120)
            announce("VPN включён", pause=True)
        else:
            post(BASE + "/cgi-bin/vpn.py", {"stop": 1}, timeout=30)
            announce("VPN выключен", pause=True)
        return True

    if kind == "llm":
        stop_music_soon()
        post(BASE + "/cgi-bin/llm.py", {"enabled": 1 if action == "on" else 0}, timeout=15)
        announce("Нейросеть включена" if action == "on" else "Нейросеть выключена")
        return True

    if kind == "radio":
        # Пусть отвечает сама Алиса: у неё это получается лучше.
        log("радио: отдаю Алисе (%s)" % action)
        return True

    if kind == "radio_list":
        names = radio_names()
        if not names:
            announce("Список радио недоступен, проверьте пульт.")
            return True
        text = "Я знаю %d станций: %s. Скажите: включи радио, и название." % (
            len(names), ", ".join(names))
        log("список радио: %d станций" % len(names))
        announce(text[:1900])
        return True

    return False


SCENARIO_PATH = "/data/mypult/scenarios.json"
_SCENARIO_MTIME = None
_SCENARIO_PHRASES = []


def scenario_may_match(text):
    """Быстрая локальная проверка: не дергать scenarios.py зря."""
    global _SCENARIO_MTIME, _SCENARIO_PHRASES
    try:
        mtime = os.path.getmtime(SCENARIO_PATH)
        if mtime != _SCENARIO_MTIME:
            with open(SCENARIO_PATH, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            items = data.get("scenarios") if isinstance(data, dict) else data
            phrases = []
            for item in items or []:
                if isinstance(item, dict):
                    phrases.extend(str(p) for p in (item.get("phrases") or []) if p)
            _SCENARIO_PHRASES = phrases
            _SCENARIO_MTIME = mtime
    except Exception:
        # Если файл недоступен/сломан — пусть решает CGI.
        return True
    low = normalize(text)
    return bool(low) and any(
        normalize(phrase) and normalize(phrase) in low
        for phrase in _SCENARIO_PHRASES)


def run_scenario(text):
    try:
        return post(BASE + "/cgi-bin/scenarios.py", {"match": text}, timeout=20) or {}
    except Exception as exc:  # noqa: BLE001
        log("scenario error: %s" % exc)
        return {}


def handle(text):
    # Список радио обрабатываем до сценариев: иначе Алиса успевает
    # ответить, пока ждём HTTP-ответ scenarios.py.
    intent = match(text)
    if intent and intent[0] == "radio_list":
        log("команда: %s %s <- %r" % (intent[0], intent[1], text))
        return perform(*intent)

    scenario = run_scenario(text) if scenario_may_match(text) else {}
    if scenario.get("matched"):
        log("сценарий: %s <- %r" % (scenario.get("matched"), text))
        return True

    if llm_switch(text):
        log("нейросеть: переключение <- %r" % text)
        return True

    if intent:
        log("команда: %s %s <- %r" % (intent[0], intent[1], text))
        return perform(*intent)

    if llm_enabled() and len(normalize(text)) > 2:
        # «свет» — зона реле через «Дом с Алисой», в нейросеть не отправляем.
        if "свет" in normalize(text):
            log("свет: не отдаю в LLM")
            return False
        log("llm <- %r" % text)
        info = llm_info()
        long_answer = int(info.get("max_tokens") or 260) >= 600
        custom_prompt = str(info.get("system_prompt") or "").strip()
        if custom_prompt:
            system = custom_prompt
        else:
            system = (
                "Ты голосовой ассистент умной колонки. "
                + ("Отвечай по существу: если вопрос требует объяснения — дай "
                   "развёрнутый ответ, на простой вопрос отвечай коротко. " if long_answer
                   else "Отвечай кратко, по-русски, одним-двумя предложениями. ")
            )
        box = {}

        def ask_model():
            try:
                box["answer"] = post(BASE + "/cgi-bin/llm.py",
                                     {"prompt": text, "system": system}, timeout=90).get("answer")
            except Exception as exc:  # noqa: BLE001
                box["error"] = exc

        worker = threading.Thread(target=ask_model, daemon=True)
        started_at = time.time()
        worker.start()
        # «Стоп» в момент распознавания приходит до старта её TTS — повторяем
        # через секунду, когда директива уже активна.
        time.sleep(1.2)
        stop_alice_speech()
        worker.join(30)

        if "error" in box:
            log("llm error: %s" % box["error"])
            return False
        answer = box.get("answer")
        if answer:
            generation = time.time() - started_at
            stop_alice_speech()
            say(answer)
            log("llm answer: %d символов, генерация %.1f с"
                % (len(answer), generation))
            return True

    log("без команды: %r" % text)
    return False


def scheduler_loop():
    while True:
        try:
            post(BASE + "/cgi-bin/scenarios.py", {"tick": 1}, timeout=20)
        except Exception:
            pass
        time.sleep(30)


def autobright_loop():
    while True:
        try:
            post(BASE + "/cgi-bin/display.py", {"auto_tick": 1}, timeout=20)
        except Exception:
            pass
        time.sleep(60)


def clock_loop():
    """Часы на станции: обновляем дисплей временем колонки, не браузера."""
    while True:
        try:
            post(BASE + "/cgi-bin/display.py", {"clock_tick": 1}, timeout=20)
        except Exception:
            pass
        time.sleep(45)


def volume_sync_loop():
    """Сохранять громкость, выставленную физическими кнопками."""
    time.sleep(30)
    while True:
        time.sleep(10)
        actual = volume_level(None)
        if actual is None or actual in (0, 40):
            continue
        try:
            with open("/data/mypult/volume.json", "r", encoding="utf-8") as fh:
                saved = int(json.load(fh).get("level"))
        except (OSError, ValueError, TypeError):
            saved = None
        if actual != saved:
            set_volume(actual)


def disk_cleanup_loop():
    while True:
        try:
            stats = os.statvfs("/")
            used = 1 - (stats.f_bavail / stats.f_blocks)
            if used > 0.85:
                post(BASE + "/cgi-bin/maintenance.py", {"cleanup": 1}, timeout=30)
                log("диск занят %.0f%% — почистил логи", used * 100)
        except Exception:
            pass
        time.sleep(600)


def should_silence(text):
    """Глушить штатную Алису на время обработки фразы.

    Радио и «свет» отдаём Алисе/реле, их ответ трогать нельзя.
    """
    low = normalize(text)
    if len(low) <= 2:
        return False
    if "свет" in low:
        return False
    if "радио" in low and any(word in low for word in ("включ", "выключ", "поставь", "играй")):
        return False
    return llm_enabled()


def main():
    log("голосовой пульт запущен")
    threading.Thread(target=scheduler_loop, daemon=True).start()
    threading.Thread(target=autobright_loop, daemon=True).start()
    threading.Thread(target=clock_loop, daemon=True).start()
    threading.Thread(target=volume_sync_loop, daemon=True).start()
    threading.Thread(target=disk_cleanup_loop, daemon=True).start()
    last_text = ""
    last_ts = 0.0
    while True:
        if native_alice_busy():
            time.sleep(0.6)
            continue
        started = time.time()
        try:
            text = recognize()
        except KeyboardInterrupt:
            return
        except Exception as exc:  # noqa: BLE001
            log("recognize error: %s" % exc)
            time.sleep(2)
            continue
        if not text:
            # recognize может вернуться мгновенно с пустым результатом —
            # без паузы получается busy-loop и 100% CPU.
            time.sleep(0.5)
            continue
        # recognize иногда отдаёт одну и ту же фразу несколько раз подряд,
        # причём с паузой больше 4 секунд — держим окно 30 секунд.
        if text == last_text and (time.time() - last_ts) < 30:
            # Luna иногда отдаёт тот же финальный текст повторно; не занимаем
            # микрофон новым recognize каждые 10 секунд.
            time.sleep(8)
            continue
        log("распознано за %.1f с: %r" % (time.time() - started, text))
        last_text, last_ts = text, time.time()
        silenced = False
        if should_silence(text):
            try:
                post(BASE + "/cgi-bin/volume.py", {"mute": 1}, timeout=8)
                silenced = True
                log("mute Алисы на время команды")
            except Exception:
                pass
        try:
            handle_started = time.time()
            handle(text)
            log("обработано за %.1f с" % (time.time() - handle_started))
        except Exception as exc:  # noqa: BLE001
            log("handle error: %s" % exc)
            time.sleep(1)
        finally:
            if silenced:
                try:
                    post(BASE + "/cgi-bin/volume.py", {"unmute": 1}, timeout=8)
                except Exception:
                    pass
            # Даём штатной Алисе начать/закончить ответ, не открывая микрофон
            # своим recognize в тот же момент.
            time.sleep(0.8)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--match":
        print(match(sys.argv[2]))
        sys.exit(0)
    if len(sys.argv) > 2 and sys.argv[1] == "--run":
        handle(sys.argv[2])
        sys.exit(0)
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
