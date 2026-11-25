#!/usr/bin/env python3
"""清除兵营 312² 抠底图右下角残留的 AI 水印（粉色/浅色小字）。

只处理 x>262 且 y>262 的右下角区域，且只清 alpha>100 的孤立浅色/粉色像素。
该区域主体（建筑底座）已缩到 94% 居中，最外 6% 留白，正常情况下无主体像素。
为避免误伤，统计每张清除量，>600px 的报警（可能是主体延伸，需人工确认）。

用法: python3 tools/clean-barracks-watermark.py <cutout_dir>
"""
import sys
from pathlib import Path
from PIL import Image


def is_wm(r, g, b):
    pink = r > 140 and b > 100 and r > g + 40 and b > g + 15
    light = r > 170 and g > 170 and b > 170 and max(r, g, b) - min(r, g, b) < 40
    return pink or light


def main():
    d = Path(sys.argv[1])
    alerts = []
    for p in sorted(d.glob('barracks_unit_*.png')):
        im = Image.open(p).convert('RGBA')
        px = im.load()
        removed = 0
        for y in range(262, 312):
            for x in range(262, 312):
                r, g, b, a = px[x, y]
                if a > 100 and is_wm(r, g, b):
                    px[x, y] = (r, g, b, 0)
                    removed += 1
        if removed:
            im.save(p)
            flag = '  <-- CHECK' if removed > 600 else ''
            print(f'{p.stem}: removed {removed} px{flag}')
            if removed > 600:
                alerts.append(p.stem)
    print(f'\nalerts (>600px, manual review): {alerts if alerts else "none"}')


if __name__ == '__main__':
    main()
