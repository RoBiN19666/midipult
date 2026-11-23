#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собирает index.html из src/panel/.

Разметка — src/panel/index.html, стили — src/panel/css/*.css по порядку имён,
логика — src/panel/js/*.js по порядку имён. Панель отдаётся одним файлом,
поэтому index.html — собранный артефакт.

    python3 deploy/build_panel.py          — пересобрать index.html
    python3 deploy/build_panel.py --check  — проверить, что index.html не разошёлся
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PANEL = ROOT / "src" / "panel"
TEMPLATE = PANEL / "index.html"
CSS_DIR = PANEL / "css"
JS_DIR = PANEL / "js"
OUT = ROOT / "index.html"

CSS_MARK = "<!-- @panel-css -->"
JS_MARK = "<!-- @panel-js -->"


def _join(folder: Path, suffix: str) -> str:
    parts = []
    for path in sorted(folder.glob("*.%s" % suffix)):
        parts.append(path.read_text(encoding="utf-8"))
    return "".join(parts)


def build() -> str:
    template = TEMPLATE.read_text(encoding="utf-8")
    text = template.replace(CSS_MARK, _join(CSS_DIR, "css"))
    return text.replace(JS_MARK, _join(JS_DIR, "js"))


def main(argv) -> int:
    text = build()
    if "--check" in argv:
        current = OUT.read_text(encoding="utf-8")
        if current != text:
            print("index.html расходится со сборкой: запустите deploy/build_panel.py")
            return 1
        print("index.html совпадает со сборкой")
        return 0
    OUT.write_text(text, encoding="utf-8", newline="")
    print("index.html собран: %d символов" % len(text))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
