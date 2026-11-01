#!/usr/bin/env python3
"""Звук отклика «Алиса»: чтение и переключение account_config.jingle.

Файл user_config.dat — protobuf-контейнер с JSON. Меняем только участок
"jingle":false ↔ "jingle":true , сохраняя длину JSON, чтобы не пересчитывать
длины protobuf. Оригинал один раз копируется в /data/mypult.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import common

CONFIG = "/data/quasar/data/user_config.dat"
BACKUP = "/data/mypult/user_config.dat.bak"
QUASAR_CFG = "/system/vendor/quasar/quasar.cfg"
QUASAR_BACKUP = "/data/mypult/quasar.cfg.bak"
START = b'{"account_config"'


def _quasar_state():
    try:
        with open(QUASAR_CFG, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return bool((data.get("aliced") or {}).get("jingle"))
    except (OSError, ValueError):
        return None


def _backup_quasar():
    if not os.path.isfile(QUASAR_BACKUP):
        os.makedirs(os.path.dirname(QUASAR_BACKUP), exist_ok=True)
        shutil.copy2(QUASAR_CFG, QUASAR_BACKUP)
        os.chmod(QUASAR_BACKUP, 0o600)


def _remount(rw):
    subprocess.run(["mount", "-o", "remount," + ("rw" if rw else "ro"), "/"],
                   check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, timeout=15)


def _set_quasar(enabled):
    with open(QUASAR_CFG, "r", encoding="utf-8") as fh:
        text = fh.read()
    value = "true" if enabled else "false"
    for key in ("jingle", "playStartVoiceInputEarcon"):
        pattern = r'("%s"\s*:\s*)(true|false)' % re.escape(key)
        if len(re.findall(pattern, text)) != 1:
            raise ValueError("в quasar.cfg не найден однозначный %s" % key)
        text = re.sub(pattern, lambda match: match.group(1) + value, text, count=1)
    json.loads(text)  # проверка до записи
    _backup_quasar()
    _remount(True)
    try:
        tmp = QUASAR_CFG + ".mypult.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, QUASAR_CFG)
        os.sync()
    finally:
        _remount(False)



def _load():
    with open(CONFIG, "rb") as fh:
        raw = fh.read()
    start = raw.find(START)
    if start < 0:
        raise ValueError("в user_config.dat не найден account_config")
    text = raw[start:].decode("utf-8")
    data, _end = json.JSONDecoder().raw_decode(text)
    account = data.get("account_config") or {}
    return raw, data, bool(account.get("jingle"))


def _save(raw):
    if not os.path.isfile(BACKUP):
        os.makedirs(os.path.dirname(BACKUP), exist_ok=True)
        shutil.copy2(CONFIG, BACKUP)
        os.chmod(BACKUP, 0o600)
    folder = os.path.dirname(CONFIG)
    fd, tmp = tempfile.mkstemp(prefix=".user_config-", dir=folder)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(raw)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, CONFIG)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def main():
    common.require_auth()
    data = common.params()
    raw, parsed, enabled = _load()

    if (os.environ.get("REQUEST_METHOD") or "GET").upper() == "POST" and "jingle" in data:
        want = common.truthy(data.get("jingle"))
        quasar_before = _quasar_state()
        if want != enabled:
            if want:
                old = b'"jingle":false'
                new = b'"jingle":true '
            else:
                old = b'"jingle":true '
                new = b'"jingle":false'
            if raw.count(old) != 1:
                raise ValueError("не удалось найти однозначный флаг jingle; "
                                 "измените настройку в приложении")
            updated = raw.replace(old, new, 1)
            start = updated.find(START)
            parsed_new, _end = json.JSONDecoder().raw_decode(updated[start:].decode("utf-8"))
            if bool(parsed_new.get("account_config", {}).get("jingle")) != want:
                raise ValueError("флаг jingle не изменился")
            _save(updated)
            raw = updated
            enabled = want
        if quasar_before is not None and quasar_before != want:
            _set_quasar(want)

    common.ok(jingle=enabled, quasar_jingle=_quasar_state(), reboot=True,
              backup=BACKUP, quasar_backup=QUASAR_BACKUP,
              source="account_config.jingle + aliced.jingle/" \
                     "playStartVoiceInputEarcon", config=CONFIG)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except ValueError as exc:
        common.fail(400, str(exc))
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Звук отклика: %s" % exc)
        except Exception:
            pass
