#!/opt/bin/python3
# -*- coding: utf-8 -*-
"""Пресеты раскладки панели (порядок, ширина и высота карточек).

    POST /cgi-bin/layout_presets.py {"action":"list"}
    POST /cgi-bin/layout_presets.py {"action":"save","name":"Дом","mode":"wide",
                                     "layout":{"order":[...],"spans":{...},"rows":{...}}}
    POST /cgi-bin/layout_presets.py {"action":"delete","id":"..."}

Пресеты хранятся на станции, поэтому раскладку можно сохранить на одном
компьютере и применить на другом. Режимы `wide` и `phone` разделены.
"""

from __future__ import annotations

import os
import re
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

STORE = "/data/mypult/layout_presets.json"
DEFAULT_STORE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "default_layout_presets.json")
MAX_PRESETS = 40
NAME_MAX = 40
ID_RE = re.compile(r"^[a-z0-9_-]{1,64}$")
MODES = ("wide", "touch", "phone")
MENU_POSITIONS = ("top", "bottom", "left", "right")


def load_presets():
    data = common.read_json(STORE, None)
    # Свежая установка: подставляем заводской пресет «По умолчанию».
    if not isinstance(data, dict):
        data = common.read_json(DEFAULT_STORE, {"presets": []}) or {}
    presets = data.get("presets") if isinstance(data, dict) else None
    if not isinstance(presets, list):
        return []
    return [item for item in presets if isinstance(item, dict)]


def save_presets(presets):
    common.write_json(STORE, {"presets": presets[:MAX_PRESETS]}, indent=2)


def clean_layout(raw):
    """Только безопасные идентификаторы карточек и размеры в допустимых пределах."""
    layout = {"order": [], "spans": {}, "rows": {}, "menu": "top"}
    if not isinstance(raw, dict):
        return layout
    menu = str(raw.get("menu") or "").strip().lower()
    if menu in MENU_POSITIONS:
        layout["menu"] = menu
    order = raw.get("order")
    if isinstance(order, list):
        for item in order[:200]:
            if isinstance(item, str) and ID_RE.match(item) and item not in layout["order"]:
                layout["order"].append(item)
    for key, low, high in (("spans", 1, 12), ("rows", 1, 20)):
        source = raw.get(key)
        if not isinstance(source, dict):
            continue
        for name, value in list(source.items())[:200]:
            if not isinstance(name, str) or not ID_RE.match(name):
                continue
            try:
                number = int(value)
            except (TypeError, ValueError):
                continue
            if low <= number <= high:
                layout[key][name] = number
    return layout


def clean_mode(value):
    return value if value in MODES else "wide"


def clean_name(value):
    name = str(value or "").strip()
    name = re.sub(r"\s+", " ", name)
    return name[:NAME_MAX]


def main():
    data = common.params()
    action = str(data.get("action") or "list").strip().lower()
    presets = load_presets()

    if action == "save":
        name = clean_name(data.get("name"))
        if not name:
            common.fail(400, "Укажите название пресета")
            return
        mode = clean_mode(data.get("mode"))
        layout = clean_layout(data.get("layout"))
        preset_id = str(data.get("id") or "").strip()
        if not ID_RE.match(preset_id):
            # Одинаковое имя в одном режиме не плодим: сначала спрашиваем
            # подтверждение на клиенте, затем он присылает id и update=1.
            for item in presets:
                if item.get("mode") != mode:
                    continue
                if clean_name(item.get("name")).lower() != name.lower():
                    continue
                if not common.truthy(data.get("update")):
                    common.fail(409, "Пресет с таким именем уже есть")
                    return
                preset_id = str(item.get("id") or "")
                break
        if not ID_RE.match(preset_id):
            preset_id = "layout-" + uuid.uuid4().hex[:10]
        preset = {
            "id": preset_id,
            "name": name,
            "mode": mode,
            "layout": layout,
            "updated": int(time.time()),
        }
        presets = [item for item in presets if item.get("id") != preset_id]
        presets.insert(0, preset)
        # Держим не больше MAX_PRESETS на каждый режим.
        for item_mode in MODES:
            group = [item for item in presets if item.get("mode") == item_mode]
            if len(group) > MAX_PRESETS:
                extra = {item.get("id") for item in group[MAX_PRESETS:]}
                presets = [item for item in presets if item.get("id") not in extra]
        save_presets(presets)
        common.ok(presets=presets, saved=preset)
        return

    if action == "delete":
        preset_id = str(data.get("id") or "").strip()
        if not preset_id:
            common.fail(400, "Не указан пресет")
            return
        presets = [item for item in presets if item.get("id") != preset_id]
        save_presets(presets)
        common.ok(presets=presets)
        return

    common.ok(presets=presets)


if __name__ == "__main__":
    main()
