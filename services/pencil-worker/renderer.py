from __future__ import annotations

import hashlib
import io
import json
import random
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor" / "crayon"))
sys.path.insert(0, str(ROOT / "vendor" / "penwash"))

import crayon_lib as C  # noqa: E402
import penwash_lib as P  # noqa: E402

WIDTH = 880
HEIGHT = 1100
MAX_ELEMENTS = 30
MAX_TEXT = 80

PALETTES = {
    "ink": (68, 52, 46),
    "cream": (246, 235, 211),
    "red": (190, 78, 72),
    "pink": (224, 154, 160),
    "orange": (214, 142, 91),
    "yellow": (232, 199, 104),
    "green": (111, 158, 126),
    "mint": (148, 190, 169),
    "blue": (103, 150, 177),
    "navy": (65, 76, 116),
    "purple": (151, 126, 169),
    "brown": (132, 94, 70),
    "gray": (142, 140, 136),
    "white": (244, 239, 228),
}


def _number(value, name: str, low: float = 0, high: float = 1000) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{name} must be a number")
    value = float(value)
    if value < low or value > high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return value


def _xy(value) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError("each point must be [x, y]")
    return (_number(value[0], "point.x") * WIDTH / 1000, _number(value[1], "point.y") * HEIGHT / 1000)


def _points(element: dict, minimum: int) -> list[tuple[float, float]]:
    raw = element.get("points")
    if not isinstance(raw, list) or not minimum <= len(raw) <= 20:
        raise ValueError(f"points must contain {minimum} to 20 entries")
    return [_xy(point) for point in raw]


def _color(value) -> tuple[int, int, int]:
    if value is None:
        return PALETTES["red"]
    if isinstance(value, str) and value in PALETTES:
        return PALETTES[value]
    if isinstance(value, str) and len(value) == 7 and value.startswith("#"):
        try:
            return tuple(int(value[index:index + 2], 16) for index in (1, 3, 5))
        except ValueError:
            pass
    raise ValueError("color must be a palette name or #RRGGBB")


def _box(element: dict) -> tuple[float, float, float, float]:
    x = _number(element.get("x"), "x") * WIDTH / 1000
    y = _number(element.get("y"), "y") * HEIGHT / 1000
    w = _number(element.get("w"), "w", 5, 1000) * WIDTH / 1000
    h = _number(element.get("h"), "h", 5, 1000) * HEIGHT / 1000
    return x, y, w, h


def _shape_points(kind: str, element: dict) -> list[tuple[float, float]]:
    if kind == "polygon":
        return _points(element, 3)
    x, y, w, h = _box(element)
    if kind == "rect":
        wobble = min(w, h) * 0.035
        return C.quad(x, y, x + w, y + h, wobble=wobble, lean=random.uniform(-0.025, 0.025))
    rough = 0.10 if kind == "ellipse" else 0.18
    return C.blob(x + w / 2, y + h / 2, w / 2, h / 2, k=18, rough=rough)


def _ink_for(color: tuple[int, int, int]) -> tuple[int, int, int]:
    return tuple(max(28, int(channel * 0.54)) for channel in color)


def _render_crayon(elements: list[dict], title: str, note: str) -> Image.Image:
    C.set_size(WIDTH, HEIGHT)
    img = Image.new("RGBA", (WIDTH, HEIGHT), C.PAPER + (255,))
    for element in elements:
        kind = element["kind"]
        color = _color(element.get("color"))
        if kind in {"rect", "ellipse", "blob", "polygon"}:
            points = _shape_points(kind, element)
            mask = C.soft_mask(points, feather=3, grow=2)
            xs, ys = zip(*points)
            area = max(1, (max(xs) - min(xs)) * (max(ys) - min(ys)))
            strokes = max(260, min(3600, int(area / 24)))
            img = C.crayon(img, mask, color, n=strokes, length=(7, 20), dot=(0.9, 1.8), alpha=(135, 225), spread=12)
            img = C.crayon_line(img, points + [points[0]], _ink_for(color), width=(0.8, 1.45), alpha=(125, 210))
        elif kind == "path":
            img = C.crayon_line(img, _points(element, 2), color, width=(1.0, 2.2), alpha=(150, 235), wobble=1.2)
        elif kind == "text":
            text = str(element.get("text") or "").strip()[:MAX_TEXT]
            if not text:
                continue
            x, y = _xy([element.get("x"), element.get("y")])
            size = int(_number(element.get("size", 38), "size", 18, 90))
            img = C.wobbly_text(img, text, (x, y), C.font_cjk(size), color, rot=7, bounce=3, solid_alpha=0.95, density=0.16)
    img = C.paper_grain(img, strength=0.08)
    if title:
        img = C.wobbly_text(img, title[:40], (70, 54), C.font_cjk(48), PALETTES["ink"], rot=5, bounce=3, solid_alpha=0.96, density=0.13)
    if note:
        img = C.wobbly_text(img, note[:60], (70, HEIGHT - 92), C.font_cjk(34), PALETTES["brown"], rot=5, bounce=3, solid_alpha=0.96, density=0.14)
    return img


def _render_penwash(elements: list[dict], title: str, note: str) -> Image.Image:
    P.set_size(WIDTH, HEIGHT)
    img = P.paper(WIDTH, HEIGHT)
    for element in elements:
        kind = element["kind"]
        color = _color(element.get("color"))
        ink = _ink_for(color)
        if kind in {"rect", "ellipse", "blob", "polygon"}:
            points = _shape_points(kind, element)
            img = P.wash(img, points, color, alpha=(70, 118), offset=(4, 3), feather=3, layers=2, edge=0.45, texture=0.48)
            img = P.pen_path(img, points + [points[0]], ink=ink, width=(1.0, 1.8), alpha=(175, 235), wobble=1.1, gaps=0.035, smooth=kind not in {"rect", "polygon"}, overdraw=1, jitter=0.22)
        elif kind == "path":
            img = P.pen_path(img, _points(element, 2), ink=color, width=(1.0, 1.8), alpha=(175, 235), wobble=1.1, gaps=0.04, overdraw=1, jitter=0.24)
        elif kind == "text":
            text = str(element.get("text") or "").strip()[:MAX_TEXT]
            if not text:
                continue
            x, y = _xy([element.get("x"), element.get("y")])
            size = int(_number(element.get("size", 34), "size", 18, 90))
            img = P.pen_text(img, text, (x, y), size=size, ink=color, alpha=210, rot=2)
    if title:
        img = P.pen_text(img, title[:40], (68, 55), size=46, ink=P.INK, alpha=225, rot=2)
    if note:
        img = P.pen_text(img, note[:60], (68, HEIGHT - 82), size=30, ink=P.INK_SOFT, alpha=205, rot=2)
    return img


def render(payload: dict) -> bytes:
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    style = payload.get("style")
    if style not in {"crayon", "penwash"}:
        raise ValueError("style must be crayon or penwash")
    title = str(payload.get("title") or "").strip()[:40]
    note = str(payload.get("note") or "").strip()[:60]
    scene = payload.get("scene")
    if not isinstance(scene, dict):
        raise ValueError("scene must be an object")
    elements = scene.get("elements")
    if not isinstance(elements, list) or not 1 <= len(elements) <= MAX_ELEMENTS:
        raise ValueError(f"scene.elements must contain 1 to {MAX_ELEMENTS} items")
    allowed = {"rect", "ellipse", "blob", "polygon", "path", "text"}
    for element in elements:
        if not isinstance(element, dict) or element.get("kind") not in allowed:
            raise ValueError("unsupported scene element")

    seed = str(payload.get("seed") or json.dumps(scene, ensure_ascii=False, sort_keys=True))
    seed_value = int.from_bytes(hashlib.sha256(seed.encode("utf-8")).digest()[:8], "big")
    random.seed(seed_value)
    try:
        import numpy as np
        np.random.seed(seed_value % (2**32 - 1))
    except Exception:
        pass
    image = _render_crayon(elements, title, note) if style == "crayon" else _render_penwash(elements, title, note)
    output = io.BytesIO()
    image.convert("RGB").save(output, format="PNG", optimize=True)
    return output.getvalue()

