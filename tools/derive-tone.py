#!/usr/bin/env python3
"""从 battle_bg 锚点派生 5 套地图色调叠层（bg/battle_tone_* + tiles/territory_tone_*）。

这些叠层在 RenderSystem._drawArtLayer 里以 alpha 0.10 / 0.08 极弱叠加，
作用是给不同棋盘布局一点色调/地貌差异，不是独立画面。
因此从同一锚点做色相偏移 + 明度重映射即可，天然同构图、零额度、无水印。

用法:
    python3 tools/derive-tone.py BATTLE_BG OUTDIR

仅依赖 Pillow。输出 10 张 1500x2115 PNG，命名与占位一致。
"""
import os
import sys
from PIL import Image, ImageEnhance

# 每套: (bg 色调乘子 RGB, bg 对比度, tiles 色调乘子 RGB, tiles 对比度)
# 色调乘子对暗蓝底做通道增益，制造冷暖/地貌倾向；保持整体暗调。
TONES = {
    "plains":       ((0.92, 1.10, 0.86), 1.00, (0.90, 1.12, 0.84), 1.00),  # 开阔草地：偏绿
    "twin_canyon":  ((1.10, 0.96, 0.86), 1.04, (1.12, 0.94, 0.84), 1.04),  # 双峡谷：偏暖赭
    "tri_lanes":    ((0.88, 1.00, 1.10), 1.02, (0.86, 1.00, 1.12), 1.02),  # 三山脊：偏冷青
    "river_ford":   ((0.86, 1.02, 1.14), 1.00, (0.84, 1.04, 1.16), 1.00),  # 河滩：偏水蓝
    "citadel":      ((1.02, 0.92, 1.10), 1.06, (1.04, 0.90, 1.12), 1.06),  # 城堡：偏紫
}


def tint(im, mul, contrast):
    r, g, b = im.split()
    r = r.point(lambda v, m=mul[0]: min(255, int(v * m)))
    g = g.point(lambda v, m=mul[1]: min(255, int(v * m)))
    b = b.point(lambda v, m=mul[2]: min(255, int(v * m)))
    out = Image.merge("RGB", (r, g, b))
    if contrast != 1.0:
        out = ImageEnhance.Contrast(out).enhance(contrast)
    return out


def main(src, outdir):
    base = Image.open(src).convert("RGB")
    for name, (bg_mul, bg_c, tile_mul, tile_c) in TONES.items():
        bg = tint(base, bg_mul, bg_c)
        bg.save(os.path.join(outdir, f"battle_tone_{name}.png"), "PNG")
        tile = tint(base, tile_mul, tile_c)
        tile.save(os.path.join(outdir, f"territory_tone_{name}.png"), "PNG")
        print(f"tone {name}: bg + tiles generated")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
