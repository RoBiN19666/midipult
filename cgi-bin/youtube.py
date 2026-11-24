#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Экспериментальный YouTube Music: поиск и поток через yt-dlp."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import radio  # noqa: E402

DATA_DIR = "/data/mypult"
YTDLP = os.path.join(DATA_DIR, "bin", "yt-dlp")
FFMPEG = "/opt/bin/ffmpeg"
STATE_PATH = os.path.join(DATA_DIR, "youtube_state.json")
URL_CACHE_PATH = os.path.join(DATA_DIR, "youtube_urls.json")
URL_TTL = 300
HLS_ROOT = "/data/myweb/hls"
HLS_PID = "/tmp/mypult-youtube-hls.pid"
HLS_BASE = "http://127.0.0.1:8055/hls"
ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


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


def _search(query, limit=12):
    url = "https://music.youtube.com/search?q=" + urllib.parse.quote(query)
    raw = _run(["--flat-playlist", "--dump-single-json", url])

    def _collect(node, out):
        if isinstance(node, dict):
            if node.get("_type") in (None, "url") and node.get("id") and node.get("title"):
                entry_id = str(node.get("id"))
                if ID_RE.fullmatch(entry_id) and not any(x["id"] == entry_id for x in out):
                    out.append({
                        "id": entry_id,
                        "title": str(node.get("title") or ""),
                        "artist": str(node.get("channel") or node.get("uploader") or ""),
                        "duration": common.to_int(node.get("duration"), 0),
                        "cover": "https://i.ytimg.com/vi/%s/hqdefault.jpg" % entry_id,
                        "url": "https://music.youtube.com/watch?v=" + entry_id,
                    })
            for value in node.values():
                _collect(value, out)
        elif isinstance(node, list):
            for value in node:
                _collect(value, out)

    try:
        data = json.loads(raw or "{}")
    except ValueError:
        raise RuntimeError("yt-dlp вернул не JSON")
    tracks = []
    _collect(data, tracks)
    if not tracks:
        raise RuntimeError("YouTube Music ничего не нашёл")
    return tracks[:limit]


def _cache_get(track_id):
    data = common.read_json(URL_CACHE_PATH, {}) or {}
    item = data.get(track_id) or {}
    if isinstance(item, dict) and item.get("url") and time.time() - float(item.get("ts") or 0) < URL_TTL:
        return str(item["url"])
    return None


def _cache_put(track_id, stream_url):
    data = common.read_json(URL_CACHE_PATH, {}) or {}
    now = time.time()
    data = {key: val for key, val in data.items()
            if isinstance(val, dict) and now - float(val.get("ts") or 0) < URL_TTL}
    data[track_id] = {"url": stream_url, "ts": now}
    if len(data) > 40:
        for key in sorted(data, key=lambda k: data[k].get("ts", 0))[:-40]:
            data.pop(key, None)
    common.write_json(URL_CACHE_PATH, data, mode=0o600)


def _cache_drop(track_id):
    data = common.read_json(URL_CACHE_PATH, {}) or {}
    if track_id in data:
        data.pop(track_id, None)
        common.write_json(URL_CACHE_PATH, data, mode=0o600)


def _stream(track_id):
    """Получить свежий прямой поток; MP3 собирается на лету в прокси."""
    if not ID_RE.fullmatch(track_id):
        raise RuntimeError("Некорректный id видео")
    if not os.path.isfile(FFMPEG):
        raise RuntimeError("ffmpeg не установлен — нужен для MP3-потока")
    cached = _cache_get(track_id)
    if cached:
        return cached
    url = "https://music.youtube.com/watch?v=" + track_id
    raw = _run(["--get-url", "-f", "bestaudio[ext=m4a]/bestaudio", url], timeout=60)
    stream_url = next((line.strip() for line in raw.splitlines() if line.startswith("http")), "")
    if not stream_url:
        raise RuntimeError("yt-dlp не вернул поток")
    _cache_put(track_id, stream_url)
    return stream_url


def _stop_hls():
    try:
        with open(HLS_PID, "r", encoding="ascii") as fh:
            pid = int((fh.read() or "").strip())
        os.kill(pid, 15)
    except (OSError, ValueError):
        pass
    try:
        os.unlink(HLS_PID)
    except OSError:
        pass
    shutil.rmtree(HLS_ROOT, ignore_errors=True)


def _start_hls(track_id, stream_url):
    """Собрать HLS-сегменты на лету; файл целиком не скачивается."""
    _stop_hls()
    folder = os.path.join(HLS_ROOT, track_id)
    os.makedirs(folder, mode=0o755, exist_ok=True)
    playlist = os.path.join(folder, "index.m3u8")
    cmd = [
        FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-tls_verify", "0",
        "-user_agent", ("Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"),
        "-headers", "Referer: https://music.youtube.com/\r\n"
                    "Origin: https://music.youtube.com\r\n",
        "-i", stream_url, "-vn", "-c:a", "aac", "-b:a", "128k",
        "-f", "hls", "-hls_time", "4", "-hls_list_size", "0",
        "-hls_playlist_type", "event",
        "-hls_segment_filename", os.path.join(folder, "seg%05d.ts"), playlist,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with open(HLS_PID, "w", encoding="ascii") as fh:
        fh.write(str(proc.pid))
    deadline = time.time() + 15
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError("ffmpeg не смог собрать HLS")
        if os.path.isfile(playlist) and any(
                name.endswith(".ts") for name in os.listdir(folder)):
            return "%s/%s/index.m3u8" % (HLS_BASE, track_id)
        time.sleep(0.25)
    try:
        proc.kill()
    except Exception:
        pass
    raise RuntimeError("ffmpeg не успел подготовить поток")


def _state():
    return common.read_json(STATE_PATH, {}) or {}


def _save_state(data):
    common.write_json(STATE_PATH, data, mode=0o600)


def main():
    data = common.params()
    action = str(data.get("action") or "status").strip().lower()

    if action == "status":
        common.ok(has_ytdlp=os.path.isfile(YTDLP), has_ffmpeg=os.path.isfile(FFMPEG),
                  track=_state())
        return

    if action == "search":
        query = str(data.get("q") or "").strip()
        if not query:
            raise RuntimeError("Пустой поисковый запрос")
        tracks = _search(query, common.to_int(data.get("limit"), 12, 1, 25))
        common.ok(tracks=tracks)
        return

    if action == "prepare":
        track_id = str(data.get("id") or "").strip()
        _stream(track_id)
        common.ok(prepared=True)
        return

    if action == "play":
        track_id = str(data.get("id") or "").strip()
        title = str(data.get("title") or "YouTube Music")
        artist = str(data.get("artist") or "")
        stream_url = _stream(track_id)
        hls_url = ""
        last_error = None
        for attempt in range(2):
            try:
                hls_url = _start_hls(track_id, stream_url)
                last_error = None
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt == 0:
                    # Кэш прямой ссылки мог истечь; берём свежую и пробуем ещё.
                    _cache_drop(track_id)
                    _stop_hls()
                    stream_url = _stream(track_id)
                    time.sleep(1)
        if last_error is not None:
            _stop_hls()
            _save_state({})
            raise RuntimeError("Поток не запустился: %s" % last_error)
        state = {
            "id": track_id, "title": title, "artist": artist,
            "cover": str(data.get("cover") or ""), "url": stream_url,
            "fmt": "MP3", "stream": hls_url, "hls": hls_url,
        }
        _save_state(state)
        try:
            radio.play_stream(title, hls_url, fmt="MP3", subtitle=artist, wait=4)
        except Exception as exc:  # noqa: BLE001
            _stop_hls()
            _save_state({})
            raise RuntimeError("Поток не запустился: %s" % exc)
        common.now_playing({"service": "youtube", "id": track_id,
                            "title": title, "artist": artist,
                            "cover": str(data.get("cover") or ""),
                            "duration": common.to_int(data.get("duration"), 0)})
        common.ok(playing=True, track=state)
        return

    if action == "stop":
        _stop_hls()
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

