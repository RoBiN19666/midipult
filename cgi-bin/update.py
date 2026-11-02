#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Проверка обновлений MidiPult и безопасное самообновление.

CGI:
    GET  /cgi-bin/update.py?info=1      — текущая/последняя версия (кэш 24 ч)
    GET  /cgi-bin/update.py?check=1     — принудительно проверить GitHub
    GET  /cgi-bin/update.py?status=1    — статус воркера
    POST /cgi-bin/update.py             — {"apply": 1} запустить обновление

Воркер запускается отдельной сессией, чтобы перезапуск lighttpd его не убил.
Архив и SHA-256 берутся из assets GitHub Release.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

REPO = "RoBiN19666/midipult"
API_URL = os.environ.get("MYPULT_UPDATE_API") or (
    "https://api.github.com/repos/%s/releases/latest" % REPO)
WEB_ROOT = "/data/myweb"
DATA_ROOT = "/data/mypult"
CACHE_PATH = os.path.join(DATA_ROOT, "update-cache.json")
STATUS_PATH = os.path.join(DATA_ROOT, "update-status.json")
WORKER_LOG = os.path.join(DATA_ROOT, "update-worker.log")
LOCK_PATH = os.path.join(DATA_ROOT, "update.lock")
CACHE_TTL = 24 * 60 * 60
MAX_ARCHIVE = 50 * 1024 * 1024


# --------------------------------------------------------------------------- #
#  Версии и GitHub
# --------------------------------------------------------------------------- #

def current_version():
    for path in (os.path.join(WEB_ROOT, "version.json"),
                 os.path.join(os.path.dirname(__file__), "..", "version.json")):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                value = str(json.load(fh).get("version") or "").strip()
            if value:
                return value
        except (OSError, ValueError, TypeError):
            pass
    return "0.0.0"


def version_tuple(value):
    parts = []
    for item in str(value or "").split("."):
        match = re.match(r"\d+", item)
        parts.append(int(match.group(0)) if match else 0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def newer(latest, current):
    return version_tuple(latest) > version_tuple(current)


def load_cache():
    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def fetch_release():
    request = urllib.request.Request(
        API_URL,
        headers={
            "User-Agent": "MidiPult-Updater/1.0",
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        data = json.loads(response.read().decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("GitHub вернул не объект")
    tag = str(data.get("tag_name") or "").strip()
    version = tag[1:] if tag.lower().startswith("v") else tag
    if not version:
        raise ValueError("В релизе нет tag_name")

    assets = []
    for item in data.get("assets") or []:
        if isinstance(item, dict) and item.get("name") and item.get("browser_download_url"):
            assets.append({
                "name": str(item["name"]),
                "url": str(item["browser_download_url"]),
                "size": int(item.get("size") or 0),
            })
    return {
        "tag": tag,
        "version": version,
        "name": str(data.get("name") or tag),
        "body": str(data.get("body") or "")[:50000],
        "published_at": str(data.get("published_at") or ""),
        "html_url": str(data.get("html_url") or ""),
        "assets": assets,
    }


def release_assets(release, version):
    names = ("midipult-%s.tar.gz" % version,
             "midipult-%s.tar.gz.sha256" % version,
             "midipult-%s.sha256" % version)
    found = {}
    for asset in release.get("assets") or []:
        name = str(asset.get("name") or "")
        if name in names:
            found[name] = asset
    archive = found.get(names[0])
    sha = found.get(names[1]) or found.get(names[2])
    return archive, sha


def check(force=False):
    current = current_version()
    cache = load_cache()
    now = int(time.time())
    cached_at = int(cache.get("checked_at") or 0)
    if cache and not force and now - cached_at < CACHE_TTL:
        cached = dict(cache)
        cached["current"] = current
        cached["cached"] = True
        cached["update_available"] = newer(cached.get("version"), current)
        return cached

    try:
        release = fetch_release()
        archive, sha = release_assets(release, release["version"])
        data = {
            "ok": True,
            "checked_at": now,
            "current": current,
            "version": release["version"],
            "tag": release["tag"],
            "name": release["name"],
            "body": release["body"],
            "published_at": release["published_at"],
            "html_url": release["html_url"],
            "archive": archive,
            "sha": sha,
            "update_available": newer(release["version"], current),
            "cached": False,
        }
        common.write_json(CACHE_PATH, data, mode=0o600)
        return data
    except Exception as exc:  # noqa: BLE001
        if cache:
            stale = dict(cache)
            stale["current"] = current
            stale["cached"] = True
            stale["update_available"] = newer(stale.get("version"), current)
            stale["error"] = "Не удалось проверить GitHub: %s" % exc
            return stale
        return {
            "ok": False,
            "checked_at": now,
            "current": current,
            "update_available": False,
            "error": "Не удалось проверить GitHub: %s" % exc,
        }


def read_status():
    try:
        with open(STATUS_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {"state": "idle"}
    except (OSError, ValueError):
        return {"state": "idle"}


def write_status(**values):
    data = read_status()
    data.update(values)
    data["updated_at"] = int(time.time())
    common.write_json(STATUS_PATH, data, mode=0o600)


def tail_file(path, limit=6000):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()[-limit:]
    except OSError:
        return ""


def public_release(cache):
    return {
        "ok": bool(cache.get("ok")),
        "current": cache.get("current") or current_version(),
        "latest": cache.get("version") or None,
        "tag": cache.get("tag") or None,
        "name": cache.get("name") or "",
        "body": cache.get("body") or "",
        "published_at": cache.get("published_at") or "",
        "html_url": cache.get("html_url") or "",
        "update_available": bool(cache.get("update_available")),
        "checked_at": int(cache.get("checked_at") or 0),
        "cached": bool(cache.get("cached")),
        "error": cache.get("error") or "",
        "archive": cache.get("archive") or None,
        "sha": cache.get("sha") or None,
    }


# --------------------------------------------------------------------------- #
#  Воркер
# --------------------------------------------------------------------------- #

def download(url, path, expected_sha=None):
    request = urllib.request.Request(url, headers={"User-Agent": "MidiPult-Updater/1.0"})
    digest = hashlib.sha256()
    total = 0
    with urllib.request.urlopen(request, timeout=45) as response, open(path, "wb") as out:
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_ARCHIVE:
                raise ValueError("архив больше %d МБ" % (MAX_ARCHIVE // 1024 // 1024))
            digest.update(chunk)
            out.write(chunk)
    if expected_sha and digest.hexdigest().lower() != expected_sha.lower():
        raise ValueError("SHA-256 не совпал")
    return digest.hexdigest()


def fetch_sha(url):
    request = urllib.request.Request(url, headers={"User-Agent": "MidiPult-Updater/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        text = response.read(4096).decode("utf-8", "replace")
    match = re.search(r"\b([0-9a-fA-F]{64})\b", text)
    if not match:
        raise ValueError("в SHA-файле нет хеша")
    return match.group(1).lower()


def extract_archive(path, destination):
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        for member in members:
            name = member.name.replace("\\", "/")
            if name.startswith("/") or ".." in name.split("/"):
                raise ValueError("небезопасный путь в архиве: %s" % name)
            if member.issym() or member.islnk():
                raise ValueError("ссылки в архиве запрещены")
            if not (member.isfile() or member.isdir()):
                raise ValueError("неподдерживаемый элемент архива: %s" % name)
        archive.extractall(destination, members=members, filter="data")


def find_source(root):
    candidates = [root]
    children = [item for item in root.iterdir() if item.is_dir()]
    if len(children) == 1:
        candidates.insert(0, children[0])
    for candidate in candidates:
        if (candidate / "deploy" / "install.sh").is_file() and (candidate / "version.json").is_file():
            return candidate
    raise ValueError("в архиве нет deploy/install.sh и version.json")


def copy_path(src, dst):
    try:
        if os.path.isdir(src):
            shutil.copytree(src, dst, symlinks=True)
        elif os.path.isfile(src):
            shutil.copy2(src, dst)
    except OSError:
        pass


def make_backup(from_version):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = "/data/mypult-update-backup-%s-%s" % (from_version, stamp)
    os.makedirs(backup, exist_ok=True)
    copy_path(WEB_ROOT, os.path.join(backup, "myweb"))
    copy_path("/opt/etc/lighttpd/myweb.conf", os.path.join(backup, "myweb.conf"))
    copy_path("/data/mypult/voice_daemon.py", os.path.join(backup, "voice_daemon.py"))
    copy_path("/data/mypult/state_daemon.py", os.path.join(backup, "state_daemon.py"))
    copy_path("/data/mypult/uninstall.sh", os.path.join(backup, "uninstall.sh"))
    copy_path("/etc/init.d/S99mypult", os.path.join(backup, "S99mypult-etc"))
    copy_path("/opt/etc/init.d/S99mypult", os.path.join(backup, "S99mypult-opt"))
    return backup


def restore_backup(backup):
    if not backup or not os.path.isdir(os.path.join(backup, "myweb")):
        return False
    if os.path.isdir(WEB_ROOT):
        shutil.rmtree(WEB_ROOT, ignore_errors=True)
    shutil.copytree(os.path.join(backup, "myweb"), WEB_ROOT, symlinks=True)
    copy_path(os.path.join(backup, "myweb.conf"), "/opt/etc/lighttpd/myweb.conf")
    for name, destination in (
        ("voice_daemon.py", "/data/mypult/voice_daemon.py"),
        ("state_daemon.py", "/data/mypult/state_daemon.py"),
        ("uninstall.sh", "/data/mypult/uninstall.sh"),
        ("S99mypult-etc", "/etc/init.d/S99mypult"),
        ("S99mypult-opt", "/opt/etc/init.d/S99mypult"),
    ):
        source = os.path.join(backup, name)
        if os.path.isfile(source):
            try:
                shutil.copy2(source, destination)
            except OSError:
                pass
    return True


def restart_panel():
    init = "/etc/init.d/S99mypult"
    if not os.access(init, os.X_OK):
        init = "/opt/etc/init.d/S99mypult"
    if not os.access(init, os.X_OK):
        return
    subprocess.run([init, "restart"], timeout=90,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def cleanup_backups(keep=2):
    try:
        items = sorted(
            (Path("/data").glob("mypult-update-backup-*")),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        return
    for item in items[keep:]:
        shutil.rmtree(str(item), ignore_errors=True)


def worker(version, archive_url, sha_url):
    status = read_status()
    if status.get("state") in ("downloading", "installing", "rollback"):
        return 1
    from_version = current_version()
    backup = ""
    temp = ""
    try:
        write_status(state="downloading", **{"from": from_version, "to": version,
                                             "message": "Скачиваю архив…", "error": "",
                                             "rolled_back": False, "installed": "",
                                             "backup": "", "finished_at": 0})
        os.makedirs(DATA_ROOT, exist_ok=True)
        temp = tempfile.mkdtemp(prefix="mypult-update-", dir="/data")
        archive_path = os.path.join(temp, "release.tar.gz")
        expected = fetch_sha(sha_url)
        download(archive_url, archive_path, expected)
        write_status(state="downloading", message="Проверяю архив…")
        extract_dir = os.path.join(temp, "src")
        os.makedirs(extract_dir, exist_ok=True)
        extract_archive(archive_path, extract_dir)
        source = find_source(Path(extract_dir))
        with open(source / "version.json", "r", encoding="utf-8") as fh:
            archive_version = str(json.load(fh).get("version") or "")
        if archive_version != version:
            raise ValueError("в архиве версия %s, ожидалась %s" % (archive_version, version))
        if not (source / "cgi-bin" / "update.py").is_file():
            raise ValueError("в архиве нет нового update.py")

        write_status(state="installing", message="Делаю резервную копию…")
        backup = make_backup(from_version)
        write_status(state="installing", message="Устанавливаю обновление…", backup=backup)
        log_path = WORKER_LOG
        with open(log_path, "ab") as log:
            log.write(("\n== update %s -> %s ==\n" % (from_version, version)).encode("utf-8"))
            completed = subprocess.run(
                ["/bin/sh", str(source / "deploy" / "install.sh")],
                cwd=str(source), stdout=log, stderr=subprocess.STDOUT, timeout=240,
            )
        if completed.returncode != 0:
            raise RuntimeError("install.sh завершился с кодом %s" % completed.returncode)

        installed = ""
        try:
            with open(os.path.join(WEB_ROOT, "version.json"), "r", encoding="utf-8") as fh:
                installed = str(json.load(fh).get("version") or "")
        except (OSError, ValueError):
            pass
        if installed != version:
            raise RuntimeError("после установки версия %s, ожидалась %s" % (installed, version))

        write_status(state="installing", message="Перезапускаю пульт…")
        restart_panel()
        write_status(state="done", message="Обновление установлено",
                     error="", installed=installed, rolled_back=False,
                     finished_at=int(time.time()))
        cleanup_backups()
        return 0
    except Exception as exc:  # noqa: BLE001
        write_status(state="rollback", message="Откатываю изменения…", error=str(exc)[:1000])
        restored = restore_backup(backup)
        try:
            with open(WORKER_LOG, "a", encoding="utf-8") as log:
                log.write("update failed: %r\nrollback: %s\n" % (exc, restored))
        except OSError:
            pass
        restart_panel()
        write_status(state="error", message="Обновление не установлено",
                     error=str(exc)[:1000], rolled_back=restored,
                     installed=current_version())
        cleanup_backups()
        return 1
    finally:
        if temp:
            shutil.rmtree(temp, ignore_errors=True)
        try:
            os.remove(LOCK_PATH)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
#  CGI
# --------------------------------------------------------------------------- #

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        if len(sys.argv) != 5:
            return 2
        return worker(sys.argv[2], sys.argv[3], sys.argv[4])

    data = common.params()
    if common.truthy(data.get("status")):
        common.ok(status=read_status(), log=tail_file(WORKER_LOG))
        return

    if common.truthy(data.get("apply")):
        cache = check(False)
        if not cache.get("update_available"):
            common.fail(400, "Обновление не требуется", current=cache.get("current"),
                        latest=cache.get("version"))
            return
        archive, sha = cache.get("archive"), cache.get("sha")
        if not archive or not sha:
            common.fail(400, "В релизе нет архива обновления",
                        hint="Нужны assets midipult-<версия>.tar.gz и .sha256")
            return
        current = read_status()
        if current.get("state") in ("queued", "downloading", "installing", "rollback"):
            common.fail(409, "Обновление уже выполняется", status=current)
            return
        try:
            if os.path.exists(LOCK_PATH) and time.time() - os.path.getmtime(LOCK_PATH) > 600:
                os.remove(LOCK_PATH)
            fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.write(fd, str(os.getpid()).encode("ascii"))
            os.close(fd)
        except FileExistsError:
            common.fail(409, "Обновление уже выполняется")
            return
        write_status(state="queued", **{"from": current_version(),
                                        "to": cache.get("version"),
                                        "message": "Запускаю обновление…",
                                        "error": "", "rolled_back": False,
                                        "installed": "", "backup": "",
                                        "finished_at": 0})
        log = open(WORKER_LOG, "ab")
        try:
            subprocess.Popen(
                [sys.executable, os.path.abspath(__file__), "--worker",
                 str(cache.get("version")), archive["url"], sha["url"]],
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True, close_fds=True, cwd=DATA_ROOT,
            )
        finally:
            log.close()
        common.ok(started=True, status=read_status())
        return

    cache = check(common.truthy(data.get("check")))
    common.respond(200, public_release(cache))


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except BrokenPipeError:
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка update.py: %s" % exc)
        except Exception:
            pass
        sys.exit(1)
