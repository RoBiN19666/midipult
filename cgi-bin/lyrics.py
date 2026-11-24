#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Текст песни из LRCLIB (lrclib.net) — без ключей и без входа в Яндекс Музыку.

    GET /cgi-bin/lyrics.py                         — для текущего трека Glagol
    GET /cgi-bin/lyrics.py?title=…&artist=…&duration=…

Ответ: plain-текст и синхронизированные строки [{t, text}], если LRCLIB их
отдал. Кэш на 10 минут в /tmp: один и тот же трек не дёргает сеть при каждом
открытии панели. Идея из yapanel-web (dimap/glagol.py), спасибо.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

try:
    import player  # noqa: E402
except Exception:  # noqa: BLE001
    player = None

CACHE_PATH = "/tmp/mypult-lyrics.json"
CACHE_TTL = 600
API = "https://lrclib.net/api"
UA = "MidiPult/1.0 (+https://github.com/RoBiN19666/midipult)"


def _fetch(url, timeout=12):
    request = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read(500_000).decode("utf-8", "replace"))


def parse_lrc(text):
    """[mm:ss.xx] строка (в том числе несколько меток в строке) → [{t, text}]."""
    lines = []
    for raw in str(text or "").splitlines():
        raw = raw.strip()
        stamps = re.findall(r"\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]", raw)
        if not stamps:
            continue
        body = re.sub(r"^(?:\[[^\]]+\])+", "", raw).strip()
        if not body:
            continue
        for minutes, seconds, fraction in stamps:
            try:
                moment = int(minutes) * 60 + int(seconds)
                if fraction:
                    moment += int(fraction) / (10 ** len(fraction))
            except ValueError:
                continue
            lines.append({"t": round(moment, 2), "text": body})
    return lines


def _cache_read(key):
    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    entry = (data or {}).get(key)
    if not entry or time.time() - float(entry.get("ts") or 0) > CACHE_TTL:
        return None
    return entry.get("value")


def _cache_write(key, value):
    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            data = {}
    except (OSError, ValueError):
        data = {}
    data[key] = {"ts": time.time(), "value": value}
    try:
        common.write_json(CACHE_PATH, data)
    except OSError:
        pass


def split_artist(title, artist):
    """YouTube/SoundCloud часто отдают «Исполнитель - Название» в title."""
    title = " ".join(str(title or "").split())[:120]
    artist = " ".join(str(artist or "").split())[:120]
    if artist:
        return title, artist
    for separator in (" - ", " – ", " — "):
        if separator in title:
            left, right = title.split(separator, 1)
            left, right = left.strip(), right.strip()
            if left and right:
                return right, left
    return title, artist


def lookup(title, artist, duration=0):
    """Найти текст в LRCLIB. Возвращает (plain, synced) или (None, None)."""
    title, artist = split_artist(title, artist)
    if not title:
        return None, None
    key = "|".join((title.lower(), artist.lower(), str(int(duration or 0))))
    cached = _cache_read(key)
    if cached is not None:
        return cached.get("plain"), cached.get("synced")

    plain = synced = None
    params = {"track_name": title, "artist_name": artist}
    if duration:
        params["duration"] = int(duration)
    try:
        data = _fetch(API + "/get?" + urllib.parse.urlencode(params))
        plain = data.get("plainLyrics")
        synced = parse_lrc(data.get("syncedLyrics"))
    except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError):
        pass

    if not plain and not synced:
        # Точного совпадения нет — ищем и выбираем ближайший по длительности.
        try:
            found = _fetch(API + "/search?" + urllib.parse.urlencode(
                {"q": "%s %s" % (title, artist)}))
            best = None
            best_delta = None
            for item in found if isinstance(found, list) else []:
                if not item.get("plainLyrics") and not item.get("syncedLyrics"):
                    continue
                item_duration = float(item.get("duration") or 0)
                delta = abs(item_duration - duration) if duration and item_duration else 0
                if best is None or (duration and item_duration and delta <= 5
                                    and (best_delta is None or delta < best_delta)):
                    best = item
                    best_delta = delta if duration and item_duration else None
            if best is not None:
                plain = best.get("plainLyrics")
                synced = parse_lrc(best.get("syncedLyrics"))
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError):
            pass

    value = {"plain": plain or "", "synced": synced or []}
    _cache_write(key, value)
    return value["plain"], value["synced"]


def current_track(data):
    title = str(data.get("title") or "").strip()
    artist = str(data.get("artist") or "").strip()
    duration = common.to_int(data.get("duration"), 0, 0, 36000)
    if title:
        title, artist = split_artist(title, artist)
        return title, artist, duration
    if player is None:
        return "", "", 0
    try:
        snap = player.snapshot()
    except Exception:  # noqa: BLE001
        return "", "", 0
    title = str(snap.get("title") or "").strip()
    artist = str(snap.get("artist") or "").strip()
    title, artist = split_artist(title, artist)
    return title, artist, int(float(snap.get("duration") or 0))


def main():
    data = common.params()
    title, artist, duration = current_track(data)
    if not title:
        common.ok(found=False, title="", artist="",
                  error="сейчас ничего не играет")
        return
    plain, synced = lookup(title, artist, duration)
    common.ok(
        found=bool(plain or synced),
        title=title,
        artist=artist,
        duration=duration,
        plain=plain or "",
        synced=synced or [],
        source="LRCLIB",
    )


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Текст песни: %s" % exc)
        except Exception:
            pass
