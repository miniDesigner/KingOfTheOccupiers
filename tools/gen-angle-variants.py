"""Rebuild precise 45/60 degree views from the ORIGINAL OLD brick.

Source of truth: assets/tiles/hex_bright.png (transparent, 312px) and
OLD-refined2-dark.png (936px). The AI redraw was abandoned: its side
wall tapered too sharply and bevel textures smeared when re-projected.

The original brick carries a baked warm-grey contour stroke (b-r ~ -5)
and a soft ground shadow. Both are removed so the re-projected brick is
clean at every angle. The stone body itself is blue-grey (b-r ~ +26).

Geometry measured from OLD-refined2-dark.png:
  top face  y 68..552   width 726  height 484  (= 35deg)
  side wall y 552..760  height 208
  physical side height = 208 / cos(35deg) = 254

For target angle t:
  face height = 726 * sin(t) / 0.866
  side height = 254 * cos(t)
"""
import math
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / ".workbuddy" / "art-staging" / "board-art"
SRC_DARK = BASE / "OLD-refined2-dark.png"
SRC_CLEAN = ROOT / "assets" / "tiles" / "hex_bright.png"

DARK = dict(x0=96, x1=830, ty0=68, ty1=552, sy0=552, sy1=760, bg=(20, 30, 45))
CLEAN = dict(x0=32, x1=280, ty0=23, ty1=184, sy0=184, sy1=250, bg=None)

FACE_W = 726
PHYS_SIDE_H = 254
CANVAS = 1024
TOP_Y = 70


def clean_segment(img):
    """Keep only the blue-grey stone body; drop warm contour stroke,
    baked ground shadow (semi-transparent) and near-black halo pixels.
    Stone body: alpha 255, blue (b-r >= +12), brightness >= ~55.
    """
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            c = px[x, y]
            r, g, b = c[:3]
            a = c[3] if len(c) == 4 else 255
            lum = (r + g + b) / 3
            is_stone = a >= 250 and b - r >= 12 and lum >= 52
            if not is_stone:
                px[x, y] = (0, 0, 0, 0)
    return img


def build(deg, src, win, out_name, canvas_size, face_w, phys_side_h, top_y, bg):
    im = Image.open(src).convert("RGBA")
    face_h = round(face_w * math.sin(math.radians(deg)) / 0.866)
    side_h = round(phys_side_h * math.cos(math.radians(deg)))
    x0, x1 = win["x0"], win["x1"]

    top = im.crop((x0, win["ty0"], x1, win["ty1"]))
    side = im.crop((x0, win["sy0"], x1, win["sy1"]))
    # top face carries no baked shadow; keep it fully intact.
    top = top.resize((face_w, face_h), Image.LANCZOS)
    side = clean_segment(side).resize((face_w, side_h), Image.LANCZOS)

    if bg is None:
        canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    else:
        canvas = Image.new("RGBA", (canvas_size, canvas_size), (*bg, 255))
    left = (canvas_size - face_w) // 2
    canvas.alpha_composite(top, (left, top_y))
    canvas.alpha_composite(side, (left, top_y + face_h))

    out = BASE / out_name
    (canvas if bg is None else canvas.convert("RGB")).save(out)
    print(f"{deg}deg -> {out.name}  face {face_w}x{face_h}  side {side_h}")


if __name__ == "__main__":
    for deg in (45, 60):
        build(deg, SRC_DARK, DARK,
              f"OLD-angle{deg}-dark.png", CANVAS, FACE_W, PHYS_SIDE_H, TOP_Y, DARK["bg"])
        build(deg, SRC_CLEAN, CLEAN,
              f"OLD-angle{deg}-transparent.png", 312, 242, 254 / 3, 8, None)
