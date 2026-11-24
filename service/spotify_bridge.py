#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Spotify Connect → колонка: spotifyd (pipe) → ffmpeg MP3 → HTTP → Glagol.

Запускается отдельным процессом. spotifyd публикуется в локальной сети как
устройство Spotify Connect; когда с телефона на него отправляют музыку, PCM
из pipe кодируется в MP3 и раздаётся по http://127.0.0.1:8899/stream.mp3.
Как только пошли данные, колонке один раз отдаётся этот URL (radio.play_stream).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = "/data/mypult"
SPOTIFYD = os.path.join(BASE, "spotify", "spotifyd")
LIBS = os.path.join(BASE, "spotify")
CACHE = os.path.join(BASE, "spotify-cache")
FIFO = "/tmp/mypult-spotify.fifo"
HOOK = os.path.join(BASE, "spotify_hook.py")
LOG = os.path.join(BASE, "spotify_bridge.log")
FFMPEG = "/opt/bin/ffmpeg"
PORT = 8899
STREAM_URL = "http://127.0.0.1:%d/stream.mp3" % PORT
BUFFER_LIMIT = 2_000_000

BUFFER = bytearray()
COND = threading.Condition()
STATE = {"last_data": 0.0, "station_started": 0.0}
PROCS = {"spotifyd": None, "ffmpeg": None}


def log(message):
    line = "%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), message)
    try:
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(line)
    except OSError:
        pass


HOOK_SOURCE = '''#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Хук spotifyd: событие песни → отметка для карточки «Сейчас»."""
import json
import os
import sys

sys.path.insert(0, "/data/myweb/cgi-bin")
try:
    import common
except Exception:
    raise SystemExit(0)

event = os.environ.get("PLAYER_EVENT") or ""
data = {
    "service": "spotify",
    "id": os.environ.get("TRACK_ID") or "",
    "title": os.environ.get("TRACK") or os.environ.get("TITLE") or "Spotify",
    "artist": os.environ.get("ARTIST") or "",
    "cover": os.environ.get("COVER") or "",
    "duration": int(float(os.environ.get("DURATION") or 0)),
}
if event in ("start", "change"):
    common.now_playing(data)
elif event == "stop":
    common.now_playing_clear()
'''


def ensure_files():
    os.makedirs(CACHE, exist_ok=True)
    if not os.path.isfile(HOOK):
        with open(HOOK, "w", encoding="utf-8") as fh:
            fh.write(HOOK_SOURCE)
        os.chmod(HOOK, 0o755)


def start_spotifyd():
    try:
        os.unlink(FIFO)
    except OSError:
        pass
    os.mkfifo(FIFO, 0o600)
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = LIBS
    cmd = [SPOTIFYD, "--no-daemon", "--backend", "pipe", "--device", FIFO,
           "--cache-path", CACHE, "--device-name", "MidiPult",
           "--on-song-change-hook", "/opt/bin/python3 " + HOOK]
    logfile = open(os.path.join(BASE, "spotifyd.log"), "ab", buffering=0)
    proc = subprocess.Popen(cmd, env=env, stdout=logfile, stderr=logfile,
                            close_fds=True)
    PROCS["spotifyd"] = proc
    log("spotifyd запущен, pid %d" % proc.pid)


def ffmpeg_loop():
    """Читает PCM из FIFO, кодирует в MP3 и складывает в общий буфер."""
    while True:
        if not os.path.exists(FIFO):
            os.mkfifo(FIFO, 0o600)
        cmd = [FFMPEG, "-hide_banner", "-loglevel", "error",
               "-f", "s16le", "-ar", "44100", "-ac", "2", "-i", FIFO,
               "-codec:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"]
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL)
        except Exception as exc:  # noqa: BLE001
            log("ffmpeg не запустился: %s" % exc)
            time.sleep(5)
            continue
        PROCS["ffmpeg"] = proc
        log("ffmpeg читает %s" % FIFO)
        while True:
            chunk = proc.stdout.read(16384)
            if not chunk:
                break
            with COND:
                BUFFER.extend(chunk)
                if len(BUFFER) > BUFFER_LIMIT:
                    del BUFFER[:len(BUFFER) - BUFFER_LIMIT]
                STATE["last_data"] = time.time()
                COND.notify_all()
        try:
            proc.wait(timeout=5)
        except Exception:  # noqa: BLE001
            proc.kill()
        log("ffmpeg завершился, перезапуск")
        time.sleep(1)


def start_station():
    try:
        sys.path.insert(0, "/data/myweb/cgi-bin")
        import radio
        radio.play_stream("Spotify", STREAM_URL, fmt="MP3", wait=1)
        return True
    except Exception as exc:  # noqa: BLE001
        log("не удалось включить на колонке: %s" % exc)
        return False


def audio_monitor():
    """Первый звук новой сессии — один раз отдаём поток колонке."""
    while True:
        time.sleep(1)
        now = time.time()
        last = STATE["last_data"]
        if now - last < 2:
            if not STATE["station_started"]:
                STATE["station_started"] = now
                if start_station():
                    log("поток отдан колонке")
        elif now - last > 10:
            STATE["station_started"] = 0.0


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/health"):
            body = json.dumps({"ok": True, "spotifyd": bool(PROCS["spotifyd"]),
                               "buffered": len(BUFFER)}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not self.path.startswith("/stream"):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Connection", "close")
        self.end_headers()
        with COND:
            position = len(BUFFER)
        last_write = time.time()
        while True:
            with COND:
                if len(BUFFER) < position:
                    position = 0
                deadline = time.time() + 20
                while len(BUFFER) <= position:
                    left = deadline - time.time()
                    if left <= 0:
                        break
                    COND.wait(min(left, 2))
                if len(BUFFER) <= position:
                    if time.time() - last_write > 20:
                        return
                    continue
                chunk = bytes(BUFFER[position:position + 65536])
                position += len(chunk)
            try:
                self.wfile.write(chunk)
                self.wfile.flush()
                last_write = time.time()
            except Exception:  # noqa: BLE001
                return


def main():
    ensure_files()
    start_spotifyd()
    threading.Thread(target=ffmpeg_loop, daemon=True).start()
    threading.Thread(target=audio_monitor, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log("HTTP-поток на %s" % STREAM_URL)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for proc in PROCS.values():
            if proc is not None:
                try:
                    proc.terminate()
                except Exception:  # noqa: BLE001
                    pass


if __name__ == "__main__":
    main()
