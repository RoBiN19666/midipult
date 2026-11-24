#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Лайки и дизлайки Яндекс Музыки через API станции.

    GET  /cgi-bin/musicapi.py          — id текущего трека и liked
    POST /cgi-bin/musicapi.py {"like": 1}    — поставить лайк
    POST /cgi-bin/musicapi.py {"like": 0}    — убрать
    POST /cgi-bin/musicapi.py {"dislike": 1} — «не нравится»

Токен не запрашивается у пользователя: берём OAuth из
/data/quasar/account_storage.dat (тот же, что у Glagol), проверяем через
/account/status и кэшируем uid в /data/mypult/music.json (600). Наружу токен
не отдаём. Идея и эндпоинты — из yapanel-web (dimap/glagol.py).
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

ACCOUNT = "/data/quasar/account_storage.dat"
CACHE = "/data/mypult/music.json"
LIKES_CACHE = "/tmp/mypult-likes.json"
FAVORITES_CACHE = "/tmp/mypult-favorites.json"
API = "https://api.music.yandex.net"
UA = "Yandex-Music-API"
CLIENT = "YandexMusicAndroid/24023621"
TOKEN_RE = re.compile(rb"y0_[A-Za-z0-9_\-]{20,}")


def _request(token, path, form=None, timeout=15, query=None):
    url = API + path + ("?" + urllib.parse.urlencode(query) if query else "")
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    request = urllib.request.Request(
        url, data=data, method="POST" if data is not None else "GET",
        headers={
            "Authorization": "OAuth " + token,
            "User-Agent": UA,
            "X-Yandex-Music-Client": CLIENT,
            "Content-Type": "application/x-www-form-urlencoded",
        })
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", "replace")
    return json.loads(body) if body.strip() else {}


def _tokens():
    try:
        with open(ACCOUNT, "rb") as fh:
            raw = fh.read()
    except OSError:
        return []
    return [match.group(0).decode("ascii") for match in TOKEN_RE.finditer(raw)]


def _cache_read(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def account(force=False):
    """(token, uid) с кэшем; токен наружу не отдаётся."""
    cached = _cache_read(CACHE)
    token = str(cached.get("token") or "")
    uid = str(cached.get("uid") or "")
    if token and uid and not force:
        return token, uid
    for candidate in _tokens():
        try:
            data = _request(candidate, "/account/status", timeout=12)
        except Exception:  # noqa: BLE001
            continue
        account_data = (data.get("result") or {}).get("account") or {}
        found = str(account_data.get("uid") or "")
        if found:
            try:
                common.write_json(CACHE, {"token": candidate, "uid": found})
            except OSError:
                pass
            return candidate, found
    raise RuntimeError("Яндекс Музыка не приняла токен станции")


def _authorized(path, form=None):
    """Запрос с OAuth; при 401 сбрасывает кэш токена и пробует ещё раз."""
    for attempt in (0, 1):
        token, uid = account(force=bool(attempt))
        try:
            return _request(token, path(uid), form=form)
        except urllib.error.HTTPError as exc:
            if exc.code == 401 and attempt == 0:
                try:
                    os.remove(CACHE)
                except OSError:
                    pass
                continue
            raise
    raise RuntimeError("Яндекс Музыка не приняла токен станции")


def likes(force=False):
    cached = _cache_read(LIKES_CACHE)
    if (not force and cached.get("ids") is not None
            and time.time() - float(cached.get("ts") or 0) < 60):
        return set(str(item) for item in cached["ids"])
    data = _authorized(lambda uid: "/users/%s/likes/tracks" % uid)
    library = (data.get("result") or {}).get("library") or {}
    ids = {str(item.get("id")) for item in (library.get("tracks") or [])
           if isinstance(item, dict)}
    try:
        common.write_json(LIKES_CACHE, {"ts": time.time(), "ids": sorted(ids)})
    except OSError:
        pass
    return ids


def set_like(track_id, on):
    action = "add-multiple" if on else "remove"
    _authorized(lambda uid: "/users/%s/likes/tracks/%s" % (uid, action),
                form={"track-ids": str(track_id)})
    return str(track_id) in likes(force=True)


def set_dislike(track_id):
    _authorized(lambda uid: "/users/%s/dislikes/tracks/add-multiple" % uid,
                form={"track-ids": str(track_id)})
    return True


def current_track():
    if player is None:
        return {}
    try:
        snap = player.snapshot()
    except Exception:  # noqa: BLE001
        return {}
    return {
        "id": str(snap.get("id") or ""),
        "title": snap.get("title") or "",
        "artist": snap.get("artist") or "",
        "kind": snap.get("kind"),
    }


def _cover(value):
    text = str(value or "")
    if not text:
        return ""
    if not text.startswith("http"):
        text = "https://" + text
    return text.replace("%%", "300x300")


def _short(item):
    track = item.get("track") if isinstance(item.get("track"), dict) else item
    if not isinstance(track, dict):
        return None
    title = track.get("title") or ""
    if not title:
        return None
    artists = ", ".join(str(a.get("name") or "") for a in (track.get("artists") or [])
                        if isinstance(a, dict))
    duration = track.get("durationMs")
    return {
        "id": str(track.get("id") or ""),
        "title": title,
        "artist": artists,
        "cover": _cover(track.get("coverUri")),
        "duration": int(duration / 1000) if duration else 0,
    }


def _tracks(items):
    out = []
    for item in items or []:
        short = _short(item)
        if short:
            out.append(short)
    return out


def _unique_tracks(tracks):
    out, seen = [], set()
    for track in tracks or []:
        track_id = str(track.get("id") or "")
        if track_id and track_id in seen:
            continue
        if track_id:
            seen.add(track_id)
        out.append(track)
    return out


def _player():
    if player is None:
        return {}
    try:
        return player.snapshot()
    except Exception:  # noqa: BLE001
        return {}


def queue():
    """Очередь по источнику: альбом, плейлист, исполнитель; у радио — соседи."""
    snap = _player()
    kind = str(snap.get("playlist_type") or "")
    playlist_id = str(snap.get("playlist_id") or "")
    current = str(snap.get("id") or "")
    token, uid = account()
    title, tracks = "", []
    if kind == "Album" and playlist_id:
        data = _request(token, "/albums/%s/with-tracks" % playlist_id)
        result = data.get("result") or data
        title = result.get("title") or "Альбом"
        for volume in result.get("volumes") or []:
            tracks.extend(_tracks(volume))
    elif kind == "Playlist" and playlist_id:
        owner, _, playlist = playlist_id.partition(":")
        if not playlist:
            playlist = playlist_id
            owner = str(snap.get("playlist_puid") or uid)
        data = _request(token, "/users/%s/playlists/%s" % (owner, playlist))
        result = data.get("result") or data
        title = result.get("title") or "Плейлист"
        tracks = _tracks(result.get("tracks") or [])
    elif kind == "Artist" and playlist_id:
        data = _request(token, "/artists/%s/tracks" % playlist_id,
                        query={"page-size": 50})
        result = data.get("result") or data
        title = "Треки исполнителя"
        tracks = _tracks(result.get("tracks") or [])
    if not tracks:
        # Радио и одиночный трек: показываем то, что знает Glagol.
        ids = [value for value in (snap.get("prev_id"), current, snap.get("next_id"))
               if value]
        for track_id in ids:
            try:
                data = _request(token, "/tracks/%s" % track_id)
            except Exception:  # noqa: BLE001
                continue
            track = (data.get("result") or [{}])[0]
            short = _short(track)
            if short:
                tracks.append(short)
        title = title or ("Моя волна" if playlist_id == "user:onyourwave"
                          else "Сейчас играет")
    index = 0
    tracks = _unique_tracks(tracks)
    for pos, track in enumerate(tracks):
        if track.get("id") == current:
            index = pos
            break
    return {"title": title or "Очередь", "tracks": tracks[:50], "index": index}


def similar():
    snap = _player()
    track_id = str(snap.get("id") or "")
    if not track_id:
        return {"title": "Похожие", "tracks": []}
    token, _uid = account()
    data = _request(token, "/tracks/%s/similar" % track_id)
    result = data.get("result") or data
    tracks = _unique_tracks(_tracks(result.get("similarTracks") or []))
    if not tracks:
        # Для новых/редких треков Яндекс иногда возвращает пустой similar.
        # Fallback — популярные треки исполнителя, кроме текущего.
        track = result.get("track") or {}
        artist_ids = [str(a.get("id")) for a in (track.get("artists") or [])
                      if isinstance(a, dict) and a.get("id")]
        for artist_id in artist_ids[:2]:
            try:
                artist = _request(token, "/artists/%s/tracks" % artist_id,
                                  query={"page-size": 30})
            except Exception:  # noqa: BLE001
                continue
            artist_result = artist.get("result") or artist
            tracks.extend(_tracks(artist_result.get("tracks") or []))
        tracks = [t for t in _unique_tracks(tracks) if t.get("id") != track_id]
    title = "Похожие на «%s»" % (snap.get("title") or "трек")
    return {"title": title, "tracks": tracks[:30]}


def favorites(limit=20):
    """Избранное: список лайков хранит только id, поэтому догружаем треки."""
    cached = _cache_read(FAVORITES_CACHE)
    if cached.get("data") and time.time() - float(cached.get("ts") or 0) < 120:
        return cached["data"]
    token, uid = account()
    data = _request(token, "/users/%s/likes/tracks" % uid)
    library = (data.get("result") or {}).get("library") or {}
    ids = [str(item.get("id")) for item in (library.get("tracks") or [])
           if isinstance(item, dict)][:limit]
    tracks = []
    for track_id in ids:
        try:
            raw = _request(token, "/tracks/%s" % track_id)
        except Exception:  # noqa: BLE001
            continue
        result = raw.get("result") or []
        short = _short(result[0] if result else {})
        if short:
            tracks.append(short)
    result = {"title": "Мне нравится", "tracks": tracks}
    try:
        common.write_json(FAVORITES_CACHE, {"ts": time.time(), "data": result})
    except OSError:
        pass
    return result


def play_phrase(text):
    phrase = str(text or "").strip()[:180]
    if not phrase:
        raise RuntimeError("пустой запрос")
    try:
        import glagol
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("нет glagol: %s" % exc)
    glagol.send({"command": "sendText", "text": "включи " + phrase}, timeout=20)


def main():
    data = common.params()

    if common.truthy(data.get("queue")):
        try:
            common.ok(**queue())
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "Очередь: %s" % exc)
        return

    if common.truthy(data.get("similar")):
        try:
            common.ok(**similar())
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "Похожие: %s" % exc)
        return

    if common.truthy(data.get("favorites")):
        try:
            common.ok(**favorites())
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "Избранное: %s" % exc)
        return

    if data.get("play") is not None:
        try:
            play_phrase(data.get("play"))
            common.ok(played=True)
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "Включить: %s" % exc)
        return

    if data.get("like") is not None:
        track = current_track()
        if not track.get("id"):
            common.fail(400, "Нет активного трека")
            return
        on = common.truthy(data.get("like"))
        try:
            liked = set_like(track["id"], on)
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "Лайк: %s" % exc)
            return
        common.ok(liked=liked, track=track)
        return

    if common.truthy(data.get("dislike")):
        track = current_track()
        if not track.get("id"):
            common.fail(400, "Нет активного трека")
            return
        try:
            set_dislike(track["id"])
        except Exception as exc:  # noqa: BLE001
            common.fail(502, "Дизлайк: %s" % exc)
            return
        common.ok(disliked=True, track=track)
        return

    track = current_track()
    liked = False
    error = ""
    if track.get("id"):
        try:
            liked = track["id"] in likes()
        except Exception as exc:  # noqa: BLE001
            error = str(exc)[:200]
    common.ok(track=track, liked=liked, error=error)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Музыка: %s" % exc)
        except Exception:
            pass
