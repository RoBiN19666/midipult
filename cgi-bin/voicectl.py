#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Управление голосовым демоном из панели.

    GET  /cgi-bin/voicectl.py?info=1  — статус
    POST /cgi-bin/voicectl.py {"start":1}
    POST /cgi-bin/voicectl.py {"stop":1}

Проект управляет только своим голосовым демоном и не трогает другие
пользовательские процессы.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows/тесты
    fcntl = None

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import voicecfg  # noqa: E402

DAEMON = "/data/mypult/voice_daemon.py"
PIDFILE = "/data/mypult/voice.pid"
LOG = "/data/mypult/voice.log"
LOCK = "/tmp/mypult-voice.lock"
PY = "/opt/bin/python3"
LOG_LIMIT = 1024 * 1024


def read_pid():
    try:
        with open(PIDFILE, "r", encoding="utf-8") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return None


def pid_matches(pid):
    """PID из файла должен быть именно нашим демоном, а не чужим после reuse."""
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        with open("/proc/%d/cmdline" % pid, "rb") as fh:
            cmd = fh.read().replace(b"\0", b" ").decode("utf-8", "replace")
        return "voice_daemon.py" in cmd
    except OSError:
        return False


def rotate_log():
    try:
        if os.path.getsize(LOG) > LOG_LIMIT:
            os.replace(LOG, LOG + ".1")
    except OSError:
        pass


def start():
    handle = open(LOCK, "a+", encoding="utf-8")
    try:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        pid = read_pid()
        if pid_matches(pid):
            return
        if not os.path.isfile(DAEMON):
            raise RuntimeError("нет %s — обновите установку" % DAEMON)
        rotate_log()
        log_file = open(LOG, "ab")
        try:
            proc = subprocess.Popen(
                [PY, DAEMON],
                stdout=log_file, stderr=subprocess.STDOUT,
                start_new_session=True, close_fds=True,
            )
        finally:
            log_file.close()
        with open(PIDFILE, "w", encoding="utf-8") as fh:
            fh.write(str(proc.pid))
        time.sleep(1.0)
        if proc.poll() is not None:
            raise RuntimeError("демон завершился сразу, см. %s" % LOG)
    finally:
        if fcntl is not None:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
        handle.close()


def stop():
    pid = read_pid()
    if pid_matches(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        for _ in range(20):
            if not pid_matches(pid):
                break
            time.sleep(0.1)
    try:
        os.remove(PIDFILE)
    except OSError:
        pass


def status():
    pid = read_pid()
    running = pid_matches(pid)
    config = voicecfg.load()
    model = voicecfg.device_model()
    return {
        "ok": True,
        "running": running,
        "pid": pid if running else None,
        "daemon_present": os.path.isfile(DAEMON),
        "log": None,
        "enabled": voicecfg.is_enabled(config),
        "idle": voicecfg.resolve_idle(config),
        "device": model,
        # Панель берёт режим микрофона отсюда: без этого поля селект после
        # обновления страницы показывал первый пункт («Непрерывно»).
        "mic_mode": voicecfg.resolve_mic_mode(config, model),
        "music_voice": voicecfg.music_voice_enabled(config),
        "music_default": voicecfg.resolve_music_default(config),
    }


def set_enabled(value):
    config = voicecfg.load()
    config["enabled"] = bool(value)
    voicecfg.save(config)


def ensure():
    """Поднять демон, только если пользователь его не выключал.

    Возвращает False, если пульт выключен пользователем.
    """
    if not voicecfg.is_enabled(voicecfg.load()):
        return False
    start()
    return True


def main():
    data = common.params()

    if common.truthy(data.get("start")):
        # Пользователь нажал «включить»: запоминаем желание, иначе watchdog
        # поднимет демон обратно через минуту.
        set_enabled(True)
        try:
            start()
        except Exception as exc:  # noqa: BLE001
            common.fail(500, "Не удалось запустить голосовой пульт: %s" % exc)
            return
        common.respond(200, status())
        return

    if common.truthy(data.get("stop")):
        # Пользователь нажал «выключить»: состояние переживает перезагрузку.
        set_enabled(False)
        stop()
        common.respond(200, status())
        return

    if common.truthy(data.get("kill")):
        # Только процесс (S99mypult stop): выбор пользователя не трогаем.
        stop()
        common.respond(200, status())
        return

    if common.truthy(data.get("ensure")):
        # Вызов watchdog/init: поднимаем, только если пользователь не выключал.
        try:
            ensure()
        except Exception as exc:  # noqa: BLE001
            common.fail(500, "Не удалось запустить голосовой пульт: %s" % exc)
            return
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
