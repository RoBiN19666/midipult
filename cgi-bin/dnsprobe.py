#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Быстрая проверка локального DNS-резолвера.

    /opt/bin/python3 dnsprobe.py           # код 0, если 127.0.0.1:53 отвечает
    /opt/bin/python3 dnsprobe.py --json    # {"ok": true, ...}

Нужен, чтобы `S99mypult` и `install.sh` проверяли реальный ответ, а не только
факт «кто-то слушает :53»: unbound может занимать порт и не отвечать.
"""

from __future__ import annotations

import json
import os
import socket
import struct
import sys


def build_query(name="ya.ru", query_id=None):
    query_id = query_id if query_id is not None else int.from_bytes(os.urandom(2), "big")
    header = struct.pack("!HHHHHH", query_id, 0x0100, 1, 0, 0, 0)
    qname = b"".join(bytes([len(part)]) + part.encode("ascii")
                     for part in name.split(".")) + b"\x00"
    return header + qname + struct.pack("!HH", 1, 1)


def probe(timeout=2.0, server="127.0.0.1", name="ya.ru"):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.settimeout(timeout)
        sock.sendto(build_query(name), (server, 53))
        data, _ = sock.recvfrom(512)
        return len(data) > 12
    except OSError:
        return False
    finally:
        sock.close()


def main():
    ok = probe()
    if "--json" in sys.argv:
        print(json.dumps({"ok": ok, "server": "127.0.0.1", "name": "ya.ru"}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
