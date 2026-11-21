#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""美术占位图审计（本地可复跑版）

逐张对照 assets/PLACEHOLDER-MANIFEST.csv，识别仍是「占位说明卡」的素材。
占位卡统一特征：大块深色底（深蓝/紫/灰绿）占比高 + 亮色描边 + 编号文字。
正式图（含程序化绘制的纯色按钮/进度条等）深色底占比低或色相不符。

用法： python3 tools/audit-art-placeholders.py
输出： 按品类统计 + 占位清单；--csv 额外导出明细
"""
import csv, sys
from collections import defaultdict
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
MANIFEST = ASSETS / 'PLACEHOLDER-MANIFEST.csv'

def is_placeholder_card(path):
    """深蓝/紫/灰绿底面积占比 > 35% 判为占位卡。"""
    try:
        src = Image.open(path).convert('RGBA')
    except Exception:
        return False
    # 半透明图标先合成到白底，避免透明区被当成深色
    bg = Image.new('RGBA', src.size, (255, 255, 255, 255))
    bg.alpha_composite(src)
    im = bg.convert('RGB')
    im.thumbnail((48, 48))
    px = list(im.getdata())
    if len(px) < 20:
        return False
    avg = sum((r + g + b) / 3 for r, g, b in px) / len(px)
    dark = sum(1 for r, g, b in px if (r + g + b) / 3 < 90) / len(px)
    # 占位卡：中等均亮 52~105 + 大片深色底 0.45~0.92；
    # 排除真暗夜景(均亮<50/深色>0.95)与亮色正式图(均亮>105)
    return 52 <= avg <= 105 and 0.45 <= dark <= 0.92

def main():
    rows = list(csv.DictReader(open(MANIFEST, encoding='utf-8-sig')))
    ph, formal = defaultdict(list), defaultdict(list)
    for r in rows:
        p = r['目标路径（相对 assets/）'].strip()
        cat = r['品类']
        name = r['状态 / 名称']
        f = ASSETS / p
        if not f.exists():
            continue
        flag = is_placeholder_card(f)
        (ph if flag else formal)[cat].append((p, name))
    print(f'{"品类":6} {"总数":>4} {"占位":>4} {"已就绪":>5}')
    total_ph = 0
    for cat in ['应用', '背景', '建筑', '地块', '特效', '字体', '图标', '界面', '兵种']:
        n = len(ph[cat]) + len(formal[cat])
        total_ph += len(ph[cat])
        print(f'{cat:6} {n:4} {len(ph[cat]):4} {len(formal[cat]):5}')
    print(f'\n合计：{sum(len(ph[c])+len(formal[c]) for c in ph)} 张，占位 {total_ph} 张')
    out = []
    for cat in ph:
        print(f'\n## {cat} ({len(ph[cat])})')
        for p, name in ph[cat]:
            print(f'  {p}  {name}')
            out.append({'品类': cat, '路径': p, '名称': name})
    if '--csv' in sys.argv:
        with open(ROOT / 'placeholder-audit.csv', 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.DictWriter(f, ['品类', '路径', '名称'])
            w.writeheader()
            w.writerows(out)
        print('\n已导出 placeholder-audit.csv')

if __name__ == '__main__':
    main()
