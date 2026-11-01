#!/usr/bin/env python3
"""Звуки Quasar: список, скачивание, бэкап и замена с конвертацией.

Формат stock-файлов на Миди: Ogg Opus 48 кГц моно и WAV 48 кГц моно.
MP3-файлы можно скачать и сохранить в бэкап, но заменять их пока нельзя:
на колонке нет MP3-энкодера, а подменять расширение опасно.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import wave
import zipfile
from datetime import datetime
from functools import lru_cache

import common

DATA_ROOT = "/data/quasar/data/sounds"
SYSTEM_ROOT = "/system/vendor/quasar/sounds"
BACKUP_ROOT = "/data/mypult/sounds-backup"
CUSTOM_ROOT = "/data/mypult/sounds"
CUSTOM_INDEX = os.path.join(CUSTOM_ROOT, "index.json")
QUASAR = "/system/vendor/quasar"
MAIND = os.path.join(QUASAR, "maind")
GROUPS = ("common", "ru-RU")
SUPPORTED = (".opus", ".wav", ".mp3")
ALL_EXT = (".opus", ".wav", ".mp3")
MAX_UPLOAD = 12 * 1024 * 1024
CUSTOM_NAME_RE = re.compile(r"[A-Za-z0-9_-]{1,40}")


def _custom_name(value):
    name = str(value or "").strip()
    if not CUSTOM_NAME_RE.fullmatch(name):
        raise ValueError("Имя: только латиница, цифры, _ и -, до 40 символов, без пробелов")
    return name


def _custom_name_free(name, current_id=None):
    for item in _custom_index():
        if str(item.get("id")) == current_id:
            continue
        if str(item.get("name") or "").lower() == name.lower():
            raise ValueError("Звук с таким именем уже есть")


DESCRIPTIONS = {
    "spotter_start": "Начало прослушивания",
    "spotter_cancel": "Отмена прослушивания",
    "volume_sound": "Изменение громкости",
    "notification_sound": "Уведомление",
    "timer": "Таймер",
    "boot": "Звук загрузки",
    "calls_busy": "Звонок: занято",
    "calls_checking": "Звонок: проверка",
    "calls_connected": "Звонок: соединён",
    "calls_connecting": "Звонок: соединение",
    "calls_ended": "Звонок: завершён",
    "calls_fail": "Звонок: ошибка",
    "calls_ringing_incoming": "Входящий звонок",
    "calls_ringing_outgoing": "Исходящий звонок",
    "auth_failed": "Ошибка авторизации",
    "backend_unavailable": "Сервер недоступен",
    "no_internet": "Нет интернета",
    "no_internet_1": "Нет интернета",
    "no_internet_reboot": "Нет интернета: перезагрузка",
    "no_internet_reconfigure": "Нет интернета: перенастройка",
    "cannot_connect_to_the_wifi": "Не удалось подключиться к Wi-Fi",
    "wrong_wifi_password": "Неверный пароль Wi-Fi",
    "radio_error": "Ошибка радио",
    "playback_error": "Ошибка воспроизведения",
    "vins_error": "Ошибка Алисы",
    "outgoing_call_failed": "Исходящий звонок не удался",
    "bluetooth_turning_on": "Bluetooth включается",
    "bluetooth_turning_off": "Bluetooth выключается",
    "bluetooth_turning_on_jingle": "Bluetooth включён",
    "bluetooth_turning_off_jingle": "Bluetooth выключен",
    "bluetooth_turning_blocked_by_subscription": "Bluetooth заблокирован подпиской",
}


def _description(name):
    base = os.path.splitext(name)[0].lower()
    if base.startswith("seam_activation_feedback_"):
        return "Отклик на «Алису» (случайный из 9)"
    if base.startswith("alice-iot-sounds-"):
        return "Умный дом"
    return DESCRIPTIONS.get(base, "")



def _custom_index():
    try:
        with open(CUSTOM_INDEX, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _custom_save(items):
    os.makedirs(CUSTOM_ROOT, exist_ok=True)
    common.write_json(CUSTOM_INDEX, items, mode=0o600)


def _custom_id(value):
    value = str(value or "").strip()
    if not re.fullmatch(r"snd-[A-Za-z0-9-]{1,80}", value):
        raise ValueError("некорректный идентификатор звука")
    return value


def _custom_path(sound_id):
    return os.path.join(CUSTOM_ROOT, _custom_id(sound_id) + ".opus")


def _custom_items():
    result = []
    for item in _custom_index():
        try:
            sound_id = _custom_id(item.get("id"))
            path = _custom_path(sound_id)
            if not os.path.isfile(path):
                continue
            result.append({
                "id": sound_id,
                "name": str(item.get("name") or sound_id)[:80],
                "path": "custom/" + sound_id,
                "size": os.path.getsize(path),
                "format": "opus",
                "custom": True,
            })
        except ValueError:
            continue
    return result


def _custom_limit():
    os.makedirs(CUSTOM_ROOT, exist_ok=True)
    return min(MAX_UPLOAD, max(0, _free(CUSTOM_ROOT) - 8 * 1024 * 1024))


def _upload_custom(name):
    raw = _read_upload()
    limit = _custom_limit()
    if len(raw) > limit:
        raise ValueError("не хватает места: максимум %d МБ"
                         % max(1, int(limit / 1048576)))
    name = _custom_name(name)
    _custom_name_free(name)
    tmpdir = tempfile.mkdtemp(prefix="mypult-custom-")
    src = os.path.join(tmpdir, "input")
    dst = os.path.join(tmpdir, "output.opus")
    try:
        with open(src, "wb") as fh:
            fh.write(raw)
        _convert(src, ".opus", dst)
        if os.path.getsize(dst) + 2 * 1024 * 1024 > _free(CUSTOM_ROOT):
            raise ValueError("не хватает места в /data")
        sound_id = "snd-%d-%s" % (int(time.time()), os.urandom(3).hex())
        target = _custom_path(sound_id)
        os.makedirs(CUSTOM_ROOT, exist_ok=True)
        shutil.copyfile(dst, target)
        os.chmod(target, 0o600)
        items = _custom_index()
        items.append({"id": sound_id, "name": name})
        _custom_save(items)
        return {"id": sound_id, "name": name}
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _play_custom(sound_id):
    path = _custom_path(sound_id)
    if not os.path.isfile(path):
        raise ValueError("свой звук не найден")
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = QUASAR + ":libs"
    try:
        proc = subprocess.run(
            [MAIND, "--gst-launch",
             "filesrc location=%s ! decodebin ! audioconvert ! audioresample ! alsasink" % path],
            cwd=QUASAR, env=env, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=120)
        if proc.returncode != 0:
            raise RuntimeError("GStreamer не смог воспроизвести звук")
    except subprocess.TimeoutExpired:
        raise RuntimeError("воспроизведение не уложилось в 120 секунд")


def _safe_rel(value):
    rel = str(value or "").strip().replace("\\", "/")
    if not rel or rel.startswith("/") or ".." in rel.split("/"):
        raise ValueError("некорректный путь")
    parts = rel.split("/")
    if len(parts) != 2 or parts[0] not in GROUPS:
        raise ValueError("неизвестная группа звуков")
    if not re.fullmatch(r"[A-Za-z0-9._@+-]{1,120}", parts[1]):
        raise ValueError("некорректное имя файла")
    return parts[0] + "/" + parts[1]


def _source(rel):
    """Вернуть (путь, system?) для существующего файла."""
    for root, system in ((DATA_ROOT, False), (SYSTEM_ROOT, True)):
        path = os.path.join(root, rel)
        if os.path.isfile(path):
            return path, system
    raise ValueError("звук не найден")


def _backup_path(rel):
    return os.path.join(BACKUP_ROOT, rel)


def _has_backup(rel):
    return os.path.isfile(_backup_path(rel))


def _backup(rel, source):
    dst = _backup_path(rel)
    if os.path.isfile(dst):
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(source, dst)
    os.chmod(dst, 0o600)


def _remount(rw):
    try:
        mode = "rw" if rw else "ro"
        subprocess.run(["mount", "-o", "remount," + mode, "/"],
                       check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=15)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("не удалось перемонтировать rootfs: %s" % exc)


def _write_target(rel, src):
    """Скопировать src в целевой файл; system требует remount."""
    target, system = _source(rel)
    _backup(rel, target)
    if system:
        _remount(True)
    try:
        tmp = target + ".mypult.tmp"
        shutil.copyfile(src, tmp)
        os.chmod(tmp, 0o644)
        os.replace(tmp, target)
        os.sync()
    finally:
        if system:
            _remount(False)


def _restore(rel):
    backup = _backup_path(rel)
    if not os.path.isfile(backup):
        raise ValueError("нет резервной копии")
    target, system = _source(rel)
    if system:
        _remount(True)
    try:
        tmp = target + ".mypult.tmp"
        shutil.copyfile(backup, tmp)
        os.chmod(tmp, 0o644)
        os.replace(tmp, target)
        os.sync()
    finally:
        if system:
            _remount(False)


def _run_gst(pipeline):
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = QUASAR + ":libs"
    try:
        proc = subprocess.run([MAIND, "--gst-launch", pipeline],
                              cwd=QUASAR, env=env,
                              stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE,
                              text=True, timeout=90)
    except subprocess.TimeoutExpired:
        raise RuntimeError("конвертация не уложилась в 90 секунд")
    if proc.returncode != 0:
        lines = [line for line in (proc.stderr or "").splitlines() if "error" in line.lower()]
        detail = lines[-1].split("@@LOG_EVENT@@")[0][-180:] if lines else "GStreamer"
        raise RuntimeError("GStreamer: " + detail)


def _wait_output(path):
    last = -1
    stable = 0
    for _ in range(60):
        try:
            size = os.path.getsize(path)
        except OSError:
            size = 0
        if size > 0 and size == last:
            stable += 1
            if stable >= 3:
                return
        else:
            stable = 0
        last = size
        time.sleep(0.1)
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        raise RuntimeError("GStreamer не создал файл")


def _looks_like_mp3(data):
    if data.startswith(b"ID3"):
        return True
    return len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0


def _convert(src, ext, dst):
    if ext == ".opus":
        _run_gst(
            "filesrc location=%s ! decodebin ! audioconvert ! audioresample ! "
            "audio/x-raw,rate=48000,channels=1 ! opusenc ! oggmux ! filesink location=%s"
            % (src, dst))
        _wait_output(dst)
        with open(dst, "rb") as fh:
            head = fh.read(64)
        if not head.startswith(b"OggS") or b"OpusHead" not in head:
            raise RuntimeError("получился не Ogg Opus")
        return

    if ext == ".wav":
        raw = dst + ".raw"
        _run_gst(
            "filesrc location=%s ! decodebin ! audioconvert ! audioresample ! "
            "audio/x-raw,format=S16LE,rate=48000,channels=1 ! filesink location=%s"
            % (src, raw))
        _wait_output(raw)
        try:
            with open(raw, "rb") as rf, wave.open(dst, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(48000)
                wf.writeframes(rf.read())
        finally:
            try:
                os.unlink(raw)
            except OSError:
                pass
        with wave.open(dst, "rb") as wf:
            if wf.getnframes() <= 0:
                raise RuntimeError("пустой WAV")
        return

    raise ValueError("формат %s пока нельзя заменить: только .opus и .wav" % ext)


def _raw(data, content_type, filename=None):
    headers = [
        ("Content-Type", content_type),
        ("Content-Length", str(len(data))),
        ("Cache-Control", "no-store, max-age=0"),
        ("X-Content-Type-Options", "nosniff"),
    ]
    if filename:
        headers.append(("Content-Disposition",
                        'attachment; filename="%s"' % filename.replace('"', "")))
    head = "Status: 200 OK\r\n" + "".join("%s: %s\r\n" % item for item in headers) + "\r\n"
    out = sys.stdout.buffer
    out.write(head.encode("latin-1"))
    out.write(data)
    out.flush()


def _content_type(name):
    return {
        ".opus": "audio/ogg",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
    }.get(os.path.splitext(name)[1].lower(), "application/octet-stream")


def _items():
    items = []
    for group in GROUPS:
        names = set()
        for root in (DATA_ROOT, SYSTEM_ROOT):
            folder = os.path.join(root, group)
            try:
                for name in os.listdir(folder):
                    if os.path.splitext(name)[1].lower() in ALL_EXT:
                        names.add(name)
            except OSError:
                pass
        for name in sorted(names, key=str.lower):
            rel = group + "/" + name
            try:
                path, system = _source(rel)
            except ValueError:
                continue
            ext = os.path.splitext(name)[1].lower()
            items.append({
                "path": rel,
                "group": group,
                "name": name,
                "description": _description(name),
                "format": ext[1:],
                "size": os.path.getsize(path),
                "source": "system" if system else "data",
                "system": system,
                "writable": ext in SUPPORTED,
                "backup": _has_backup(rel),
                "max_upload": _limit_for(rel),
            })
    return items


def _disk_info():
    result = []
    for mount in ("/", "/data", "/tmp"):
        try:
            stats = os.statvfs(mount)
            total = stats.f_blocks * stats.f_frsize
            free = stats.f_bavail * stats.f_frsize
            result.append({
                "mount": mount,
                "total_mb": round(total / 1048576),
                "free_mb": round(free / 1048576),
                "percent": round((total - free) * 100 / total, 1) if total else 0,
            })
        except OSError:
            pass
    return result


def _read_upload():
    try:
        length = int(os.environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if length <= 0:
        raise ValueError("пустое тело запроса")
    if length > MAX_UPLOAD:
        raise ValueError("файл больше 12 МБ")
    return sys.stdin.buffer.read(length)


def _backup_size():
    total = 0
    for root, _dirs, files in os.walk(BACKUP_ROOT):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


@lru_cache(maxsize=8)
def _free(path):
    stats = os.statvfs(path)
    return stats.f_bavail * stats.f_frsize


def _limit_for(rel):
    """Сколько байт можно принять с учётом места на целевом разделе и в /data."""
    target, system = _source(rel)
    data_free = _free(DATA_ROOT)
    root_free = _free("/")
    target_free = root_free if system else data_free
    reserve = 8 * 1024 * 1024
    original = os.path.getsize(target)
    backup_extra = 0 if _has_backup(rel) else original
    by_target = max(0, target_free - reserve - 1024 * 1024)
    by_data = max(0, data_free - reserve - backup_extra)
    return min(MAX_UPLOAD, by_target, by_data)


def _ensure_space(rel, out_size):
    """Проверить место уже после конвертации: WAV может быть больше входа."""
    target, system = _source(rel)
    reserve = 2 * 1024 * 1024
    backup_extra = 0 if _has_backup(rel) else os.path.getsize(target)
    data_free = _free(DATA_ROOT)
    if system:
        root_free = _free("/")
        if root_free < out_size + reserve:
            raise ValueError("не хватает места на /: нужно %d МБ"
                             % int((out_size + reserve) / 1048576))
        if data_free < backup_extra + reserve:
            raise ValueError("не хватает места в /data для бэкапа")
    elif data_free < out_size + backup_extra + reserve:
        raise ValueError("не хватает места в /data: нужно %d МБ"
                         % int((out_size + backup_extra + reserve) / 1048576))


def _replace(rel, filename):
    ext = os.path.splitext(rel)[1].lower()
    if ext not in SUPPORTED:
        raise ValueError("формат %s пока нельзя заменить" % ext)
    raw = _read_upload()
    limit = _limit_for(rel)
    if len(raw) > limit:
        raise ValueError("не хватает места: максимум %d МБ для этого звука"
                         % max(1, int(limit / 1048576)))
    if ext == ".mp3":
        if not _looks_like_mp3(raw):
            raise ValueError("для .mp3 нужен готовый MP3-файл: энкодера на колонке нет")
        tmpdir = tempfile.mkdtemp(prefix="mypult-snd-")
        src = os.path.join(tmpdir, "input.mp3")
        try:
            with open(src, "wb") as fh:
                fh.write(raw)
            _ensure_space(rel, len(raw))
            _write_target(rel, src)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)
        return {"path": rel, "format": "mp3", "converted": False,
                "backup": _has_backup(rel), "reboot": True}
    tmpdir = tempfile.mkdtemp(prefix="mypult-snd-")
    src = os.path.join(tmpdir, "input")
    dst = os.path.join(tmpdir, "output" + ext)
    try:
        with open(src, "wb") as fh:
            fh.write(raw)
        _convert(src, ext, dst)
        _ensure_space(rel, os.path.getsize(dst))
        _write_target(rel, dst)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    return {"path": rel, "format": ext[1:], "converted": True,
            "backup": _has_backup(rel), "reboot": True}


def main():
    common.require_auth()
    query = urllib.parse.parse_qs(os.environ.get("QUERY_STRING") or "",
                                  keep_blank_values=True)
    method = (os.environ.get("REQUEST_METHOD") or "GET").upper()

    if method == "GET" and "download" in query:
        rel = _safe_rel(query["download"][-1])
        path, _ = _source(rel)
        with open(path, "rb") as fh:
            data = fh.read()
        _raw(data, _content_type(rel), os.path.basename(rel))
        return

    if method == "GET" and "audio" in query:
        rel = _safe_rel(query["audio"][-1])
        path, _ = _source(rel)
        with open(path, "rb") as fh:
            data = fh.read()
        _raw(data, _content_type(rel))
        return

    if method == "GET" and "audio_custom" in query:
        sound_id = _custom_id(query["audio_custom"][-1])
        path = _custom_path(sound_id)
        if not os.path.isfile(path):
            raise ValueError("свой звук не найден")
        with open(path, "rb") as fh:
            data = fh.read()
        _raw(data, "audio/ogg")
        return

    if method == "GET" and "download_custom" in query:
        sound_id = _custom_id(query["download_custom"][-1])
        path = _custom_path(sound_id)
        if not os.path.isfile(path):
            raise ValueError("свой звук не найден")
        with open(path, "rb") as fh:
            data = fh.read()
        _raw(data, "audio/ogg", (sound_id + ".opus"))
        return

    if method == "GET" and "zip" in query:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in _items():
                path, _ = _source(item["path"])
                archive.write(path, item["path"])
        name = "mypult-stock-sounds-%s.zip" % datetime.now().strftime("%Y-%m-%d")
        _raw(buf.getvalue(), "application/zip", name)
        return

    if method == "POST" and "replace" in query:
        rel = _safe_rel(query["replace"][-1])
        filename = str(query.get("filename", ["sound"])[-1])[:120]
        result = _replace(rel, filename)
        common.ok(**result)
        return

    if method == "POST" and query.get("custom"):
        name = str(query.get("name", [""])[-1])[:80]
        result = _upload_custom(name)
        common.ok(created=result, custom=_custom_items())
        return

    data = common.params()
    if method == "POST" and data.get("play_custom"):
        sound_id = _custom_id(data.get("play_custom"))
        _play_custom(sound_id)
        common.ok(played=sound_id)
        return

    if method == "POST" and data.get("delete_custom"):
        sound_id = _custom_id(data.get("delete_custom"))
        path = _custom_path(sound_id)
        try:
            os.unlink(path)
        except OSError:
            pass
        _custom_save([item for item in _custom_index()
                      if str(item.get("id")) != sound_id])
        common.ok(deleted=sound_id, custom=_custom_items())
        return

    if method == "POST" and data.get("rename_custom"):
        sound_id = _custom_id(data.get("rename_custom"))
        if not any(str(item.get("id")) == sound_id for item in _custom_index()):
            raise ValueError("свой звук не найден")
        name = _custom_name(data.get("name"))
        _custom_name_free(name, sound_id)
        items = _custom_index()
        for item in items:
            if str(item.get("id")) == sound_id:
                item["name"] = name
                break
        _custom_save(items)
        common.ok(renamed=sound_id, name=name, custom=_custom_items())
        return

    if method == "POST" and data.get("restore"):
        rel = _safe_rel(data.get("restore"))
        _restore(rel)
        common.ok(restored=rel, reboot=True)
        return

    items = _items()
    custom = _custom_items()
    common.ok(sounds=items, custom=custom, groups=list(GROUPS),
              max_upload=min([item["max_upload"] for item in items] + [MAX_UPLOAD]),
              custom_max_upload=_custom_limit(), custom_root=CUSTOM_ROOT,
              backup_root=BACKUP_ROOT, backup_bytes=_backup_size(),
              disks=_disk_info())


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except ValueError as exc:
        common.fail(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Звуки: %s" % exc)
        except Exception:
            pass
