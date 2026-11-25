#!/usr/bin/env python3
"""检测兵营出图风格漂移：白墙黑线稿 / 冷灰薄涂 / 主体过小。

判据（对 312² RGBA 的不透明像素统计）：
- 白墙：R,G,B 均>225 且 max-min<18 的像素占比 > 8% → 疑似纯白墙（基准暖色图通常<3%）
- 黑线：R,G,B 均<45 的像素占比 > 4% → 疑似硬黑描边（基准厚涂无黑线，通常<1%）
- 冷灰：满足 b-r>18 且饱和度<0.25 的像素占比 > 12% → 疑似冷灰薄涂
- 填充率：alpha>200 的占比 < 0.12 或 > 0.72 → 主体过小/过大

用法: python3 tools/detect-barracks-drift.py <cutout_dir>
"""
import json
import sys
from pathlib import Path
from PIL import Image


def analyze(path):
    im = Image.open(path).convert('RGBA')
    px = im.load()
    w, h = im.size
    opaque = white = black = cool = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a <= 200:
                continue
            opaque += 1
            mx, mn = max(r, g, b), min(r, g, b)
            if mx > 225 and mx - mn < 18:
                white += 1
            if mx < 45:
                black += 1
            if b - r > 18 and (mx - mn) / max(mx, 1) < 0.25:
                cool += 1
    base = max(opaque, 1)
    return {
        'fill': round(opaque / (w*h), 3),
        'white': round(white / base, 3),
        'black': round(black / base, 3),
        'cool': round(cool / base, 3),
    }


def main():
    d = Path(sys.argv[1])
    issues = {}
    print(f'{"num":<4} {"fill":<7} {"white":<7} {"black":<7} {"cool":<7} verdict')
    for p in sorted(d.glob('barracks_unit_*.png')):
        num = p.stem.split('_')[-1]
        r = analyze(p)
        flags = []
        if r['white'] > 0.08:
            flags.append('WHITE-WALL')
        if r['black'] > 0.04:
            flags.append('BLACK-LINE')
        if r['cool'] > 0.12:
            flags.append('COOL-GREY')
        if r['fill'] < 0.12 or r['fill'] > 0.72:
            flags.append('FILL')
        verdict = ','.join(flags) if flags else 'OK'
        if flags:
            issues[num] = {'metrics': r, 'flags': flags}
        print(f'{num:<4} {r["fill"]:<7} {r["white"]:<7} {r["black"]:<7} {r["cool"]:<7} {verdict}')
    out = d / 'DRIFT-REPORT.json'
    out.write_text(json.dumps(issues, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\nissues: {len(issues)} -> {out}')


if __name__ == '__main__':
    main()
