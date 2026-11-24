#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Очередь музыки и «волна» для панели и голосового пульта.

Отдельный процесс: сам строит очередь, играет треки, переключает следующий,
умеет seed-режим (запрошенный трек, потом похожее) и настроения волны.
Слушает 127.0.0.1:8899. Запускается по требованию через musicd_client.ensure()
и завершается после 10 минут без очереди и запросов.
"""

from __future__ import annotations

import json
import os
import random
import threading
import time
import urllib.error
import urllib.request
import urllib.parse
import sys

sys.path.insert(0, "/data/myweb/cgi-bin")
try:
    import common
except Exception:  # noqa: BLE001
    common = None

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("MYPULT_MUSICD_PORT") or "8899")
BASE = "http://127.0.0.1:8055"
QUEUE_PATH = "/data/mypult/music_queue.json"
IDLE_EXIT = 600
MOODS = {
    "pop": ("популярная музыка", "хиты"),
    "rock": ("рок музыка", "рок хиты"),
    "calm": ("спокойная музыка", "chillout"),
    "dance": ("танцевальная музыка", "dance hits"),
    "new": ("новинки музыки", "новые песни"),
}
LOCK = threading.Lock()
STATE = {"queue": {}, "last_request": time.time(), "stop": False}


def log(message):
    try:
        with open("/data/mypult/musicd.log", "a", encoding="utf-8") as fh:
            fh.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), message))
    except OSError:
        pass


def post(payload, timeout=120):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        BASE + "/cgi-bin/%s.py" % payload.pop("_service"), data=data, method="POST",
        headers={"Content-Type": "application/json; charset=utf-8",
                 "X-Requested-With": "MidiPult"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", "replace")
    return json.loads(body) if body.strip() else {}


def service_call(service, payload, timeout=120):
    payload = dict(payload)
    payload["_service"] = service
    return post(payload, timeout=timeout)


def search(service, query, limit=20):
    try:
        data = service_call(service, {"action": "search", "q": query, "limit": limit}, timeout=60)
        return list(data.get("tracks") or [])
    except Exception:  # noqa: BLE001
        return []


def mood_query(mood):
    words = MOODS.get(str(mood or "").strip().lower())
    return random.choice(words) if words else random.choice(
        ("музыка", "популярное", "хиты", "лучшее"))


def wave_tracks(service, mood):
    if service == "zvuk" and not mood:
        try:
            data = service_call("zvuk", {"action": "wave", "count": 20}, timeout=60)
            tracks = list(data.get("tracks") or [])
            if tracks:
                return tracks
        except Exception:  # noqa: BLE001
            pass
    tracks = search(service, mood_query(mood))
    random.shuffle(tracks)
    return tracks


def guess_artist(query, title):
    """YouTube отдаёт пустого артиста: вытаскиваем его из исходного запроса."""
    query = str(query or "").strip()
    title = str(title or "").strip()
    if not query or not title:
        return ""
    low_query, low_title = query.lower(), title.lower()
    position = low_query.find(low_title)
    if position <= 0:
        return ""
    artist = query[:position].strip(" -–—:,")
    return artist if len(artist) >= 2 else ""


def related_tracks(service, seed, mood, query=""):
    artist = str((seed or {}).get("artist") or "").strip()
    title = str((seed or {}).get("title") or "").strip()
    if not artist:
        artist = guess_artist(query, title)
    queries = []
    if artist and service == "youtube":
        # ytsearch по одному артисту часто даёт интервью и фестивали.
        queries.append(artist + " songs")
    if artist:
        queries.append(artist)
    if query:
        queries.append(str(query).strip())
    if title:
        queries.append(title)
    queries.append(mood_query(mood))
    for candidate in queries:
        tracks = search(service, candidate, limit=10)
        if not tracks:
            continue
        if service == "youtube":
            noise = ("podcast", "episode", "interview", "shows", "фестиваль",
                     "best ", "top ", "ways", "explains", "review", "reaction",
                     "tutorial", "documentary", "news", "full album")
            cleaned = [tr for tr in tracks
                       if not any(word in str(tr.get("title") or "").lower()
                                  for word in noise)]
            if title:
                seed_title = title.lower()
                cleaned = [tr for tr in cleaned
                           if str(tr.get("title") or "").lower() != seed_title]
            seen_titles, unique = set(), []
            for tr in cleaned:
                key = str(tr.get("title") or "").strip().lower()
                if key and key in seen_titles:
                    continue
                seen_titles.add(key)
                unique.append(tr)
            if unique:
                tracks = unique[:8]
        random.shuffle(tracks)
        return tracks[:10]
    return []


def track_key(track):
    return str((track or {}).get("id") or (track or {}).get("url") or
               (track or {}).get("title") or "")


def dedupe(tracks):
    seen, result = set(), []
    for track in tracks or []:
        key = track_key(track)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(track)
    return result


def play_payload(service, track):
    if service == "youtube":
        return {"action": "play", "id": track.get("id")}
    if service == "soundcloud":
        return {"action": "play", "url": track.get("url"),
                "title": track.get("title"), "artist": track.get("artist")}
    return {"action": "play", "id": track.get("id"),
            "title": track.get("title"),
            "artist": track.get("artist") or track.get("artists"),
            "cover": track.get("cover"), "duration": track.get("duration")}


def play(queue):
    tracks = queue.get("tracks") or []
    index = int(queue.get("index") or 0)
    if index < 0 or index >= len(tracks):
        return False
    track = tracks[index]
    service_call(queue["service"], play_payload(queue["service"], track), timeout=120)
    if common is not None:
        try:
            common.now_playing({
                "service": queue["service"], "id": track.get("id") or "",
                "title": track.get("title") or "",
                "artist": track.get("artist") or track.get("artists") or "",
                "cover": track.get("cover") or "",
                "duration": int(track.get("duration") or 0),
            })
        except Exception:  # noqa: BLE001
            pass
    queue["started_at"] = time.time()
    queue["duration"] = int(track.get("duration") or 0)
    queue["seen"] = False
    queue["last_playing"] = 0
    queue["switching"] = False
    save(queue)
    log("играю %s: %r" % (queue["service"], track.get("title")))
    return True


def save(queue):
    with LOCK:
        STATE["queue"] = dict(queue)
    tmp = QUEUE_PATH + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(queue, fh, ensure_ascii=False)
        os.replace(tmp, QUEUE_PATH)
    except OSError:
        pass


def load():
    try:
        with open(QUEUE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def clear():
    with LOCK:
        STATE["queue"] = {}
    try:
        os.remove(QUEUE_PATH)
    except OSError:
        pass


def start(payload):
    service = str(payload.get("service") or "").strip().lower()
    if service not in ("zvuk", "youtube", "soundcloud"):
        return {"error": "неизвестный сервис"}
    mode = str(payload.get("mode") or "wave").strip().lower()
    if mode not in ("wave", "seed", "single"):
        mode = "wave"
    mood = str(payload.get("mood") or "").strip().lower()
    query = str(payload.get("query") or "").strip()
    first = payload.get("track") if isinstance(payload.get("track"), dict) else None
    if first is None and query:
        found = search(service, query, limit=3)
        first = found[0] if found else None
    tracks = []
    if first:
        tracks.append(first)
        if mode == "seed":
            related = related_tracks(service, first, mood, query)
            tracks = dedupe(tracks + related)
    else:
        tracks = dedupe(wave_tracks(service, mood))
    if not tracks:
        return {"error": "ничего не нашлось"}
    queue = {"service": service, "mode": mode, "mood": mood,
             "seed": first or {}, "seed_query": query,
             "tracks": tracks[:20], "index": 0,
             "started_at": 0, "duration": 0, "seen": False,
             "last_playing": 0, "paused": False}
    try:
        play(queue)
    except Exception as exc:  # noqa: BLE001
        clear()
        return {"error": "%s не ответил: %s" % (service, str(exc)[:120])}
    return {"ok": True, "service": service, "title": (tracks[0] or {}).get("title")}


def next_track(direction=1):
    queue = load()
    if not queue.get("tracks"):
        return {"error": "волна не играет"}
    index = int(queue.get("index") or 0) + direction
    if index >= len(queue["tracks"]):
        mode = queue.get("mode")
        if mode == "single":
            return {"error": "очередь закончилась"}
        if mode == "seed" and queue.get("seed"):
            tracks = related_tracks(queue["service"], queue.get("seed"),
                                    queue.get("mood"), queue.get("seed_query") or "")
        else:
            tracks = wave_tracks(queue["service"], queue.get("mood"))
        if not tracks:
            return {"error": "дальше нечего"}
        queue["tracks"] = dedupe(tracks)[:20]
        index = 0
    if index < 0:
        index = 0
    queue["index"] = index
    queue["paused"] = False
    try:
        play(queue)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)[:160]}
    return {"ok": True, "title": (queue["tracks"][index] or {}).get("title")}


def stop():
    queue = load()
    if queue.get("tracks"):
        try:
            service_call("media", {"action": "stop"}, timeout=20)
        except Exception:  # noqa: BLE001
            pass
    clear()
    log("волна остановлена")
    return {"ok": True}


def pause(on):
    queue = load()
    if not queue.get("tracks"):
        return {"error": "волна не играет"}
    queue["paused"] = bool(on)
    save(queue)
    try:
        service_call("media", {"action": "pause" if on else "play"}, timeout=20)
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "paused": bool(on)}


def status():
    queue = load()
    tracks = queue.get("tracks") or []
    index = int(queue.get("index") or 0)
    title = ""
    if tracks and 0 <= index < len(tracks):
        title = (tracks[index] or {}).get("title") or ""
    return {"ok": True, "active": bool(tracks),
            "service": queue.get("service"), "mode": queue.get("mode"),
            "mood": queue.get("mood"), "paused": bool(queue.get("paused")),
            "index": index, "total": len(tracks), "title": title}


def run_loop():
    while True:
        time.sleep(3)
        queue = load()
        if not queue or not queue.get("tracks") or queue.get("paused"):
            if time.time() - STATE["last_request"] > IDLE_EXIT and not queue.get("tracks"):
                STATE["stop"] = True
                return
            continue
        STATE["last_request"] = time.time()
        try:
            data = service_call("player", {}, timeout=10)
        except Exception:  # noqa: BLE001
            continue
        now = time.time()
        if data.get("playing"):
            queue["seen"] = True
            queue["last_playing"] = now
            # Длительность известна — запускаем следующий за пару секунд до
            # конца, чтобы не было паузы на переключение.
            duration = int(queue.get("duration") or 0)
            started = float(queue.get("started_at") or 0)
            if (duration and not queue.get("switching")
                    and now - started >= duration - 2):
                queue["switching"] = True
                save(queue)
                result = next_track(1)
                if result.get("error"):
                    log("раннее переключение: %s" % result["error"])
            continue
        if not queue.get("seen"):
            continue
        started = float(queue.get("started_at") or 0)
        duration = int(queue.get("duration") or 0)
        ended_by_time = bool(duration) and now - started > duration + 8
        ended_by_stop = now - float(queue.get("last_playing") or started) > 30
        if not (ended_by_time or ended_by_stop):
            continue
        result = next_track(1)
        if result.get("error"):
            log("автопереключение: %s" % result["error"])
            clear()


class Handler(BaseHTTPRequestHandler):
    server_version = "mypult-musicd/1.0"

    def log_message(self, *args):
        pass

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path != "/status":
            self._send(404, {"error": "not found"})
            return
        self._send(200, status())

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except (ValueError, OSError):
            self._send(400, {"error": "bad json"})
            return
        STATE["last_request"] = time.time()
        action = path.rsplit("/", 1)[-1]
        try:
            if action == "start":
                result = start(payload)
            elif action == "stop":
                result = stop()
            elif action == "pause":
                result = pause(True)
            elif action == "resume":
                result = pause(False)
            elif action in ("next", "prev"):
                result = next_track(1 if action == "next" else -1)
            elif action == "status":
                result = status()
            else:
                self._send(404, {"error": "unknown action"})
                return
        except Exception as exc:  # noqa: BLE001
            result = {"error": str(exc)[:200]}
        self._send(200 if not result.get("error") else 400, result)


def main():
    # После падения/перезагрузки старая очередь не должна сама заиграть.
    if load().get("tracks"):
        clear()
    STATE["queue"] = {}
    STATE["last_request"] = time.time()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True
    server.timeout = 1
    threading.Thread(target=run_loop, daemon=True).start()
    log("musicd на 127.0.0.1:%d" % PORT)
    while not STATE["stop"]:
        server.handle_request()
    server.server_close()
    log("musicd завершён по простою")


if __name__ == "__main__":
    main()
