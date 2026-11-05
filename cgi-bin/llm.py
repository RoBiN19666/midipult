#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""LLM через OpenAI-совместимый API: несколько профилей и переключение.

    GET  /cgi-bin/llm.py?info=1           — провайдеры, профили, активный
    POST /cgi-bin/llm.py {"enabled":1}    — включить/выключить (без правки профиля)
    POST /cgi-bin/llm.py {"profile_id","name","provider","model","base_url","key"} — сохранить профиль
    POST /cgi-bin/llm.py {"activate":"deepseek"} — сделать профиль активным
    POST /cgi-bin/llm.py {"delete":"deepseek"}   — удалить профиль
    POST /cgi-bin/llm.py {"prompt":"..."}       — вопрос к активному профилю

Ключи хранятся в /data/mypult/llm.json (600), наружу отдаётся только key_set.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

CONFIG_DIR = "/data/mypult"
CONFIG_PATH = os.path.join(CONFIG_DIR, "llm.json")
CHATS_PATH = os.path.join(CONFIG_DIR, "chats.json")

PROVIDERS = {
    "openai": {
        "title": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "models": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    },
    "openrouter": {
        "title": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "models": [
            "openai/gpt-4o-mini",
            "anthropic/claude-3.5-sonnet",
            "google/gemini-2.0-flash-001",
            "deepseek/deepseek-chat",
        ],
    },
    "deepseek": {
        "title": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "models": ["deepseek-flash", "deepseek-v4-pro"],
    },
    "custom": {
        "title": "Свой сервер (OpenAI-совместимый)",
        "base_url": "",
        "models": [],
    },
}


def slug(text):
    text = re.sub(r"[^a-zа-я0-9]+", "-", (text or "").lower()).strip("-")
    return text[:40] or "profile"


def load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}

    if "profiles" not in data:
        profiles = []
        if data.get("provider") or data.get("key"):
            provider = data.get("provider") or "openai"
            profiles.append({
                "id": "default",
                "name": data.get("name") or PROVIDERS.get(provider, {}).get("title") or "Профиль",
                "provider": provider,
                "model": data.get("model") or "",
                "base_url": data.get("base_url") or PROVIDERS.get(provider, {}).get("base_url", ""),
                "key": data.get("key") or "",
            })
        data = {
            "enabled": bool(data.get("enabled")),
            "active": profiles[0]["id"] if profiles else None,
            "profiles": profiles,
        }

    if not isinstance(data.get("profiles"), list):
        data["profiles"] = []
    if not isinstance(data.get("max_tokens"), int):
        data["max_tokens"] = 260
    if not isinstance(data.get("system_prompt"), str):
        data["system_prompt"] = ""
    return data


def save_config(config):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    try:
        os.chmod(CONFIG_DIR, 0o700)
    except OSError:
        pass
    common.write_json(CONFIG_PATH, config, indent=2)


def public_profile(profile):
    if not profile:
        return None
    return {
        "id": profile.get("id"),
        "name": profile.get("name"),
        "provider": profile.get("provider") or "openai",
        "model": profile.get("model") or "",
        "base_url": profile.get("base_url") or "",
        "key_set": bool(profile.get("key")),
    }


def active_profile(config):
    profiles = config.get("profiles") or []
    active = config.get("active")
    for profile in profiles:
        if profile.get("id") == active:
            return profile
    return profiles[0] if profiles else None


def info(config=None):
    config = config or load_config()
    profiles = config.get("profiles") or []
    active = active_profile(config)
    chats = load_chats()
    chat = active_chat(chats)
    return {
        "ok": True,
        "providers": [
            {"id": key, "title": value["title"], "base_url": value["base_url"], "models": value["models"]}
            for key, value in PROVIDERS.items()
        ],
        "profiles": [public_profile(item) for item in profiles],
        "active": active.get("id") if active else None,
        "active_name": active.get("name") if active else None,
        "voice_enabled": voice_enabled(config),
        # Совместимость со старым API: enabled теперь означает голосовой тумблер.
        "enabled": voice_enabled(config),
        "system_prompt": str(config.get("system_prompt") or ""),
        "config": public_profile(active),
        "max_tokens": int(config.get("max_tokens") or 260),
        "chats": [chat_public(item) for item in chats.get("chats") or []],
        "active_chat": chat.get("id") if chat else None,
        "active_chat_name": chat.get("name") if chat else None,
    }


def load_chats():
    try:
        with open(CHATS_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        data = {}
    chats = data.get("chats") if isinstance(data, dict) else None
    if not isinstance(chats, list) or not chats:
        chats = [{"id": "chat-1", "name": "Чат 1", "messages": []}]
        data = {"active": "chat-1", "chats": chats}
        save_chats(data)
    if not data.get("active") or not any(c.get("id") == data["active"] for c in chats):
        data["active"] = chats[0].get("id")
    return data


def save_chats(data):
    try:
        common.write_json(CHATS_PATH, data, indent=2)
    except OSError:
        pass


def active_chat(data):
    for chat in data.get("chats") or []:
        if chat.get("id") == data.get("active"):
            return chat
    return (data.get("chats") or [None])[0]


def chat_public(chat):
    return {
        "id": chat.get("id"),
        "name": chat.get("name"),
        "messages": len(chat.get("messages") or []),
    }


def voice_enabled(config):
    """Тумблер относится только к голосовым вопросам, не к текстовому API."""
    if "voice_enabled" in config:
        return bool(config.get("voice_enabled"))
    return bool(config.get("enabled"))


def ask(prompt, system=None):
    config = load_config()
    profile = active_profile(config)
    if not profile:
        common.fail(400, "Нет профиля LLM", hint="Добавьте профиль и ключ")
        return
    if not profile.get("key"):
        common.fail(400, "Не задан API-ключ", hint="Вставьте ключ и нажмите «Сохранить»")
        return

    provider = profile.get("provider") or "openai"
    base_url = (profile.get("base_url") or PROVIDERS.get(provider, {}).get("base_url") or "").rstrip("/")
    if not base_url:
        common.fail(400, "Не задан base_url для своего провайдера")
        return
    try:
        base_url = common.url_guard(base_url, allow_http=True, allow_private=True,
                                    allow_loopback=True)
    except ValueError as exc:
        common.fail(400, "Некорректный base_url: %s" % exc)
        return

    chats = load_chats()
    chat = active_chat(chats)

    messages = []
    if not system:
        system = str(config.get("system_prompt") or "").strip()
    if system:
        messages.append({"role": "system", "content": system})
    messages.extend((chat.get("messages") or [])[-10:])
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": profile.get("model") or "gpt-4o-mini",
        "messages": messages,
        "temperature": 0.7,
        # Длина ответа настраивается в панели (260 / 700 / 1400).
        "max_tokens": max(50, min(int(config.get("max_tokens") or 260), 2000)),
    }
    if provider == "deepseek":
        # Без «размышлений» deepseek-flash отвечает ~1.5 с вместо 10–15 с.
        payload["thinking"] = {"type": "disabled"}
    request = urllib.request.Request(
        base_url + "/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + profile["key"],
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read(600).decode("utf-8", "replace")
        except OSError:
            pass
        common.fail(502, "API ответил HTTP %s" % exc.code, detail=detail[:400])
        return
    except (urllib.error.URLError, OSError) as exc:
        common.fail(502, "Нет связи с API: %s" % exc)
        return

    try:
        answer = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        common.fail(502, "Неожиданный ответ API", detail=str(body)[:400])
        return

    answer = answer.strip()
    history = chat.setdefault("messages", [])
    history.append({"role": "user", "content": prompt})
    history.append({"role": "assistant", "content": answer})
    chat["messages"] = history[-20:]
    save_chats(chats)

    common.ok(answer=answer, model=payload["model"], provider=provider,
              profile=profile.get("name"), chat=chat.get("name"),
              chat_id=chat.get("id"), usage=body.get("usage"))


def save_profile(config, data):
    profiles = config.get("profiles") or []
    pid = data.get("profile_id")
    profile = next((item for item in profiles if item.get("id") == pid), None) if pid else None

    name = str(data.get("name") or "").strip()
    provider = str(data.get("provider") or "").strip()
    if provider and provider not in PROVIDERS:
        common.fail(400, "Неизвестный провайдер", providers=list(PROVIDERS))
        return None

    if profile is None:
        base_name = name or (PROVIDERS.get(provider, {}).get("title") if provider else "Профиль")
        pid = slug(base_name)
        existing = {item.get("id") for item in profiles}
        suffix = 2
        candidate = pid
        while candidate in existing:
            candidate = "%s-%d" % (pid, suffix)
            suffix += 1
        profile = {"id": candidate, "name": base_name, "provider": provider or "openai",
                   "model": "", "base_url": "", "key": ""}
        profiles.append(profile)

    if name:
        profile["name"] = name
    if provider:
        profile["provider"] = provider
        if not data.get("base_url") and provider != "custom":
            profile["base_url"] = PROVIDERS[provider]["base_url"]

    model = str(data.get("model") or "").strip()
    if model:
        profile["model"] = model

    base_url = str(data.get("base_url") or "").strip()
    if base_url:
        if not base_url.startswith(("http://", "https://")):
            common.fail(400, "Base URL должен начинаться с http:// или https://")
            return None
        profile["base_url"] = base_url

    key = str(data.get("key") or "").strip()
    if key:
        profile["key"] = key

    config["profiles"] = profiles
    config["active"] = profile["id"]
    if "voice_enabled" in data or "enabled" in data:
        value = common.truthy(data.get("voice_enabled", data.get("enabled")))
        config["voice_enabled"] = value
        config["enabled"] = value
    return profile


CHAT_NAME_LIMIT = 40


def clean_chat_name(raw):
    """Имя чата: без лишних пробелов, кавычек и управляющих символов."""
    name = " ".join(str(raw or "").split()).strip()
    return name.strip("\"'«»“”").strip()


def unique_chat_name(items, name):
    """Не давать двум чатам одинаковое имя: «Работа», «Работа 2», …"""
    base = name
    taken = {clean_chat_name(item.get("name")).casefold() for item in items}
    index = 2
    while name.casefold() in taken:
        name = "%s %d" % (base, index)
        index += 1
    return name


def chat_switch(data):
    chats = load_chats()
    items = chats.get("chats") or []
    current = chats.get("active")
    index = next((i for i, item in enumerate(items) if item.get("id") == current), 0)

    if common.truthy(data.get("chat_new")):
        name = clean_chat_name(data.get("chat_name"))
        if len(name) > CHAT_NAME_LIMIT:
            common.fail(413, "Имя чата длиннее %d символов" % CHAT_NAME_LIMIT)
            return None
        number = len(items) + 1
        chat_id = "chat-%d" % number
        while any(item.get("id") == chat_id for item in items):
            number += 1
            chat_id = "chat-%d" % number
        chat = {"id": chat_id, "name": name or ("Чат %d" % number), "messages": []}
        chat["name"] = unique_chat_name(items, chat["name"])
        items.append(chat)
        chats["active"] = chat["id"]
    elif data.get("chat_rename") is not None:
        target = str(data.get("chat_rename") or current)
        chat = next((item for item in items if item.get("id") == target), None)
        if chat is None:
            common.fail(404, "Чат не найден: %s" % target)
            return None
        name = clean_chat_name(data.get("chat_name"))
        if not name:
            common.fail(400, "Пустое имя чата")
            return None
        if len(name) > CHAT_NAME_LIMIT:
            common.fail(413, "Имя чата длиннее %d символов" % CHAT_NAME_LIMIT)
            return None
        others = [item for item in items if item.get("id") != target]
        chat["name"] = unique_chat_name(others, name)
    elif data.get("chat_delete") is not None:
        target = str(data.get("chat_delete") or current)
        items = [item for item in items if item.get("id") != target]
        if not items:
            items = [{"id": "chat-1", "name": "Чат 1", "messages": []}]
        if chats.get("active") == target:
            chats["active"] = items[min(index, len(items) - 1)]["id"]
    elif data.get("chat_select") is not None:
        target = str(data.get("chat_select"))
        if not any(item.get("id") == target for item in items):
            common.fail(404, "Чат не найден: %s" % target)
            return None
        chats["active"] = target
    else:
        delta = 1 if common.truthy(data.get("chat_next")) else -1
        chats["active"] = items[(index + delta) % len(items)]["id"]

    chats["chats"] = items
    save_chats(chats)
    return chats


def main():
    data = common.params()
    action_keys = ("prompt", "enabled", "voice_enabled", "activate", "delete", "provider", "name", "profile_id",
                   "max_tokens", "system_prompt", "chat_next", "chat_prev", "chat_new", "chat_select",
                   "chat_delete", "chat_rename")
    if common.truthy(data.get("info")) or not any(key in data for key in action_keys):
        common.respond(200, info())
        return

    config = load_config()

    if data.get("max_tokens") is not None:
        config["max_tokens"] = common.to_int(data.get("max_tokens"), 260, 50, 2000)
        save_config(config)
        common.respond(200, info(config))
        return

    if data.get("system_prompt") is not None:
        prompt = str(data.get("system_prompt") or "").strip()
        if len(prompt) > 4000:
            common.fail(413, "Промпт длиннее 4000 символов")
            return
        config["system_prompt"] = prompt
        save_config(config)
        common.respond(200, info(config))
        return

    if any(key in data for key in ("chat_next", "chat_prev", "chat_new", "chat_select",
                                   "chat_delete", "chat_rename")):
        if chat_switch(data) is None:
            return
        common.respond(200, info(config))
        return

    if data.get("activate") is not None:
        pid = str(data.get("activate") or "").strip()
        if not any(item.get("id") == pid for item in config.get("profiles") or []):
            common.fail(404, "Профиль не найден: %s" % pid)
            return
        config["active"] = pid
        if "voice_enabled" in data or "enabled" in data:
            value = common.truthy(data.get("voice_enabled", data.get("enabled")))
            config["voice_enabled"] = value
            config["enabled"] = value
        save_config(config)
        common.respond(200, info(config))
        return

    if data.get("delete") is not None:
        pid = str(data.get("delete") or "").strip()
        config["profiles"] = [item for item in config.get("profiles") or [] if item.get("id") != pid]
        if config.get("active") == pid:
            config["active"] = config["profiles"][0]["id"] if config["profiles"] else None
        save_config(config)
        common.respond(200, info(config))
        return

    if data.get("prompt") is not None:
        prompt = str(data.get("prompt") or "").strip()
        if not prompt:
            common.fail(400, "Пустой запрос")
            return
        if len(prompt) > 4000:
            common.fail(413, "Запрос длиннее 4000 символов")
            return
        ask(prompt, data.get("system"))
        return

    # только тумблер голосовых вопросов, без правки профиля
    if ("voice_enabled" in data or "enabled" in data) and not any(
            key in data for key in ("provider", "name", "profile_id")):
        value = common.truthy(data.get("voice_enabled", data.get("enabled")))
        config["voice_enabled"] = value
        config["enabled"] = value
        save_config(config)
        common.respond(200, info(config))
        return

    profile = save_profile(config, data)
    if profile is None:
        return
    save_config(config)
    common.respond(200, info(config))


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка llm.py: %s" % exc)
        except Exception:
            pass
