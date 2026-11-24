#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Волна из панели: кнопки сервисов и транспорт очереди musicd."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
import musicd_client  # noqa: E402


def main():
    common.require_auth()
    data = common.params()
    action = str(data.get("action") or "status").strip().lower()
    try:
        if action == "status":
            common.ok(**musicd_client.status())
            return
        if action == "start":
            service = str(data.get("service") or "").strip().lower()
            if service not in ("zvuk", "youtube", "soundcloud"):
                common.fail(400, "Неизвестный сервис")
                return
            payload = {
                "service": service,
                "mode": "seed" if str(data.get("mode") or "") == "seed" else "wave",
                "mood": str(data.get("mood") or "").strip().lower(),
                "query": str(data.get("query") or "").strip()[:160],
            }
            track = data.get("track")
            if isinstance(track, dict):
                payload["track"] = track
            result = musicd_client.call("start", payload, timeout=120)
        elif action in ("stop", "pause", "resume", "next", "prev"):
            result = musicd_client.call(action, {}, timeout=120)
        else:
            common.fail(400, "Неизвестное действие")
            return
    except Exception as exc:  # noqa: BLE001
        common.fail(500, "Волна: %s" % exc)
        return
    if result.get("error"):
        common.fail(400, result["error"])
        return
    common.ok(**result)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
