#!/usr/bin/env python3
"""等比裁高 + LANCZOS 缩放，把 AI 生成的竖版背景处理到目标规格。

用法:
    python3 tools/process-bg.py INPUT OUTPUT W H [--anchor top|center|bottom] [--quality 92]

设计约束（见 ART-STYLE.md / 项目记忆）:
  - 绝不横向拉伸：先按目标宽高比裁切，再 LANCZOS 缩放。
  - 默认 anchor=top（保留顶部天空，从底部裁切）——底部通常是暗底渐隐区，
    且 AI 工具的水印固定在右下角，裁底可一并去除。
  - JPG 用 quality 参数，PNG 无损。
仅依赖 Pillow。
"""
import argparse
from PIL import Image


def process(src, dst, target_w, target_h, anchor="top", quality=92):
    im = Image.open(src).convert("RGB")
    sw, sh = im.size
    target_ratio = target_w / target_h
    src_ratio = sw / sh

    if src_ratio > target_ratio:
        # 源图偏宽 -> 裁左右
        new_w = int(round(sh * target_ratio))
        overflow = sw - new_w
        if anchor == "left":
            left = 0
        elif anchor == "right":
            left = overflow
        else:  # center
            left = overflow // 2
        box = (left, 0, left + new_w, sh)
    else:
        # 源图偏高/相等 -> 裁上下（默认保顶裁底，去水印）
        new_h = int(round(sw / target_ratio))
        overflow = sh - new_h
        if anchor == "top":
            top = 0
        elif anchor == "bottom":
            top = overflow
        else:  # center
            top = overflow // 2
        box = (0, top, sw, top + new_h)

    im = im.crop(box).resize((target_w, target_h), Image.LANCZOS)
    if dst.lower().endswith(".jpg") or dst.lower().endswith(".jpeg"):
        im.save(dst, "JPEG", quality=quality, subsampling=0)
    else:
        im.save(dst, "PNG")
    print(f"{src} -> {dst}: crop{box} resize ({target_w},{target_h})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("w", type=int)
    ap.add_argument("h", type=int)
    ap.add_argument("--anchor", default="top", choices=["top", "center", "bottom", "left", "right"])
    ap.add_argument("--quality", type=int, default=92)
    a = ap.parse_args()
    process(a.src, a.dst, a.w, a.h, a.anchor, a.quality)
