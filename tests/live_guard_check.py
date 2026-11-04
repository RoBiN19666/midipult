#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Опциональные live-проверки защиты панели (без установки/изменения).

    MYPULT_URL=http://192.168.31.220:8055 python3 tests/live_guard_check.py

Проверяет только чтение/заведомо безопасные запросы: /luna 404, PIN-гейт,
CSP/XFO и отсутствие дублей заголовков, luna.py без cookie, 405 на GET logout.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

URL = (os.environ.get("MYPULT_URL") or "").rstrip("/")
FAILED = []
TOTAL = [0]


def check(name, ok, detail=""):
    TOTAL[0] += 1
    print("[%s] %s%s" % ("PASS" if ok else "FAIL", name,
                        (" — " + str(detail)) if detail and not ok else ""))
    if not ok:
        FAILED.append(name)


def get(path):
    req = urllib.request.Request(URL + path, method="GET",
                                 headers={"User-Agent": "mypult-live-check"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status, resp.headers, resp.read(262144)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read(262144)


def main():
    if not URL:
        print("MYPULT_URL не задан — live-проверки пропущены")
        return 0
    status, _, _ = get("/index.html")
    check("index.html напрямую запрещён", status == 403, status)

    status, headers, _ = get("/")
    check("главная/логин отвечает", status == 200, status)
    csp = headers.get_all("Content-Security-Policy") or []
    xfo = headers.get_all("X-Frame-Options") or []
    check("CSP ровно один", len(csp) == 1, csp)
    check("CSP содержит frame-ancestors", bool(csp and "frame-ancestors" in csp[0]), csp)
    check("X-Frame-Options ровно один", len(xfo) == 1, xfo)

    status, _, _ = get("/luna/api/clock")
    check("/luna/ больше не проксируется", status == 404, status)

    status, _, body = get("/cgi-bin/auth.py?status=1")
    enabled = False
    try:
        enabled = bool(json.loads(body.decode("utf-8", "replace")).get("enabled"))
    except ValueError:
        pass
    if enabled:
        status, _, _ = get("/cgi-bin/luna.py?path=%2Fapi%2Fsensors")
        check("luna.py без cookie — 401", status == 401, status)
    else:
        print("[SKIP] PIN выключен — 401 для luna.py не проверяется")

    status, _, _ = get("/cgi-bin/auth.py?logout=1")
    check("GET logout запрещён (405)", status == 405, status)

    print("\n%d проверок, %d провалов" % (TOTAL[0], len(FAILED)))
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
