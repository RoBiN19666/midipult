#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Часовой пояс панели.

    GET  /cgi-bin/timezone.py          — текущая зона и список зон
    POST /cgi-bin/timezone.py {"zone":"Asia/Yekaterinburg"}
    POST /cgi-bin/timezone.py {"zone":"station"}  — как на станции

Меняется только /data/mypult/timezone; системные часы станции не трогаем.
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

SKIP_DIRS = {"posix", "right", "SystemV", "leapseconds", "posixrules"}


def zones():
    root = common.ZONEINFO_ROOT
    result = []
    for base, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in files:
            if name in ("zone.tab", "zone1970.tab", "iso3166.tab", "leapseconds"):
                continue
            path = os.path.join(base, name)
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            if common.timezone_path(rel):
                result.append(rel)
            if len(result) >= 900:
                return sorted(result)
    return sorted(result)


def main():
    data = common.params()
    if data.get("zone") is not None:
        try:
            zone = common.set_timezone(data.get("zone"))
        except (OSError, ValueError) as exc:
            common.fail(400, "Не удалось сохранить зону: %s" % exc)
        now = common.now_local()
        offset = now.utcoffset()
        common.ok(zone=zone or "station", restart_required=True,
                  offset=int(offset.total_seconds() // 60) if offset is not None else None)
        return

    current = common.configured_timezone() or "station"
    now = common.now_local()
    offset = now.utcoffset()
    common.ok(
        zone=current,
        zones=zones(),
        system=os.environ.get("TZ") or time.tzname[0] or "system",
        offset=int(offset.total_seconds() // 60) if offset is not None else None,
        restart_required=False,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        common.fail(500, "Внутренняя ошибка timezone.py: %s" % exc)
