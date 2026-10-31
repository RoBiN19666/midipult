#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Управление плеером через Glagol WebSocket (ws://127.0.0.1:1961).

Точный протокол локального Glagol в прошивке не документирован, поэтому
скрипт отправляет первый вариант кадра из списка, а остальные пробует
только по явному запросу (`probe=1`) или при `fallback=1` — чтобы не
выполнить действие дважды.

Переопределить формат команд можно файлом glagol.conf рядом со скриптом:

    {
      "url": "ws://127.0.0.1:1961",
      "payloads": {
        "play":  [{"event": "play"}],
        "pause": [{"event": "pause"}],
        "next":  [{"event": "next"}],
        "prev":  [{"event": "prev"}],
        "setVolume": [{"event": "setVolume", "volume": "{volume}"}]
      }
    }

CGI:  POST /cgi-bin/media.py  {"action": "play"}
      GET  /cgi-bin/media.py?action=next
      GET  /cgi-bin/media.py?action=play&probe=1
      POST /cgi-bin/media.py  {"raw": {"event": "play"}}
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

try:
    import glagol as glagol_client  # noqa: E402
except Exception:  # noqa: BLE001
    glagol_client = None

# Действия glagol для кнопок плеера (проверено на прошивке 0.369).
GLAGOL_ACTIONS = {
    "play": "play",
    "pause": "stop",
    "next": "next",
    "prev": "prev",
    "stop": "stop",
    "music": "sendText",
    "seek": "rewind",
}

DEFAULT_PAYLOADS = {
    "play": [
        {"event": "play"},
        {"type": "play"},
        {"command": "play"},
        {"action": "play"},
        {"event": {"type": "play"}},
    ],
    "pause": [
        {"event": "pause"},
        {"type": "pause"},
        {"command": "pause"},
        {"action": "pause"},
        {"event": {"type": "pause"}},
    ],
    "toggle": [
        {"event": "playPause"},
        {"event": "toggle"},
        {"type": "toggle"},
    ],
    "next": [
        {"event": "next"},
        {"event": "nextTrack"},
        {"command": "next"},
        {"action": "next"},
        {"event": "skipForward"},
    ],
    "prev": [
        {"event": "prev"},
        {"event": "previous"},
        {"command": "prev"},
        {"action": "prev"},
        {"event": "previousTrack"},
    ],
    "stop": [
        {"event": "stop"},
        {"type": "stop"},
        {"command": "stop"},
    ],
    "setVolume": [
        {"event": "setVolume", "volume": "{volume}"},
        {"event": "setVolume", "value": "{volume}"},
        {"event": "volume", "volume": "{volume}"},
        {"volume": "{volume}"},
    ],
}

ALIASES = {
    "resume": "play",
    "previous": "prev",
    "previousTrack": "prev",
    "nextTrack": "next",
    "pause_toggle": "toggle",
    "volume": "setVolume",
    "setvolume": "setVolume",
}

# Имена действий в Luna /api/media/command.
LUNA_MEDIA = {
    "play": "resume",
    "pause": "pause",
    "next": "next",
    "prev": "previous",
}


def config():
    conf = common.load_glagol_conf()
    # Переменная окружения важнее файла: удобно для проверок и отладки.
    url = os.environ.get("MYPULT_GLAGOL") or str(conf.get("url") or common.GLAGOL_WS)
    payloads = dict(DEFAULT_PAYLOADS)
    custom = conf.get("payloads")
    if isinstance(custom, dict):
        for key, value in custom.items():
            if isinstance(value, list) and value:
                payloads[str(key)] = value
            elif isinstance(value, dict):
                payloads[str(key)] = [value]
    return url, payloads, conf


def render(payload, volume):
    """Подставить громкость в шаблон (числом, а не строкой)."""
    text = json.dumps(payload, ensure_ascii=False)
    text = text.replace('"{volume}"', str(volume))
    text = text.replace("{volume}", str(volume))
    try:
        return json.loads(text)
    except ValueError:
        return payload


def parse_reply(raw):
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return raw


def send_one(url, payload, connect_timeout, reply_timeout):
    raw, error = common.glagol_send(
        payload,
        url=url,
        connect_timeout=connect_timeout,
        reply_timeout=reply_timeout,
    )
    return parse_reply(raw), error


def looks_like_error(reply) -> bool:
    if not isinstance(reply, dict):
        return False
    for key in ("error", "err", "fail", "failure"):
        if reply.get(key):
            return True
    status = reply.get("status")
    if isinstance(status, str) and status.lower() in ("error", "fail", "failed"):
        return True
    ok_flag = reply.get("ok")
    return ok_flag is False


def main():
    data = common.params()
    action = str(data.get("action") or "").strip()
    action = ALIASES.get(action, action)

    url, payloads, conf = config()
    volume = common.to_int(data.get("volume"), default=50, lo=0, hi=100)
    connect_timeout = float(conf.get("connect_timeout") or 3.0)
    reply_timeout = float(conf.get("reply_timeout") or 1.2)

    # Luna умеет /api/media/command, но только когда выбран media provider.
    luna_note = None
    mapped = LUNA_MEDIA.get(action)
    if mapped and data.get("raw") is None:
        try:
            status, media = common.luna_json("/api/media", timeout=4)
        except common.LunaError as exc:
            status, media = 0, {}
            luna_note = "Luna недоступна: %s" % exc
        providers = (media or {}).get("providers") or []
        if status == 200 and providers:
            status2, reply2 = common.luna_json(
                "/api/media/command", {"action": mapped}, timeout=10
            )
            if status2 == 200:
                common.ok(action=action, via="luna", reply=reply2, confirmed=True)
                return
            luna_note = "Luna media/command: HTTP %s %s" % (status2, reply2)
        elif status == 200:
            luna_note = "Luna не видит media provider (/api/media: providers=[])"

    # Основной путь: локальный glagol с токеном устройства.
    glagol_error = None
    glagol_action = GLAGOL_ACTIONS.get(action)
    if glagol_action and data.get("raw") is None and glagol_client is not None:
        try:
            if action == "music":
                # После радио «play» продолжает радио, поэтому музыку
                # запускаем штатной фразой — Алиса включает My Wave.
                reply = glagol_client.send(
                    {"command": "sendText", "text": "включи музыку"}, timeout=20)
            elif action == "seek":
                position = common.to_int(data.get("position"), 0, 0, 86400)
                reply = glagol_client.send(
                    {"command": "rewind", "position": position}, timeout=8)
            else:
                reply = glagol_client.send({"command": glagol_action}, timeout=8)
            state = (reply or {}).get("state") or {}
            player = state.get("playerState") or {}
            summary = {
                "status": (reply or {}).get("status"),
                "playing": state.get("playing"),
                "alice": state.get("aliceState"),
                "volume": state.get("volume"),
                "title": player.get("title"),
            }
            common.ok(action=action, via="glagol", state=summary, confirmed=True)
            return
        except Exception as exc:  # noqa: BLE001
            glagol_error = str(exc)

    if not common.websocket_available():
        common.fail(
            501,
            "Модуль websocket-client не установлен",
            hint="yse install python3-websocket-client",
            luna=luna_note,
        )
        return

    if action in ("", "list", "info") and data.get("raw") is None:
        common.respond(200, {
            "ok": True,
            "url": url,
            "actions": sorted(payloads.keys()),
            "payloads": payloads,
            "websocket": True,
        })
        return

    raw_payload = data.get("raw")
    if raw_payload is not None:
        if isinstance(raw_payload, str):
            try:
                raw_payload = json.loads(raw_payload)
            except ValueError:
                common.fail(400, "Поле raw должно быть JSON-объектом")
                return
        reply, error = send_one(url, raw_payload, connect_timeout, reply_timeout)
        if error:
            common.fail(502, "Glagol недоступен: %s" % error, url=url)
            return
        common.ok(action="raw", sent=raw_payload, reply=reply, confirmed=reply is not None)
        return

    candidates = payloads.get(action)
    if not candidates:
        common.fail(400, "Неизвестное действие", actions=sorted(payloads.keys()))
        return

    candidates = [render(item, volume) for item in candidates]
    probe = common.truthy(data.get("probe"))
    fallback = common.truthy(data.get("fallback"))

    if probe:
        results = []
        for index, payload in enumerate(candidates):
            reply, error = send_one(url, payload, connect_timeout, reply_timeout)
            results.append({
                "index": index,
                "payload": payload,
                "reply": reply,
                "error": error,
                "confirmed": reply is not None,
            })
            if error and "refused" in error.lower():
                break
        worked = [item for item in results if item["confirmed"]]
        common.respond(200, {
            "ok": True,
            "action": action,
            "probe": True,
            "url": url,
            "results": results,
            "confirmed_payload": worked[0]["payload"] if worked else None,
            "note": "Проверка отправляет все варианты: действие может выполниться несколько раз.",
        })
        return

    attempts = []
    chosen = None
    reply = None
    error = None

    for index, payload in enumerate(candidates):
        reply, error = send_one(url, payload, connect_timeout, reply_timeout)
        attempts.append({"payload": payload, "reply": reply, "error": error})
        chosen = payload
        if error:
            break
        if reply is not None:
            break
        if not fallback:
            # Ответа нет — формат может быть другим, но повторять действие
            # без явного разрешения нельзя (next/prev сработают дважды).
            break

    if error:
        hint = "Проверьте, что процесс Glagol слушает 127.0.0.1:1961"
        if luna_note:
            hint = luna_note + "; " + hint
        if glagol_error:
            hint = "glagol: " + glagol_error + "; " + hint
        common.fail(
            502,
            "Glagol недоступен: %s" % error,
            url=url,
            action=action,
            attempts=attempts,
            hint=hint,
            luna=luna_note,
            glagol=glagol_error,
        )
        return

    if reply is not None and looks_like_error(reply):
        common.respond(502, {
            "ok": False,
            "error": "Glagol вернул ошибку",
            "action": action,
            "sent": chosen,
            "reply": reply,
            "attempts": attempts,
        })
        return

    common.ok(
        action=action,
        url=url,
        sent=chosen,
        reply=reply,
        confirmed=reply is not None,
        attempts=len(attempts),
        note=None if reply is not None else "Кадр отправлен, ответа нет (возможно, протокол иной)",
    )


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:
        try:
            common.fail(500, "Внутренняя ошибка media.py: %s" % exc)
        except Exception:
            pass
