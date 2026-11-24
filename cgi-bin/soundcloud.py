#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Экспериментальный SoundCloud: поиск и поток через yt-dlp."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import radio  # noqa: E402

YTDLP = "/data/mypult/bin/yt-dlp"
STATE_PATH = "/data/mypult/soundcloud_state.json"
URL_CACHE_PATH = "/data/mypult/soundcloud_urls.json"
URL_TTL = 300
SELF_URL = "http://127.0.0.1:8055/cgi-bin/soundcloud_stream.py"
ALLOWED_HOSTS = ("soundcloud.com", "api.soundcloud.com", "m.soundcloud.com")


def _run(args, timeout=45):
    if not os.path.isfile(YTDLP):
        raise RuntimeError("yt-dlp не установлен")
    cmd = [sys.executable, YTDLP, "--no-warnings"] + args
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout, text=True)
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip().splitlines()
        raise RuntimeError("yt-dlp: " + (msg[-1] if msg else "ошибка"))
    return proc.stdout


def _duration(value):
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return 0


def _search(query, limit=12):
    raw = _run(["--flat-playlist", "--dump-single-json",
                "scsearch%d:%s" % (max(1, min(limit, 25)), query)])
    try:
        data = json.loads(raw or "{}")
    except ValueError:
        raise RuntimeError("yt-dlp вернул не JSON")
    tracks = []
    for item in data.get("entries") or []:
        if not isinstance(item, dict) or not item.get("id") or not item.get("title"):
            continue
        if item.get("ie_key") != "Soundcloud":
            continue
        page = str(item.get("webpage_url") or item.get("url") or "")
        if not page.startswith("http"):
            page = "https://api.soundcloud.com/tracks/" + str(item["id"])
        thumbs = item.get("thumbnails") or []
        cover = ""
        for thumb in thumbs:
            if thumb.get("id") in ("t300x300", "crop", "large"):
                cover = str(thumb.get("url") or "")
        if not cover and thumbs:
            cover = str(thumbs[-1].get("url") or "")
        tracks.append({
            "id": str(item["id"]),
            "title": str(item.get("title") or ""),
            "artist": str(item.get("uploader") or ""),
            "duration": _duration(item.get("duration")),
            "cover": cover,
            "url": page,
        })
    if not tracks:
        raise RuntimeError("SoundCloud ничего не нашёл")
    return tracks[:limit]


def _state():
    return common.service_state("soundcloud")


def _save_state(data):
    common.write_json(STATE_PATH, data, mode=0o600)


def _check_url(value):
    try:
        parsed = urllib.parse.urlsplit(str(value or ""))
    except ValueError:
        raise RuntimeError("Некорректная ссылка")
    if parsed.scheme not in ("http", "https") or parsed.hostname not in ALLOWED_HOSTS:
        raise RuntimeError("Ссылка не SoundCloud")
    return parsed.geturl()


def _cache_get(page_url):
    data = common.read_json(URL_CACHE_PATH, {}) or {}
    item = data.get(page_url) or {}
    if isinstance(item, dict) and item.get("url") and time.time() - float(item.get("ts") or 0) < URL_TTL:
        return str(item["url"])
    return None


def _cache_put(page_url, stream_url):
    data = common.read_json(URL_CACHE_PATH, {}) or {}
    now = time.time()
    data = {key: val for key, val in data.items()
            if isinstance(val, dict) and now - float(val.get("ts") or 0) < URL_TTL}
    data[page_url] = {"url": stream_url, "ts": now}
    if len(data) > 40:
        for key in sorted(data, key=lambda k: data[k].get("ts", 0))[:-40]:
            data.pop(key, None)
    common.write_json(URL_CACHE_PATH, data, mode=0o600)


def _cache_drop(page_url):
    data = common.read_json(URL_CACHE_PATH, {}) or {}
    if page_url in data:
        data.pop(page_url, None)
        common.write_json(URL_CACHE_PATH, data, mode=0o600)


def _stream(page_url):
    page_url = _check_url(page_url)
    cached = _cache_get(page_url)
    if cached:
        return cached
    raw = _run(["--get-url", "-f", "bestaudio/best", page_url], timeout=60)
    stream_url = next((line.strip() for line in raw.splitlines() if line.startswith("http")), "")
    if not stream_url:
        raise RuntimeError("yt-dlp не вернул поток")
    _cache_put(page_url, stream_url)
    return stream_url


def main():
    data = common.params()
    action = str(data.get("action") or "status").strip().lower()

    if action == "status":
        common.ok(has_ytdlp=os.path.isfile(YTDLP), track=_state())
        return

    if action == "search":
        query = str(data.get("q") or "").strip()
        if not query:
            raise RuntimeError("Пустой поисковый запрос")
        common.ok(tracks=_search(query, common.to_int(data.get("limit"), 12, 1, 25)))
        return

    if action == "prepare":
        page_url = _check_url(data.get("url"))
        _stream(page_url)
        common.ok(prepared=True)
        return

    if action == "play":
        page_url = _check_url(data.get("url"))
        title = str(data.get("title") or "SoundCloud")
        artist = str(data.get("artist") or "")
        stream_url = _stream(page_url)
        track_id = str(data.get("id") or "")
        local = "%s?id=%s" % (SELF_URL, urllib.parse.quote(track_id))
        state = {
            "id": track_id, "title": title, "artist": artist,
            "cover": str(data.get("cover") or ""), "url": stream_url,
            "fmt": "MP3", "stream": local,
        }
        _save_state(state)
        last_error = None
        for attempt in range(2):
            try:
                radio.play_stream(title, local, fmt="MP3", subtitle=artist, wait=7)
                last_error = None
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt == 0:
                    # HLS-ссылка могла устареть, пока играл предыдущий трек.
                    _cache_drop(page_url)
                    stream_url = _stream(page_url)
                    state["url"] = stream_url
                    _save_state(state)
                    time.sleep(1)
        if last_error is not None:
            _save_state({})
            raise RuntimeError("Поток не запустился: %s" % last_error)
        common.now_playing({"service": "soundcloud", "id": track_id,
                            "title": title, "artist": artist,
                            "cover": str(data.get("cover") or ""),
                            "duration": common.to_int(data.get("duration"), 0)})
        common.clear_other_states("soundcloud")
        common.ok(playing=True, track=state)
        return

    if action == "stop":
        _save_state({})
        common.now_playing_clear()
        common.ok(playing=False)
        return

    raise RuntimeError("Неизвестное действие")


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(502, str(exc))
        except Exception:
            pass
