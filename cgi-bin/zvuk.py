#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Сбер Звук: токен, поиск, «Мой поток» и запуск через штатный плеер станции."""

from __future__ import annotations

import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import radio  # noqa: E402
import zvuk_api  # noqa: E402

DATA_DIR = "/data/mypult"
AUTH_PATH = os.path.join(DATA_DIR, "zvuk.json")
ANON_PATH = os.path.join(DATA_DIR, "zvuk_anon.json")
ANON_TTL = 3600
CACHE_DIR = os.path.join(DATA_DIR, "zvuk-cache")
STATE_PATH = os.path.join(DATA_DIR, "zvuk_state.json")
SELF_URL = "http://127.0.0.1:8055/cgi-bin/zvuk_stream.py"
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
TOKEN_KEY_RE = re.compile(
    r'token["\']?\s*[:=]\s*["\']?([A-Za-z0-9._\-]{16,})', re.I)
RAW_TOKEN_RE = re.compile(r"^[A-Za-z0-9._\-]{16,}$")


def extract_token(raw):
    """Достать токен из вставленного текста: JSON, «token: …» или голой строки."""
    text = str(raw or "").strip()
    if not text:
        return ""
    match = JWT_RE.search(text) or TOKEN_KEY_RE.search(text)
    if match:
        return match.group(0) if match.re is JWT_RE else match.group(1)
    plain = text.strip().strip("\"'")
    if RAW_TOKEN_RE.match(plain):
        return plain
    for part in re.split(r"\s+", text):
        part = part.strip("\"',;")
        if RAW_TOKEN_RE.match(part):
            return part
    return ""


def _player_snapshot():
    try:
        with urllib.request.urlopen(
                "http://127.0.0.1:8055/cgi-bin/player.py", timeout=4) as resp:
            import json
            return json.loads(resp.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _auth():
    return zvuk_api.Auth(AUTH_PATH)


def _api():
    token = _auth().token
    if not token:
        cached = common.read_json(ANON_PATH, {}) or {}
        if cached.get("token") and time.time() - float(cached.get("ts") or 0) < ANON_TTL:
            token = str(cached["token"])
        else:
            try:
                token = zvuk_api.anonymous_token()
                common.write_json(ANON_PATH, {"token": token, "ts": time.time()}, mode=0o600)
            except zvuk_api.Error:
                token = ""
    if not token:
        raise zvuk_api.AuthError("Не удалось получить доступ к Сбер Звуку")
    return zvuk_api.Api(token)


def _clear_state():
    try:
        os.unlink(STATE_PATH)
    except OSError:
        pass


def _state():
    data = common.read_json(STATE_PATH, {}) or {}
    if not data:
        return {}
    # Пока трек только запускается, плеер может ещё не успеть обновиться.
    if time.time() - float(data.get("at") or 0) < 20:
        return data
    snap = _player_snapshot()
    if not snap:
        return data
    title = str(data.get("title") or "").strip().lower()
    playing_title = str(snap.get("title") or "").strip().lower()
    same = bool(title and playing_title and
                (title in playing_title or playing_title in title))
    if not same:
        # В плеере давно другой трек или тишина — состояние устарело.
        _clear_state()
        return {}
    return data


def _save_state(data):
    data = dict(data or {})
    data["at"] = time.time()
    common.write_json(STATE_PATH, data, mode=0o600)


def _track_id(value):
    track_id = str(value or "").strip()
    if not ID_RE.fullmatch(track_id):
        raise zvuk_api.Error("Некорректный id трека")
    return track_id


def _play(data):
    if not _auth().token:
        raise zvuk_api.AuthError(
            "Без аккаунта Сбер Звук даёт только 30 секунд. Войдите на zvuk.com, "
            "скопируйте token со страницы профиля API и сохраните его здесь")
    track_id = _track_id(data.get("id"))
    api = _api()
    url = api.stream_url(track_id)
    os.makedirs(CACHE_DIR, exist_ok=True)
    target = os.path.join(CACHE_DIR, track_id + ".mp3")
    api.download(url, target)
    local = "%s?id=%s" % (SELF_URL, track_id)
    title = str(data.get("title") or "Сбер Звук")
    artist = str(data.get("artist") or "")
    name = (title + (" — " + artist if artist else "")).strip()
    try:
        radio.play_stream(name, local)
    except Exception as exc:  # noqa: BLE001
        raise zvuk_api.Error("Не удалось запустить на станции: %s" % exc)
    state = {
        "id": track_id,
        "title": title,
        "artist": artist,
        "cover": str(data.get("cover") or ""),
        "duration": common.to_int(data.get("duration"), 0),
        "stream": local,
    }
    _save_state(state)
    common.clear_other_states("zvuk")
    common.now_playing({"service": "zvuk", "id": track_id,
                        "title": title, "artist": artist,
                        "cover": str(data.get("cover") or ""),
                        "duration": common.to_int(data.get("duration"), 0)})
    return {"playing": True, "track": state}


def main():
    data = common.params()
    action = str(data.get("action") or "status").strip().lower()
    auth = _auth()

    if action == "status":
        common.ok(has_token=bool(auth.token), track=_state())
        return

    if action == "token":
        raw = str(data.get("token") or "")
        token = extract_token(raw)
        if not token:
            raise zvuk_api.AuthError(
                "Не нашёл токен. Вставьте весь текст со страницы профиля — "
                "строка вида token: \"…\" подойдёт целиком")
        try:
            zvuk_api.account_profile(token)
        except zvuk_api.Error as profile_error:
            # Иногда профиль отдаёт анонимный ответ, хотя GraphQL с токеном
            # уже работает. Проверяем ещё и поиск.
            try:
                zvuk_api.Api(token).search("music", 1)
            except zvuk_api.Error as search_error:
                raise zvuk_api.AuthError(
                    "Токен не принят: %s; поиск: %s" % (profile_error, search_error))
        auth.save(token)
        common.ok(has_token=True)
        return

    if action == "stop":
        _clear_state()
        common.now_playing_clear()
        common.ok(playing=False, track={})
        return

    if action == "clear":
        auth.clear()
        try:
            os.unlink(STATE_PATH)
        except OSError:
            pass
        common.ok(has_token=False)
        return

    if action == "search":
        query = str(data.get("q") or "").strip()
        if not query:
            raise zvuk_api.Error("Пустой поисковый запрос")
        result = _api().search(query, common.to_int(data.get("limit"), 12, 1, 30))
        common.ok(**result)
        return

    if action in ("wave", "my_wave"):
        if not auth.token:
            raise zvuk_api.AuthError("«Мой поток» требует аккаунт Сбер Звука — поиск работает анонимно")
        count = common.to_int(data.get("count"), 12, 1, 30)
        tracks = _api().personal_wave(count)
        common.ok(tracks=tracks)
        return

    if action == "play":
        common.ok(**_play(data))
        return

    raise zvuk_api.Error("Неизвестное действие")


if __name__ == "__main__":
    try:
        main()
    except zvuk_api.AuthError as exc:
        common.fail(401, str(exc))
    except zvuk_api.Error as exc:
        common.fail(502, str(exc))
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка zvuk.py: %s" % exc)
        except Exception:
            pass
