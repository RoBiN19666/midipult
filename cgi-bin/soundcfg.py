#!/usr/bin/env python3
"""Звук отклика «Алиса»: чтение и переключение account_config.jingle.

Файл user_config.dat — protobuf-контейнер с JSON. Меняем только участок
"jingle":false ↔ "jingle":true , сохраняя длину JSON, чтобы не пересчитывать
длины protobuf. Оригинал один раз копируется в /data/mypult.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile

import common

CONFIG = "/data/quasar/data/user_config.dat"
BACKUP = "/data/mypult/user_config.dat.bak"
START = b'{"account_config"'


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
            # Проверяем, что JSON остался валидным и нужного размера.
            start = updated.find(START)
            parsed_new, _end = json.JSONDecoder().raw_decode(updated[start:].decode("utf-8"))
            if bool(parsed_new.get("account_config", {}).get("jingle")) != want:
                raise ValueError("флаг jingle не изменился")
            _save(updated)
            raw = updated
            enabled = want

    common.ok(jingle=enabled, reboot=True, backup=BACKUP,
              source="account_config.jingle", config=CONFIG)


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
