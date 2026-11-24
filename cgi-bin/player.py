#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Что сейчас играет: трек, исполнитель, обложка.

    GET /cgi-bin/player.py

Состояние берётся из локального glagol (`softwareVersion` возвращает
полный `state`), поэтому ничего не опрашивает железо напрямую.
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

try:
    import glagol  # noqa: E402
except Exception:  # noqa: BLE001
    glagol = None


def cover_url(extra):
    cover = (extra or {}).get("coverURI")
    if not cover:
        return None
    if "://" not in cover:
        cover = "https://" + cover
    return cover.replace("%%", "400x400")


def snapshot(force=False):
    """Снимок плеера. Из watcher (пуш), либо запрос softwareVersion.

    force=True — всегда спросить Glagol напрямую: нужно сразу после
    play/pause/stop, когда watcher ещё не получил обновление.
    """
    if glagol is None:
        raise RuntimeError("Модуль glagol недоступен")
    state = None
    age = 0.0
    latest = getattr(glagol, "latest", None)
    if not force and callable(latest):
        state = latest(max_age=15)
        if isinstance(state, dict):
            updated = float((glagol.watch_status() or {}).get("updated") or 0)
            if updated:
                age = max(0.0, time.time() - updated)
    if not isinstance(state, dict):
        reply = glagol.send({"command": "softwareVersion"}, timeout=6)
        state = (reply or {}).get("state") or {}
        age = 0.0
    player = state.get("playerState") or {}
    extra = player.get("extra") or {}
    result = {
        "playing": bool(state.get("playing")),
        "alice": state.get("aliceState"),
        "volume": state.get("volume"),
        "id": player.get("id"),
        "title": player.get("title"),
        "artist": player.get("subtitle"),
        "cover": cover_url(extra),
        "duration": player.get("duration"),
        "progress": player.get("progress"),
        "kind": player.get("type"),
        "playlist_id": player.get("playlistId"),
        "playlist_type": player.get("playlistType"),
        "playlist_puid": player.get("playlistPuid"),
        "prev_id": ((player.get("entityInfo") or {}).get("prev") or {}).get("id"),
        "next_id": ((player.get("entityInfo") or {}).get("next") or {}).get("id"),
        "age": round(age, 2),
    }
    # Glagol не отдаёт название и обложку для наших внешних потоков:
    # подставляем данные из отметки сервиса, если длительность совпадает.
    marker = common.now_playing()
    if result["playing"] and marker:
        mark_duration = float(marker.get("duration") or 0)
        player_duration = float(result.get("duration") or 0)
        same = (not mark_duration or not player_duration or
                abs(mark_duration - player_duration) <= 2)
        fresh = time.time() - float(marker.get("at") or 0) < 6 * 3600
        if same and fresh:
            result["title"] = marker.get("title") or result["title"]
            result["artist"] = marker.get("artist") or result["artist"]
            result["cover"] = marker.get("cover") or result["cover"]
            result["id"] = marker.get("id") or result["id"]
            result["service"] = marker.get("service") or ""
    return result


def main():
    if glagol is None:
        common.fail(501, "Модуль glagol недоступен")
        return

    method = (os.environ.get("REQUEST_METHOD") or "GET").upper()
    if method not in ("GET", "HEAD"):
        # Раньше POST молча возвращал состояние, и казалось, что действие
        # применилось. Управление живёт в media.py.
        common.fail(400, "player.py только читает состояние",
                    hint='действия: POST /cgi-bin/media.py {"action":"play|pause|stop|next|prev"}')
        return

    try:
        data = snapshot()
    except Exception as exc:  # noqa: BLE001
        common.fail(502, "glagol: %s" % exc, hint="проверьте /data/mypult/glagol.json")
        return

    common.ok(**data)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка player.py: %s" % exc)
        except Exception:
            pass
