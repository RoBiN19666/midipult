#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Приёмник tap-а микрофона и локальный API на 127.0.0.1:8058.

Зачем отдельный процесс: unixgram-сокет и кольцевой буфер нельзя держать в
CGI (он живёт один запрос). Схема та же, что у state_daemon.py:

    maind (LD_PRELOAD vqe_tap.so)
        │  unixgram /tmp/mypult/mic.sock, кадры по 10–100 мс
        ▼
    micd.py ── кольцевой буфер 12 с на канал, уровень, WAV по запросу
        │  HTTP 127.0.0.1:8058
        ▼
    cgi-bin/mic.py (PIN + same-origin) ── панель

Данные не покидают колонку: ни файлов в интернет, ни телеметрии.
"""

from __future__ import annotations

import array
import hmac
import json
import os
import socket
import struct
import sys
import threading
import time
import urllib.parse
import wave
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, "/data/myweb/cgi-bin")
import common  # noqa: E402

PORT = int(os.environ.get("MYPULT_MIC_PORT") or "8058")
SOCK_PATH = os.environ.get("MYPULT_MIC_SOCKET") or "/tmp/mypult/mic.sock"
CONFIG_PATH = "/data/mypult/mic.json"
RECORD_DIR = "/data/mypult/micrec"
RING_SECONDS = 12.0
LEVEL_WINDOW = 60          # 60 × 100 мс = 6 с истории уровня
MAX_BACKLOG = 240          # кадров в очереди на разбор
SAMPLE_RATE = 16000

LOCK = threading.RLock()   # snapshot() вызывается из status_payload() под тем же локом
CHANNELS = {}              # (kind, index) -> Channel
CONFIG = {"channel": "", "gain": 1.0, "enabled": True}
DROPPED = 0
LAST_FRAME_TS = 0.0


class Channel:
    """Кольцевой буфер одного канала VQE."""

    def __init__(self, kind: int, index: int):
        self.kind = kind
        self.index = index
        self.samples = deque()      # (ts, array('h'))
        self.total = 0              # сколько сэмплов лежит в буфере
        self.levels = deque(maxlen=LEVEL_WINDOW)
        self.frames = 0
        self.first_ts = time.time()
        self.last_ts = 0.0
        self.peak = 0
        self.rms = 0.0
        self.clipped = 0
        self.rate_hint = 0.0

    def push(self, pcm: array.array, now: float) -> None:
        self.samples.append((now, pcm))
        self.total += len(pcm)
        limit = int(RING_SECONDS * SAMPLE_RATE)
        while self.total > limit and self.samples:
            _, old = self.samples[0]
            self.total -= len(old)
            self.samples.popleft()

        peak = 0
        acc = 0
        clipped = 0
        for value in pcm:
            if value < 0:
                value = -value
            if value > peak:
                peak = value
            acc += value * value
            if value >= 32000:
                clipped += 1
        count = len(pcm) or 1
        self.peak = peak
        self.rms = (acc / count) ** 0.5 / 32768.0
        self.clipped += clipped
        self.frames += 1
        if not self.last_ts:
            self.rate_hint = count / 0.01 if count else 0.0
        self.last_ts = now
        self.levels.append({
            "t": round(now, 2),
            "rms": round(self.rms, 4),
            "peak": round(peak / 32768.0, 4),
        })

    def tail(self, seconds: float) -> bytes:
        need = int(seconds * SAMPLE_RATE)
        chunks = []
        for _, pcm in reversed(self.samples):
            chunks.append(pcm)
            need -= len(pcm)
            if need <= 0:
                break
        data = b"".join(bytes(item.tobytes()) for item in reversed(chunks))
        max_bytes = int(seconds * SAMPLE_RATE) * 2
        return data[-max_bytes:]

    def snapshot(self) -> dict:
        with LOCK:
            fresh = (time.time() - self.last_ts) < 2.0 if self.last_ts else False
            return {
                "kind": self.kind,
                "index": self.index,
                "frames": self.frames,
                "alive": fresh,
                "rms": round(self.rms, 4),
                "peak": round(self.peak / 32768.0, 4),
                "clipped": self.clipped,
                "seconds": round(self.total / SAMPLE_RATE, 2),
                "levels": list(self.levels),
            }


def load_config() -> None:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return
    if isinstance(data, dict):
        CONFIG["channel"] = str(data.get("channel") or "")
        try:
            CONFIG["gain"] = max(0.05, min(20.0, float(data.get("gain") or 1.0)))
        except (TypeError, ValueError):
            CONFIG["gain"] = 1.0
        CONFIG["enabled"] = bool(data.get("enabled", True))


def save_config() -> None:
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(CONFIG, fh, ensure_ascii=False)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, CONFIG_PATH)


def channel_from_config() -> tuple[int, int] | None:
    raw = str(CONFIG.get("channel") or "").strip()
    if not raw:
        return None
    kind, _, index = raw.partition(":")
    try:
        return int(kind), int(index)
    except ValueError:
        return None


def parse_packet(data: bytes) -> tuple[int, int, array.array] | None:
    """4 байта заголовка (kind, index, frames LE) + s16le."""
    if len(data) < 5:
        return None
    kind, index, frames = struct.unpack("<BBH", data[:4])
    body = data[4:]
    if frames == 0 or len(body) < frames * 2:
        return None
    if len(body) != frames * 2:
        body = body[: frames * 2]
    pcm = array.array("h")
    pcm.frombytes(body)
    if sys.byteorder != "little":  # pragma: no cover - ARM little-endian
        pcm.byteswap()
    return kind, index, pcm


def receiver() -> None:
    global DROPPED, LAST_FRAME_TS
    while True:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)
        try:
            os.makedirs(os.path.dirname(SOCK_PATH), exist_ok=True)
            try:
                os.unlink(SOCK_PATH)
            except FileNotFoundError:
                pass
            sock.bind(SOCK_PATH)
            os.chmod(SOCK_PATH, 0o600)
        except OSError as exc:
            common.log("micd", "сокет не открылся: %s" % exc)
            time.sleep(5)
            continue

        common.log("micd", "слушаю %s" % SOCK_PATH)
        while True:
            try:
                data, _ = sock.recvfrom(65535)
            except OSError:
                common.log("micd", "сокет потерян, переоткрываю")
                break
            parsed = parse_packet(data)
            if parsed is None:
                DROPPED += 1
                continue
            kind, index, pcm = parsed
            now = time.time()
            LAST_FRAME_TS = now
            with LOCK:
                channel = CHANNELS.get((kind, index))
                if channel is None:
                    channel = Channel(kind, index)
                    CHANNELS[(kind, index)] = channel
                channel.push(pcm, now)
        try:
            sock.close()
        except OSError:
            pass
        time.sleep(1)


def chosen() -> Channel | None:
    wanted = channel_from_config()
    with LOCK:
        if wanted and wanted in CHANNELS:
            return CHANNELS[wanted]
        if not wanted:
            alive = [c for c in CHANNELS.values() if c.last_ts and time.time() - c.last_ts < 2.0]
            if alive:
                return max(alive, key=lambda c: c.frames)
        return None


def status_payload() -> dict:
    with LOCK:
        channels = [c.snapshot() for c in CHANNELS.values()]
    sel = chosen()
    seen = []
    try:
        with open(SOCK_PATH + ".seen", "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("channel "):
                    seen.append(line.split()[1:])
                elif line.startswith("drop "):
                    seen.append(line.split())
    except OSError:
        pass
    mounted = os.path.exists("/data/mypult/mictap/active")
    return {
        "ok": True,
        "listening": bool(LAST_FRAME_TS and time.time() - LAST_FRAME_TS < 3.0),
        "socket": SOCK_PATH,
        "mounted": mounted,
        "dropped": DROPPED,
        "config": dict(CONFIG),
        "selected": "%d:%d" % (sel.kind, sel.index) if sel else "",
        "channels": channels,
        "seen": seen,
        "record_dir": RECORD_DIR,
    }


def record(seconds: float, channel_key: str = "") -> str:
    seconds = max(1.0, min(30.0, float(seconds)))
    target = None
    if channel_key:
        kind, _, index = channel_key.partition(":")
        try:
            target = CHANNELS.get((int(kind), int(index)))
        except ValueError:
            target = None
    target = target or chosen()
    if target is None:
        raise RuntimeError("нет ни одного канала: tap не подключён")
    data = target.tail(seconds)
    if not data:
        raise RuntimeError("буфер пуст")
    os.makedirs(RECORD_DIR, exist_ok=True)
    name = "mic-%s-%03d.wav" % (time.strftime("%Y%m%d-%H%M%S"), int(time.time() * 1000) % 1000)
    path = os.path.join(RECORD_DIR, name)
    with wave.open(path, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(data)
    os.chmod(path, 0o600)
    prune(keep=8)
    return path


def prune(keep: int = 8) -> None:
    try:
        items = sorted(
            (os.path.join(RECORD_DIR, name) for name in os.listdir(RECORD_DIR)),
            key=os.path.getmtime,
        )
    except OSError:
        return
    for path in items[:-keep]:
        try:
            os.remove(path)
        except OSError:
            pass


def cookie_ok(headers) -> bool:
    config = common.auth_config()
    if config.get("broken"):
        return False
    if not config.get("enabled"):
        return True
    token = str(config.get("token") or "")
    if not token:
        return False
    for part in (headers.get("Cookie") or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == "mypult_token" and hmac.compare_digest(value.strip(), token):
            return True
    return False


def same_origin_ok(headers) -> bool:
    origin = (headers.get("Origin") or headers.get("Referer") or "").strip()
    if origin:
        try:
            parsed = urllib.parse.urlsplit(origin)
        except ValueError:
            return False
        host = (headers.get("Host") or "").strip().lower()
        return bool(host) and parsed.netloc.lower() == host
    return headers.get("X-Requested-With") == "MidiPult"


class Handler(BaseHTTPRequestHandler):
    server_version = "mypult-mic/1.0"

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _wav(self, path: str) -> None:
        if not os.path.isfile(path):
            self.send_error(404)
            return
        try:
            with open(path, "rb") as fh:
                body = fh.read()
        except OSError:
            self.send_error(500)
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Disposition", 'attachment; filename="%s"' % os.path.basename(path))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _allowed(self) -> bool:
        # Loopback (сам пульт, CGI, curl на колонке) — доверенный, как в common.py.
        if self.client_address and self.client_address[0] in ("127.0.0.1", "::1"):
            return True
        return cookie_ok(self.headers)

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/status", "/status/"):
            if not self._allowed():
                self._json(401, {"ok": False, "error": "Нужен PIN", "auth": True})
                return
            self._json(200, status_payload())
            return
        if parsed.path in ("/wav", "/wav/"):
            if not self._allowed():
                self._json(401, {"ok": False, "error": "Нужен PIN", "auth": True})
                return
            name = os.path.basename(urllib.parse.parse_qs(parsed.query).get("name", [""])[0])
            if not name:
                self._json(400, {"ok": False, "error": "name"})
                return
            self._wav(os.path.join(RECORD_DIR, name))
            return
        self.send_error(404)

    def do_POST(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in ("/record", "/record/", "/config", "/config/"):
            self.send_error(404)
            return
        if not self._allowed():
            self._json(401, {"ok": False, "error": "Нужен PIN", "auth": True})
            return
        if not same_origin_ok(self.headers):
            self._json(403, {"ok": False, "error": "Запрос с другого сайта запрещён"})
            return
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 8192)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw or b"{}")
        except ValueError:
            self._json(400, {"ok": False, "error": "bad json"})
            return

        if parsed.path.startswith("/config"):
            if "channel" in data:
                value = str(data.get("channel") or "").strip()
                if value:
                    kind, _, index = value.partition(":")
                    try:
                        int(kind), int(index)
                    except ValueError:
                        self._json(400, {"ok": False, "error": "channel должен быть kind:index"})
                        return
                CONFIG["channel"] = value
            if "gain" in data:
                try:
                    CONFIG["gain"] = max(0.05, min(20.0, float(data.get("gain"))))
                except (TypeError, ValueError):
                    pass
            save_config()
            self._json(200, {"ok": True, "config": dict(CONFIG)})
            return

        try:
            path = record(float(data.get("seconds") or 5), str(data.get("channel") or ""))
        except Exception as exc:  # noqa: BLE001
            self._json(400, {"ok": False, "error": str(exc)[:200]})
            return
        self._json(200, {"ok": True, "file": os.path.basename(path), "path": path})

    def log_message(self, *args):  # noqa: D401
        return


def main() -> None:
    load_config()
    threading.Thread(target=receiver, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    common.log("micd", "API на 127.0.0.1:%d" % PORT)
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
