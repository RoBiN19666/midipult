#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Управление голосовым демоном из панели.

    GET  /cgi-bin/voicectl.py?info=1  — статус
    POST /cgi-bin/voicectl.py {"start":1}
    POST /cgi-bin/voicectl.py {"stop":1}

При старте останавливает alice_light.sh (он тоже занимает recognize),
при остановке — возвращает его.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

DAEMON = "/data/mypult/voice_daemon.py"
PIDFILE = "/data/mypult/voice.pid"
LOG = "/data/mypult/voice.log"
ALICE_LIGHT = "/data/quazar/luna/alice_light.sh"
PY = "/opt/bin/python3"


def read_pid():
    try:
        with open(PIDFILE, "r", encoding="utf-8") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return None


def alive(pid):
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def alice_light_pids():
    code, out, _ = common.run(
        ["/bin/sh", "-c", "ps | grep '[a]lice_light.sh' | awk '{print $1}'"], timeout=6)
    pids = []
    for line in (out or "").splitlines():
        line = line.strip()
        if line.isdigit():
            pids.append(int(line))
    return pids


def stop_alice_light():
    pids = alice_light_pids()
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    return pids


def start_alice_light():
    if not os.path.isfile(ALICE_LIGHT):
        return False
    if alice_light_pids():
        return True
    subprocess.Popen(
        ["/bin/sh", ALICE_LIGHT],
        stdout=open(LOG, "ab"), stderr=subprocess.STDOUT,
        start_new_session=True, close_fds=True,
    )
    return True


def start():
    pid = read_pid()
    if alive(pid):
        return
    if not os.path.isfile(DAEMON):
        raise RuntimeError("нет %s — обновите установку" % DAEMON)
    stop_alice_light()
    log_file = open(LOG, "ab")
    proc = subprocess.Popen(
        [PY, DAEMON],
        stdout=log_file, stderr=subprocess.STDOUT,
        start_new_session=True, close_fds=True,
    )
    with open(PIDFILE, "w", encoding="utf-8") as fh:
        fh.write(str(proc.pid))
    time.sleep(1.0)
    if proc.poll() is not None:
        raise RuntimeError("демон завершился сразу, см. %s" % LOG)


def stop():
    pid = read_pid()
    if alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        for _ in range(20):
            if not alive(pid):
                break
            time.sleep(0.1)
    try:
        os.remove(PIDFILE)
    except OSError:
        pass
    start_alice_light()


def status():
    pid = read_pid()
    return {
        "ok": True,
        "running": alive(pid),
        "pid": pid if alive(pid) else None,
        "alice_light": bool(alice_light_pids()),
        "daemon_present": os.path.isfile(DAEMON),
        "log": None,
    }


def main():
    data = common.params()

    if common.truthy(data.get("start")):
        try:
            start()
        except Exception as exc:  # noqa: BLE001
            common.fail(500, "Не удалось запустить голосовой пульт: %s" % exc)
            return
        common.respond(200, status())
        return

    if common.truthy(data.get("stop")):
        stop()
        common.respond(200, status())
        return

    if common.truthy(data.get("log")):
        try:
            with open(LOG, "r", encoding="utf-8", errors="replace") as fh:
                common.ok(log="".join(fh.readlines()[-40:]))
        except OSError:
            common.ok(log="")
        return

    common.respond(200, status())


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            common.fail(500, "Внутренняя ошибка voicectl.py: %s" % exc)
        except Exception:
            pass
