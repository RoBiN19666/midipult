#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Озвучка текста штатным голосом Алисы через локальный IPC (порт 9875).

Адаптация contrib/alice-say.py из Marker284/yandex-station-extended:
там protobuf-кадр уходил по SSH через `socat STDIO TCP:127.0.0.1:9875`,
здесь скрипт живёт на самой колонке и подключается к тому же сокету
напрямую — без SSH, без внешних зависимостей.

Формат кадра:
    remote  = field7 "AliceCapability" + field<rpc> payload
    envelope= field252 remote + field253 210
    socket  = <len uint32 LE> + envelope

Запрос: rpc=8 (TTS), внутри: 1=18 (START_VOCALIZE), 3=1 (events),
13=TVocalizeDirective(text, append=1). Перед запросом отправляется
подписка rpc=20 на события AliceCapability.

CGI:  POST /cgi-bin/speak.py   {"text": "..."}
      GET  /cgi-bin/speak.py?text=...
      GET  /cgi-bin/speak.py?check=1   — только проверить транспорт
"""

from __future__ import annotations

import os
import socket
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

MAX_TEXT = 2000
DEFAULT_WAIT = float(os.environ.get("MYPULT_TTS_TIMEOUT") or 0.8)

# TTS-события в ответах aliced.
TTS_COMPLETED = 1
ON_ALICE_ERROR = 4
TTS_STARTED = 6

UNIX_CANDIDATES = (
    "/var/run/aliced.sock",
    "/run/aliced.sock",
    "/var/run/alice.sock",
    "/tmp/aliced.sock",
    "/var/run/aliced/aliced.sock",
    "/data/quazar/aliced/aliced.sock",
    "/data/quazar/luna/aliced.sock",
    "/data/quazar/luna/data/aliced.sock",
)


# --------------------------------------------------------------------------- #
#  Protobuf-примитивы (ровно те же байты, что в alice-say.py)
# --------------------------------------------------------------------------- #

def varint(value: int) -> bytes:
    output = bytearray()
    while value >= 128:
        output.append((value & 127) | 128)
        value >>= 7
    output.append(value)
    return bytes(output)


def integer(field: int, value: int) -> bytes:
    return varint(field * 8) + varint(value)


def byte_field(field: int, value: bytes) -> bytes:
    return varint(field * 8 + 2) + varint(len(value)) + value


def fields(data: bytes) -> dict:
    """Разобрать маленький protobuf-конверт, отбрасывая битые поля."""
    if not isinstance(data, bytes):
        raise ValueError("Некорректное protobuf-сообщение.")
    offset = 0

    def number() -> int:
        nonlocal offset
        value = 0
        for shift in range(0, 70, 7):
            if offset >= len(data):
                raise ValueError("Неполное protobuf-сообщение.")
            byte = data[offset]
            offset += 1
            if shift == 63 and byte > 1:
                raise ValueError("Некорректное protobuf-число.")
            value |= (byte & 127) << shift
            if byte < 128:
                return value
        raise ValueError("Некорректное protobuf-число.")

    result: dict = {}
    while offset < len(data):
        key = number()
        if key >> 3 == 0:
            raise ValueError("Некорректный номер protobuf-поля.")
        wire = key & 7
        if wire == 0:
            value = number()
        elif wire in (1, 2, 5):
            size = number() if wire == 2 else (8 if wire == 1 else 4)
            if offset + size > len(data):
                raise ValueError("Неполное protobuf-поле.")
            value = data[offset:offset + size] if wire == 2 else None
            offset += size
        else:
            raise ValueError("Неподдерживаемый тип protobuf-поля.")
        result[key >> 3] = value
    return result


def rpc_frame(field: int, payload: bytes) -> bytes:
    remote = byte_field(7, b"AliceCapability") + byte_field(field, payload)
    envelope = byte_field(252, remote) + integer(253, 210)
    return len(envelope).to_bytes(4, "little") + envelope


def vocalize_frame(text: str, append: int = 1) -> bytes:
    directive = byte_field(1, text.encode("utf-8")) + integer(2, append)
    return rpc_frame(8, integer(1, 18) + integer(3, 1) + byte_field(13, directive))


SUBSCRIBE_FRAME = rpc_frame(20, byte_field(1, b"AliceCapability"))


# --------------------------------------------------------------------------- #
#  Поиск IPC-сокета aliced
# --------------------------------------------------------------------------- #

def _sockets_from_proc():
    """Пути unix-сокетов, похожие на aliced, из /proc/net/unix."""
    found = []
    try:
        with open("/proc/net/unix", "r", encoding="utf-8", errors="replace") as fh:
            next(fh, None)
            for line in fh:
                parts = line.split()
                if len(parts) < 8:
                    continue
                path = parts[7]
                if not path.startswith("/"):
                    continue
                low = path.lower()
                if "alice" not in low:
                    continue
                if path not in found:
                    found.append(path)
    except OSError:
        pass
    return found


def connect_ipc():
    """Вернуть (socket, подпись транспорта) или поднять IpcError."""
    errors = []

    host, port = "127.0.0.1", common.IPC_PORT
    try:
        sock = socket.create_connection((host, port), timeout=2.0)
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        return sock, "tcp:%s:%d" % (host, port)
    except OSError as exc:
        errors.append("tcp %d: %s" % (port, exc))

    candidates = list(UNIX_CANDIDATES) + _sockets_from_proc()
    seen = set()
    for path in candidates:
        if path in seen or not os.path.exists(path):
            continue
        seen.add(path)
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(2.0)
            sock.connect(path)
            return sock, "unix:%s" % path
        except OSError as exc:
            errors.append("unix %s: %s" % (path, exc))

    raise IpcError(errors)


class IpcError(RuntimeError):
    def __init__(self, errors):
        super().__init__("IPC aliced недоступен")
        self.errors = errors


# --------------------------------------------------------------------------- #
#  Обмен кадрами
# --------------------------------------------------------------------------- #

def recv_exact(sock: socket.socket, size: int) -> bytes:
    buffer = bytearray()
    while len(buffer) < size:
        chunk = sock.recv(size - len(buffer))
        if not chunk:
            raise ConnectionError("соединение закрыто другой стороной")
        buffer.extend(chunk)
    return bytes(buffer)


def drain_events(sock: socket.socket, deadline: float):
    """Читать ответы aliced до TTS_STARTED / TTS_COMPLETED / дедлайна."""
    started = False
    completed = False
    alice_error = None

    while time.monotonic() < deadline:
        remaining = max(0.05, deadline - time.monotonic())
        sock.settimeout(remaining)
        try:
            size = int.from_bytes(recv_exact(sock, 4), "little")
        except socket.timeout:
            break
        except ConnectionError:
            break
        if not 0 < size <= 512 * 1024:
            raise ValueError("Некорректный размер ответа колонки.")

        envelope = fields(recv_exact(sock, size))
        # 253=210 — наши запросы, 253=3 — события, которые присылает aliced.
        if envelope.get(253) != 3:
            continue
        remote = fields(envelope.get(252, b"") or b"")
        if 18 not in remote:
            continue
        event = fields(remote[18]).get(1)
        if event == TTS_STARTED:
            # Отвечаем CGI сразу, не дожидаясь конца фразы: интерфейс
            # не должен висеть всё время озвучки.
            started = True
            break
        elif event == TTS_COMPLETED:
            started = True
            completed = True
            break
        elif event == ON_ALICE_ERROR:
            alice_error = "штатный речевой сервис сообщил об ошибке"
            break

    return started, completed, alice_error


def speak(text: str, wait: float, append: int = 1):
    sock, transport = connect_ipc()
    try:
        sock.sendall(SUBSCRIBE_FRAME + vocalize_frame(text, append))
        started, completed, alice_error = drain_events(sock, time.monotonic() + wait)
    finally:
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            sock.close()
        except OSError:
            pass
    return {
        "transport": transport,
        "started": started,
        "completed": completed,
        "alice_error": alice_error,
    }


def check_transport():
    try:
        sock, transport = connect_ipc()
    except IpcError as exc:
        return 502, {
            "ok": False,
            "error": "IPC aliced недоступен",
            "detail": exc.errors,
            "hint": (
                "На колонке должен слушать порт %d. Проверьте: "
                "socat TCP-LISTEN:%d,fork,reuseaddr UNIX-CONNECT:<сокет aliced>"
                % (common.IPC_PORT, common.IPC_PORT)
            ),
        }
    try:
        sock.close()
    except OSError:
        pass
    return 200, {"ok": True, "transport": transport}


# --------------------------------------------------------------------------- #
#  Точка входа
# --------------------------------------------------------------------------- #

def main():
    data = common.params()
    text = (data.get("text") or "").strip()

    if common.truthy(data.get("check")):
        status, payload = check_transport()
        common.respond(status, payload)
        return

    if not text:
        common.fail(400, "Пустой текст", hint="Передайте {\"text\": \"фраза\"}")
        return
    if len(text) > MAX_TEXT:
        common.fail(413, "Текст длиннее %d символов" % MAX_TEXT)
        return

    # Событие TTS_STARTED от maind не приходит, поэтому не ждём его:
    # кадр отправлен — считаем, что озвучка пошла, и сразу отвечаем.
    try:
        wait = float(data.get("wait")) if data.get("wait") is not None else DEFAULT_WAIT
    except (TypeError, ValueError):
        wait = DEFAULT_WAIT
    wait = max(0.0, min(wait, 30.0))

    append = 1
    if data.get("append") is not None and not common.truthy(data.get("append")):
        append = 0

    started_at = time.monotonic()
    try:
        result = speak(text, wait, append)
    except IpcError as exc:
        common.fail(
            502,
            "IPC aliced недоступен",
            detail=exc.errors,
            hint=(
                "Порт %d закрыт и unix-сокет aliced не найден. "
                "Проверьте: netstat -ltn | grep %d, затем при необходимости "
                "socat TCP-LISTEN:%d,fork,reuseaddr UNIX-CONNECT:<сокет>"
                % (common.IPC_PORT, common.IPC_PORT, common.IPC_PORT)
            ),
        )
        return
    except ValueError as exc:
        common.fail(502, "Ошибка протокола: %s" % exc)
        return
    except (OSError, ConnectionError) as exc:
        common.fail(502, "Соединение с aliced прервалось: %s" % exc)
        return

    elapsed = int((time.monotonic() - started_at) * 1000)

    if result["alice_error"]:
        common.fail(502, "Алиса не смогла озвучить текст", detail=result)
        return

    common.ok(
        text=text,
        chars=len(text),
        transport=result["transport"],
        started=result["started"],
        completed=result["completed"],
        timed_out=not result["started"],
        elapsed_ms=elapsed,
        note=None if result["started"] else "Кадр отправлен, но TTS_STARTED не пришёл за %.1f с" % wait,
    )


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
    except Exception as exc:  # последний предохранитель: CGI всегда отдаёт JSON
        try:
            common.fail(500, "Внутренняя ошибка speak.py: %s" % exc)
        except Exception:
            pass
