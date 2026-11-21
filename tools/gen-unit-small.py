#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 UN-01 大立绘批量裁切 UN-02 局内小图标（96×96，零出图成本）。

方案 D：以 alpha 主体包围盒的垂直中心对齐 174×174 裁切窗口，
避免方案 C（固定顶部裁切）切掉脚部；横向保持原图全宽。
裁后 LANCZOS 缩放至 96×96，保留 RGBA 透明通道。

用法：python3 tools/gen-unit-small.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'units'
W = H = 96
CROP = 174          # 原图宽；裁切窗口边长
FULL_H = 216        # 原图高
ALPHA_GATE = 40     # 主体判定阈值


def crop_small(src: Image.Image) -> Image.Image:
    """主体垂直居中裁切 → 96×96 RGBA。"""
    bbox = src.getchannel('A').point(lambda v: 255 if v > ALPHA_GATE else 0).getbbox()
    if not bbox:
        raise ValueError('空白立绘：alpha 通道无主体')
    cy = (bbox[1] + bbox[3]) / 2
    # 216 高画布里 174 窗口最多下移 42px；按主体中心夹紧到 [0, 42]
    top = max(0, min(FULL_H - CROP, int(round(cy - CROP / 2))))
    crop = src.crop((0, top, CROP, top + CROP))
    return crop.resize((W, H), Image.LANCZOS)


def main():
    ok = 0
    for i in range(1, 41):
        src_path = SRC / f'unit_{i:02d}.png'
        dst_path = SRC / f'unit_small_{i:02d}.png'
        src = Image.open(src_path).convert('RGBA')
        if src.size != (CROP, FULL_H):
            raise ValueError(f'{src_path.name} 尺寸异常：{src.size}，预期 ({CROP},{FULL_H})')
        out = crop_small(src)
        out.save(dst_path, 'PNG', optimize=True)
        ok += 1
    print(f'已生成 {ok} 张 {W}×{H} 小图 → assets/units/unit_small_01~40.png')


if __name__ == '__main__':
    main()
