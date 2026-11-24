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
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8055"
LUNA = "http://127.0.0.1:8099"

sys.path.insert(0, "/data/myweb/cgi-bin")
try:
    import alice_cli  # noqa: E402
except Exception:  # noqa: BLE001
    alice_cli = None
try:
    import alarmd  # noqa: E402
except Exception:  # noqa: BLE001
    alarmd = None
try:
    import voicecfg  # noqa: E402
except Exception:  # noqa: BLE001
    voicecfg = None


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
    """Отменить текущую речь Алисы.

    Сначала локальный `maind --cli` 'c' (быстро, без облака) — идея из
    yapanel-web; если CLI недоступен, старый путь через текстовое «стоп».
    """
    if alice_cli is not None:
        try:
            alice_cli.cancel()
            return
        except Exception:  # noqa: BLE001
            pass
    try:
        post(BASE + "/cgi-bin/command.py", {"text": "стоп"}, timeout=10)
    except Exception:
        pass


def cancel_native_dialog(fast=False):
    """Отменить диалог штатной Алисы целиком, вместе с отложенным ответом.

    `maind --cli` 'c' гасит текущую речь, но ответ Алисы AI приходит позже
    через AliceDeferred. Luna `POST /api/alice/speech/cancel` отправляет в
    aliced отмену диалога и очищает очередь отложенных ответов, поэтому
    сначала пробуем его, а CLI оставляем страховкой для старых Luna.

    `fast=True` — не запускать процесс CLI, когда Luna ответила: в режиме
    alice важна каждая десятая секунды, пока Алиса не начала говорить.
    """
    ok = False
    try:
        post(LUNA + "/api/alice/speech/cancel", {}, timeout=8)
        ok = True
    except Exception:  # noqa: BLE001 - старая Luna или сеть: остаётся CLI
        pass
    if fast and ok:
        return
    stop_alice_speech()


FOLLOW_UP_STOP = ("хватит", "стоп", "спасибо", "пока", "до свидания",
                  "замолчи", "отмена", "не надо")


def follow_up_wanted(text):
    return normalize(text).strip(" .!?,") in FOLLOW_UP_STOP


def _cancel_requires_post(exc):
    """Luna 0.2.36+ отклоняет GET с cancel=true и подсказывает POST."""
    try:
        body = exc.read().decode("utf-8", "replace").lower()
    except Exception:  # noqa: BLE001 - тело уже прочитано или недоступно
        return False
    return "only with post" in body


_LUNA_POST_CANCEL = {"ok": True}


def _speech_event(timeout_ms=8000, cancel=True):
    """Одно событие распознавания.

    cancel=True отменяет диалог Алисы сразу после фрагмента — это нужно для
    перехвата. Для follow-up отмена вредна: она гасит диалог, который мы
    только что открыли сами, поэтому там cancel=False.

    Luna 0.2.36+ принимает cancel=true только через POST (nyakokitsu/luna#52),
    на старых Luna POST может не быть — откатываемся на GET.
    """
    params = {"timeout_ms": timeout_ms, "empty_on_timeout": "true"}
    if cancel:
        params["cancel"] = "true"
    url = "%s/api/alice/speech?%s" % (LUNA, urllib.parse.urlencode(params))
    timeout = (timeout_ms / 1000.0) + 5
    if _LUNA_POST_CANCEL["ok"]:
        try:
            return post(url, {}, timeout=timeout)
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 405) or _cancel_requires_post(exc):
                _LUNA_POST_CANCEL["ok"] = False
            else:
                return {"error": "HTTP %d" % exc.code}
        except Exception as exc:  # noqa: BLE001 - таймаут и сеть = тишина
            return {"error": str(exc)}
    # Старые Luna: GET без незнакомого им empty_on_timeout.
    legacy_params = {"timeout_ms": timeout_ms}
    if cancel:
        legacy_params["cancel"] = "true"
    legacy = "%s/api/alice/speech?%s" % (LUNA, urllib.parse.urlencode(legacy_params))
    try:
        return get(legacy, timeout=timeout)
    except Exception as exc:  # noqa: BLE001 - таймаут и сеть = тишина
        return {"error": str(exc)}


def alice_state():
    """Текущее состояние штатной Алисы: IDLE, LISTENING, SPEAKING, BUSY."""
    try:
        data = get(BASE + "/cgi-bin/player.py", timeout=4) or {}
    except Exception:  # noqa: BLE001
        return ""
    return str(data.get("alice") or "").strip().upper()


def wait_alice_idle(timeout=8.0):
    """Дождаться, пока штатная Алиса освободит микрофон."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        state = alice_state()
        if state in ("", "IDLE"):
            return True
        time.sleep(0.4)
    return False


def listen_for_phrase(timeout=15.0, skip_request_id="", skip_text=""):
    """Слушать продолжение разговора через Luna recognize.

    Своя сессия CLI здесь не нужна: recognize открывает микрофон без «Алисы»
    и всегда начинает с нового распознавания, поэтому прошлая фраза не
    приходит повторно. cancel=true тут вреден — он гасит диалог, который мы
    только что открыли.
    """
    wait_alice_idle()
    deadline = time.time() + timeout
    while time.time() < deadline:
        left = max(3.0, deadline - time.time())
        event = recognize_event(timeout=left)
        text = str(event.get("text") or "").strip()
        if text:
            request_id = str(event.get("request_id") or "")
            if skip_request_id and request_id and request_id == skip_request_id:
                time.sleep(0.3)
                continue
            if skip_text and normalize(text) == normalize(skip_text):
                time.sleep(0.3)
                continue
            return text
        time.sleep(0.5)
    return ""


def auto_follow_up(info):
    """Нужен ли отдельный follow-up-сеанс.

    В режиме alice он не нужен: Алиса после отменённого ответа сама держит
    микрофон открытым, и следующую фразу пульт прочитает из её же потока.
    """
    return bool(info.get("follow_up")) and mic_mode_now() != "alice"


def follow_up(system, skip_request_id="", skip_text=""):
    """Слушать продолжение разговора без «Алисы» (issue #2)."""
    # После отмены ответа Алиса AI снова открывает микрофон и держит его:
    # кольцо крутится, а нашему recognize звук не достаётся. Закрываем её
    # диалог ещё раз, уже после озвучки.
    try:
        post(LUNA + "/api/alice/speech/cancel", {}, timeout=5)
    except Exception:  # noqa: BLE001
        pass
    wait_alice_idle(3.0)
    log("follow-up: слушаю (alice=%s)" % (alice_state() or "?"))
    for turn in range(1, 4):
        text = listen_for_phrase(skip_request_id=skip_request_id,
                                 skip_text=skip_text)
        skip_request_id = skip_text = ""
        if not text:
            log("follow-up: тишина (alice=%s)" % (alice_state() or "?"))
            return
        log("follow-up %d: %r" % (turn, text))
        if follow_up_wanted(text):
            say("Хорошо.")
            return
        payload = {"prompt": text, "system": system}
        if search_wanted(text):
            payload["search"] = 1
        try:
            answer = post(BASE + "/cgi-bin/llm.py", payload, timeout=90).get("answer")
        except Exception as exc:  # noqa: BLE001
            log("follow-up: llm error: %s" % exc)
            return
        if not answer:
            return
        say(answer)


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


def answer_append(state):
    """append=0 только когда Алиса говорит или думает.

    При закрытом диалоге maind молча проглатывает директиву с append=0,
    поэтому там нужна обычная очередь речи.
    """
    return 0 if str(state or "").strip().upper() in ("BUSY", "SPEAKING") else 1


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
            payload = {"text": chunk, "wait": 30}
            # append=0 заменяет очередь речи — только для первого куска,
            # иначе каждый следующий кусок обрывал бы предыдущий.
            if append == 0 and index == 0:
                payload["append"] = 0
            result = post(BASE + "/cgi-bin/speak.py", payload, timeout=40) or {}
            if not result.get("started"):
                log("say: кусок %d не озвучен: %s" % (index + 1, str(result)[:120]))
        except Exception as exc:  # noqa: BLE001
            log("say: ошибка озвучки: %s" % exc)
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
        cancel_native_dialog()
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

# Фразы, после которых ответ стоит искать в интернете (llm.py сходит в поиск).
SEARCH_WORDS = ("поищи", "найди в интернете", "посмотри в интернете", "погугли",
                "что пишут", "последние новости", "какие новости", "что нового",
                "найди в сети", "поиск в интернете", "что сейчас")


def search_wanted(text):
    low = normalize(text)
    return any(word in low for word in SEARCH_WORDS)


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


def recognize_event(timeout=120):
    """Финальная фраза и её запрос: {"text", "request_id", "phase"}.

    Luna отдаёт `request_id` и `phase` вместе с текстом; по ним демон
    отличает повторную публикацию той же фразы от новой команды.
    """
    try:
        data = post(LUNA + "/api/alice/recognize", {}, timeout=timeout)
    except Exception:
        return {"text": "", "request_id": "", "phase": ""}
    text = ""
    for key in ("transcript", "text"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            text = value.strip()
            break
    if not text:
        value = (data.get("result") or {}).get("transcript")
        text = value.strip() if isinstance(value, str) else ""
    return {
        "text": text,
        "request_id": str(data.get("request_id") or ""),
        "phase": str(data.get("phase") or "").lower(),
    }


def recognize(timeout=120):
    return recognize_event(timeout)["text"]


REPEAT_WINDOW = 30.0
REANNOUNCE_WINDOW = 90.0


def is_repeat(event, last, now):
    """Повтор уже обработанной фразы, а не новая команда.

    aliced присылает ту же фразу ещё раз, когда штатная Алиса переходит в
    BUSY/SPEAKING (через 8–45 с), — с тем же request_id. Режем по нему и по
    фазе busy/speaking: свежая фраза в `listening` так не отбрасывается,
    поэтому настоящий повторный вопрос проходит.
    """
    if not last or not last.get("text"):
        return False
    request_id = event.get("request_id") or ""
    if request_id and request_id == last.get("request_id"):
        return True
    if normalize(event.get("text")) != normalize(last.get("text")):
        return False
    age = now - float(last.get("ts") or 0.0)
    if age < REPEAT_WINDOW:
        return True
    return age < REANNOUNCE_WINDOW and event.get("phase") in ("busy", "speaking")


_LLM_SNAPSHOT = {"at": 0.0, "info": {}}
LLM_CACHE_TTL = 15.0


def refresh_llm_snapshot():
    """Обновить снимок настроек нейросети. HTTP — только здесь, в фоне."""
    try:
        info = llm_info()
    except Exception:  # noqa: BLE001
        info = {}
    if info:
        _LLM_SNAPSHOT["info"] = info
        _LLM_SNAPSHOT["at"] = time.time()
    return _LLM_SNAPSHOT["info"]


def llm_snapshot():
    """Последний снимок без HTTP: на пути к отмене нельзя ждать CGI."""
    return _LLM_SNAPSHOT.get("info") or {}


def llm_enabled_cached():
    info = llm_snapshot()
    if not info:
        return False
    if "voice_enabled" in info:
        return bool(info.get("voice_enabled"))
    if "enabled" in info:
        return bool(info.get("enabled"))
    return bool((info.get("config") or {}).get("enabled"))


def llm_cache_loop():
    while True:
        refresh_llm_snapshot()
        time.sleep(LLM_CACHE_TTL)


def llm_enabled():
    try:
        info = get(BASE + "/cgi-bin/llm.py?info=1")
        if "voice_enabled" in info:
            return bool(info.get("voice_enabled"))
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
        state = str(data.get("alice") or "").strip().upper()
        # Любое активное состояние — LISTENING, SPEAKING, THINKING и т.п. —
        # означает, что Алиса занята и наш микрофон ей только помешает.
        if state and state != "IDLE":
            _NATIVE_LAST_ACTIVE = time.time()
            return True
        if time.time() - _NATIVE_LAST_ACTIVE < 8.0:
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
    "anthropic": ("клод", "клоуд", "claude", "антропик", "anthropic"),
}


def llm_info():
    try:
        return get(BASE + "/cgi-bin/llm.py?info=1", timeout=10) or {}
    except Exception:
        return {}


def llm_profile_target(text, info=None):
    """Найти профиль LLM по фразе: имя, провайдер или известный синоним."""
    info = llm_info() if info is None else info
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


def scenario_may_match(text, missing=True):
    """Быстрая локальная проверка: не дергать scenarios.py зря.

    `missing` — ответ, когда файла нет или он сломан: старому циклу это
    безопасно (решит CGI), а режим alice по нему отменял бы Алису на
    каждой фразе, поэтому он передаёт False.
    """
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
        return missing
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


def handle(text, request_id=""):
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

    llm_on = llm_enabled_cached() if llm_snapshot() else llm_enabled()
    if llm_on and len(normalize(text)) > 2:
        # «свет» — зона реле через «Дом с Алисой», в нейросеть не отправляем.
        if "свет" in normalize(text):
            log("свет: не отдаю в LLM")
            return False
        log("llm <- %r" % text)
        info = llm_snapshot() or llm_info()
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
            payload = {"prompt": text, "system": system}
            # Явный запрос «поищи/что нового» включает поиск даже при
            # выключенной галочке; без триггера поле не отправляем, чтобы
            # работала общая настройка из панели.
            if search_wanted(text):
                payload["search"] = 1
            try:
                box["answer"] = post(BASE + "/cgi-bin/llm.py",
                                     payload, timeout=90).get("answer")
            except Exception as exc:  # noqa: BLE001
                box["error"] = exc

        worker = threading.Thread(target=ask_model, daemon=True)
        started_at = time.time()
        worker.start()
        if mic_mode_now() == "alice":
            # В alice-режиме отмена уже ушла из passive_main; не тратим
            # секунду на сон и не запускаем лишний процесс CLI.
            cancel_native_dialog(fast=True)
        else:
            # «Стоп» в момент распознавания приходит до старта её TTS —
            # повторяем через секунду, когда директива уже активна.
            time.sleep(1.2)
            cancel_native_dialog()
        worker.join(30)

        if "error" in box:
            log("llm error: %s" % box["error"])
            return False
        answer = box.get("answer")
        if answer:
            generation = time.time() - started_at
            if mic_mode_now() == "alice":
                cancel_native_dialog(fast=True)
            else:
                cancel_native_dialog()
            # Чистим очередь TTS Алисы: на unmute её недоигранная фраза
            # возобновляется, и наш ответ встаёт за ней.
            hush_native()
            say(answer, append=answer_append(alice_state()))
            log("llm answer: %d символов, генерация %.1f с"
                % (len(answer), generation))
            # issue #2: после ответа слушаем продолжение без «Алисы».
            if auto_follow_up(info):
                follow_up(system, request_id, text)
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


VOICE_CONFIG = "/data/mypult/voice.json"
_IDLE_CACHE = {"at": 0.0, "ok": True, "why": ""}


def voice_config():
    try:
        with open(VOICE_CONFIG, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def scenario_count():
    """Сколько сценариев настроено. При ошибке CGI считаем, что есть."""
    try:
        data = get(BASE + "/cgi-bin/scenarios.py", timeout=6) or {}
        items = data.get("scenarios")
        return len(items) if isinstance(items, list) else 0
    except Exception:  # noqa: BLE001
        return 1


# --------------------------------------------------------------------------- #
#  Режим alice: читаем фразы, которые уже распознала штатная Алиса
# --------------------------------------------------------------------------- #

NATIVE_KEEP = (
    "стоп", "хватит", "пауза", "на паузу", "продолжи", "дальше",
    "следующ", "предыдущ", "громче", "тише", "громкост",
    "таймер", "будильник", "разбуди", "напомни", "напомин",
    "сколько времени", "который час", "какое сегодня", "какой сегодня",
)

NATIVE_MEDIA = (
    "музык", "песн", "альбом", "плейлист", "трек", "исполнител",
    "групп", "радио", "видео", "фильм", "сериал", "ютуб",
    "телевизор", "позвони", "набери", "закажи", "купи",
)


def native_keep(text):
    """Фразы, которые Алиса делает сама и лучше — даже при включённой сети."""
    low = normalize(text)
    return any(word in low for word in NATIVE_KEEP + NATIVE_MEDIA)


def llm_switch_may_match(text):
    low = normalize(text)
    if "чат" in low:
        return True
    if any(phrase in low for phrase in
           ("какая нейросеть", "что за нейросеть", "какой профиль")):
        return True
    if not any(word in low for word in
               ("нейросет", "профил", "переключ", "включ", "выключ",
                "отключ", "запуст")):
        return False
    return bool(llm_profile_target(low, llm_snapshot()))


def passive_wants(text, llm_on=None):
    """Заберёт ли пульт эту фразу у Алисы (без побочных действий)."""
    low = normalize(text)
    if len(low) <= 2:
        return False
    if scenario_may_match(text, missing=False):
        return True
    intent = match(text)
    if intent:
        # «включи радио …» Алиса делает сама (см. perform).
        return intent[0] != "radio"
    if llm_switch_may_match(text):
        return True
    if "свет" in low or native_keep(text):
        return False
    return llm_enabled_cached() if llm_on is None else bool(llm_on)


def native_phrase(timeout_ms=25000):
    """Следующая фраза штатной Алисы: {"text", "request_id", "phase", "source"}."""
    url = "%s/api/alice/command?%s" % (LUNA, urllib.parse.urlencode(
        {"timeout_ms": timeout_ms, "empty_on_timeout": "true"}))
    try:
        data = get(url, timeout=(timeout_ms / 1000.0) + 5) or {}
    except Exception:  # noqa: BLE001 - сеть/таймаут = тишина
        return {"text": "", "request_id": "", "phase": "", "source": ""}
    return {
        "text": str(data.get("transcript") or "").strip(),
        "request_id": str(data.get("request_id") or ""),
        "phase": str(data.get("phase") or "").lower(),
        "source": str(data.get("source") or ""),
    }


def mic_mode_now(config=None):
    try:
        config = voice_config() if config is None else config
        if not voicecfg:
            return "continuous"
        if str(config.get("mic_mode") or "").strip():
            return voicecfg.resolve_mic_mode(config)
        return voicecfg.resolve_mic_mode(config, voicecfg.device_model())
    except Exception:  # noqa: BLE001
        return "continuous"


def passive_main():
    """Слушать готовые фразы Алисы и забирать только свои.

    Своей сессии распознавания нет: микрофон не занят, фраза приходит через
    0.5–2 с после конца речи, и Алису можно отменить до её ответа.
    """
    log("режим alice: читаю фразы после «Алиса», свой микрофон не открываю")
    seen = []
    last = {}
    while True:
        if mic_mode_now() != "alice":
            log("режим alice выключен")
            return
        if voice_config().get("enabled") is False:
            time.sleep(5)
            continue
        event = native_phrase()
        text = event["text"]
        if not text:
            continue
        request_id = event.get("request_id") or ""
        if request_id and request_id in seen:
            continue
        if is_repeat(event, last, time.time()):
            continue
        if request_id:
            seen.append(request_id)
            del seen[:-32]
        last = {"text": text, "request_id": request_id, "ts": time.time()}
        if not passive_wants(text):
            log("Алисе: %r" % text)
            continue
        # Сначала отмена — это единственное, что должно успеть до BUSY.
        # Глушим Алису сразу: отмена через Luna может опоздать на пару
        # секунд, а тишина в динамике — нет. say() вернёт звук перед TTS.
        cancel_native_dialog(fast=True)
        try:
            post(BASE + "/cgi-bin/volume.py", {"mute": 1}, timeout=5)
        except Exception:  # noqa: BLE001
            pass
        log("перехват: %r (%s, alice=%s)"
            % (text, event.get("phase") or "?", alice_state() or "?"))
        try:
            handle(text, request_id)
        except Exception as exc:  # noqa: BLE001
            log("handle error: %s" % exc)
            time.sleep(1)
        finally:
            try:
                post(BASE + "/cgi-bin/volume.py", {"unmute": 1}, timeout=5)
            except Exception:  # noqa: BLE001
                pass


def listen_allowed():
    """Открывать ли сейчас сессию распознавания.

    `idle=always` — как на Миди: слушаем постоянно, сессия кольцо не трогает.
    `idle=auto` — на Station 2 и подобных: сессия подсвечивает кольцо «слушаю»,
    поэтому в простое без сценариев и нейросети микрофон не открываем.
    """
    now = time.time()
    if now - _IDLE_CACHE["at"] < 15:
        return _IDLE_CACHE["ok"], _IDLE_CACHE["why"]
    ok, why = True, ""
    try:
        config = voice_config()
        if config.get("enabled") is False:
            ok, why = False, "выключен пользователем"
        else:
            mode = voicecfg.resolve_idle(config) if voicecfg else "always"
            if mode == "auto" and not scenario_count() and not llm_enabled():
                ok, why = False, "нет сценариев и нейросети"
    except Exception as exc:  # noqa: BLE001
        log("idle: %s" % exc)
        ok, why = True, ""
    _IDLE_CACHE.update(at=now, ok=ok, why=why)
    return ok, why


def main():
    log("голосовой пульт запущен")
    try:
        log("режим микрофона: %s" % (voicecfg.resolve_mic_mode(voice_config())
                                     if voicecfg else "continuous"))
    except Exception:  # noqa: BLE001
        pass
    # Снимок нейросети нужен до первой фразы: на пути к отмене HTTP нельзя.
    try:
        refresh_llm_snapshot()
    except Exception:  # noqa: BLE001
        pass
    threading.Thread(target=llm_cache_loop, daemon=True).start()
    if alarmd is not None:
        try:
            alarmd.start()
            log("будильники запущены")
        except Exception as exc:  # noqa: BLE001
            log("будильники: %s" % exc)
    threading.Thread(target=scheduler_loop, daemon=True).start()
    threading.Thread(target=autobright_loop, daemon=True).start()
    threading.Thread(target=volume_sync_loop, daemon=True).start()
    threading.Thread(target=disk_cleanup_loop, daemon=True).start()
    last = {}
    idle_reason = ""
    while True:
        if mic_mode_now() == "alice":
            passive_main()
            idle_reason = ""
            continue
        allowed, why = listen_allowed()
        if not allowed:
            if why != idle_reason:
                log("простой: %s — микрофон не открываю" % why)
                idle_reason = why
            time.sleep(5)
            continue
        if idle_reason:
            log("снова слушаю")
            idle_reason = ""
        if native_alice_busy():
            time.sleep(0.6)
            continue
        config = voice_config()
        try:
            mic_mode = voicecfg.resolve_mic_mode(config) if voicecfg else "continuous"
        except Exception:  # noqa: BLE001
            mic_mode = "continuous"
        # В «экономном» режиме сессия короткая и с паузами: у штатной Алисы
        # появляются окна, чтобы поймать wakeword и вернуться в LISTENING.
        session_timeout = 18 if mic_mode == "econom" else 120
        started = time.time()
        try:
            event = recognize_event(timeout=session_timeout)
            text = event["text"]
        except KeyboardInterrupt:
            return
        except Exception as exc:  # noqa: BLE001
            log("recognize error: %s" % exc)
            time.sleep(2)
            continue
        if not text:
            # recognize может вернуться мгновенно с пустым результатом —
            # без паузы получается busy-loop и 100% CPU. В экономном режиме
            # пауза длиннее: это воздух для штатной Алисы.
            time.sleep(1.8 if mic_mode == "econom" else 0.5)
            continue
        # recognize иногда отдаёт одну и ту же фразу несколько раз подряд,
        # причём с паузой больше 4 секунд — держим окно 30 секунд, а повтор
        # с тем же request_id ловим и позже (aliced публикует его на BUSY).
        if is_repeat(event, last, time.time()):
            # Luna иногда отдаёт тот же финальный текст повторно; не занимаем
            # микрофон новым recognize каждые 10 секунд.
            log("повтор, пропускаю: %r (%s)" % (text, event.get("phase") or "?"))
            time.sleep(8)
            continue
        recognized_at = time.time()
        log("распознано за %.1f с: %r" % (recognized_at - started, text))
        last = {"text": text, "request_id": event.get("request_id") or "",
                "ts": recognized_at}
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
            time.sleep(2.0 if mic_mode == "econom" else 0.8)


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
