#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Терминал панели: выполнить команду от root и вернуть вывод.

    POST /cgi-bin/terminal.py {"cmd": "ls -la", "sid": "abc123"}

Сессия хранит только текущий каталог (`cd` работает между командами).
Интерактивные программы (vim, top) не поддерживаются: у команды нет TTY.
Ограничения: длина команды 4000 символов, вывод 200 КБ, таймаут 20 секунд.
"""

from __future__ import annotations

import os
import re
import shlex
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

SESS_DIR = "/tmp/mypult-term"
LOG_PATH = "/data/mypult/terminal.log"
WORKDIR = "/data/myweb"
TIMEOUT = 20
MAX_CMD = 4000
MAX_OUT = 200_000
SID_RE = re.compile(r"^[a-z0-9]{8,32}$")
SHELLS = ("/opt/bin/bash", "/bin/bash", "/bin/sh")


def shell_path():
    for path in SHELLS:
        if os.path.isfile(path):
            return path
    return "/bin/sh"


def clean_sid(value):
    sid = str(value or "").strip().lower()
    return sid if SID_RE.match(sid) else "default0"


def limit_output(text):
    if len(text) <= MAX_OUT:
        return text, False
    return text[:MAX_OUT] + "\n\n… вывод обрезан (200 КБ)", True


def read_text(path, default=""):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read().strip() or default
    except OSError:
        return default


def write_text(path, value):
    try:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(value)
    except OSError:
        pass


def log_command(sid, cmd, code):
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write("%s sid=%s code=%s %s\n" % (
                time.strftime("%Y-%m-%d %H:%M:%S"), sid, code,
                cmd.replace("\n", " ⏎ ")[:500]))
        os.chmod(LOG_PATH, 0o600)
    except OSError:
        pass


def run_command(cmd, cwd, sid):
    """Выполнить команду в bash, вернуть (вывод, код, новый cwd)."""
    os.makedirs(SESS_DIR, exist_ok=True)
    cwd_file = os.path.join(SESS_DIR, "cwd-%s" % sid)
    script = "cd %s 2>/dev/null || cd %s\n%s\npwd > %s 2>/dev/null" % (
        shlex.quote(cwd or WORKDIR), shlex.quote(WORKDIR), cmd, shlex.quote(cwd_file))
    env = os.environ.copy()
    env["PATH"] = "/opt/sbin:/opt/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    env["TERM"] = "dumb"
    env["LANG"] = "C.UTF-8"
    env.pop("HTTP_COOKIE", None)
    try:
        proc = subprocess.run([shell_path(), "-c", script],
                              cwd=WORKDIR, env=env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              timeout=TIMEOUT)
        out = proc.stdout.decode("utf-8", "replace")
        code = proc.returncode
    except subprocess.TimeoutExpired as exc:
        raw = exc.stdout or b""
        out = raw.decode("utf-8", "replace")
        out += "\n[команда прервана: таймаут %d с]" % TIMEOUT
        code = -1
    except OSError as exc:
        out = "не удалось запустить bash: %s" % exc
        code = -1
    new_cwd = read_text(cwd_file, cwd or WORKDIR)
    return out, code, new_cwd


def main():
    common.require_auth()
    data = common.params()
    sid = clean_sid(data.get("sid"))
    cmd = str(data.get("cmd") or "").strip()
    cwd_file = os.path.join(SESS_DIR, "cwd-%s" % sid)
    cwd = read_text(cwd_file, WORKDIR)
    if not cmd:
        common.ok(cwd=cwd, out="", code=0)
        return
    if len(cmd) > MAX_CMD:
        common.fail(400, "команда длиннее %d символов" % MAX_CMD)
        return
    out, code, new_cwd = run_command(cmd, cwd, sid)
    out, truncated = limit_output(out)
    log_command(sid, cmd, code)
    common.ok(out=out, code=code, cwd=new_cwd, truncated=truncated)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
