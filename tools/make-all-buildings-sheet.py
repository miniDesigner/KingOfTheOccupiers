#!/usr/bin/env python3
"""生成全量建筑资源总览图（1:1 原尺寸）。

数据源：src/system/ArtManifest.js 中 cat=buildings 的条目（正式名字来自 label）。
约束：图片按 manifest 声明的 w/h 原样贴图，禁止 resize；脚本会断言实际尺寸一致。

用法：
  python tools/make-all-buildings-sheet.py
  python tools/make-all-buildings-sheet.py <out.png>
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'src/system/ArtManifest.js'
ASSETS = ROOT / 'assets'
DEFAULT_OUT = ROOT / '.workbuddy/artifacts/全部建筑资源总览-1比1-2026-11-26.png'

FONT_CANDIDATES = [
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/msyh.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
]

COLS = 7
PAD = 12
LABEL_H = 66
CELL_W = PAD + 312 + PAD
CELL_H = PAD + 312 + LABEL_H + PAD
MARGIN = 24
HEADER_H = 88
SECTION_H = 48
SECTION_GAP = 28
BOTTOM = 28

BG = (16, 28, 48)
CELL_BG = (30, 48, 76)
BAR_BG = (40, 62, 96)
ACCENT_A = (255, 200, 70)
ACCENT_B = (86, 200, 220)
TEXT_MAIN = (255, 242, 214)
TEXT_SUB = (166, 190, 214)


def load_font(size):
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def parse_buildings():
    txt = MANIFEST.read_text(encoding='utf-8')
    pat = re.compile(r'\{\s*"key":\s*"(?P<key>[^"]+)"(?P<body>.*?)\n\s*\}', re.S)
    out = []
    for m in pat.finditer(txt):
        body = m.group('body')
        if '"cat": "buildings"' not in body:
            continue
        def field(name, cast=str):
            hit = re.search(r'"' + name + r'":\s*("?)([^",\n]+)\1', body)
            return cast(hit.group(2).strip()) if hit else None
        out.append({
            'key': m.group('key'),
            'path': field('path'),
            'label': field('label'),
            'w': field('w', int),
            'h': field('h', int),
        })
    return out


def center_text(d, x, y, w, text, font, fill):
    bbox = d.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    d.text((x + (w - tw) // 2, y), text, font=font, fill=fill)


def draw_section(sheet, d, entries, top, title, accent, f_title, f_main, f_sub):
    center_text(d, MARGIN, top + 8, sheet.width - 2 * MARGIN, title, f_title, accent)
    y0 = top + SECTION_H
    rows = (len(entries) + COLS - 1) // COLS
    for i, ent in enumerate(entries):
        r, c = divmod(i, COLS)
        x = MARGIN + c * CELL_W
        y = y0 + r * CELL_H

        d.rectangle([x, y, x + CELL_W - 1, y + CELL_H - 1], fill=CELL_BG)
        d.rectangle([x, y, x + CELL_W - 1, y + PAD + ent['h'] + 4], fill=CELL_BG)

        img_path = ASSETS / ent['path']
        im = Image.open(img_path).convert('RGBA')
        if im.size != (ent['w'], ent['h']):
            raise ValueError(f'{img_path}: actual {im.size} != manifest {(ent["w"], ent["h"])}')
        if im.size != (312, 312):
            raise ValueError(f'{img_path}: 本总览按 312x312 网格排版，实际 {im.size}')
        tile = Image.new('RGBA', im.size, CELL_BG + (255,))
        tile.alpha_composite(im)
        sheet.paste(tile.convert('RGB'), (x + PAD, y + PAD))

        by = y + PAD + ent['h'] + 6
        d.rectangle([x, by, x + CELL_W - 1, y + CELL_H - 1], fill=BAR_BG)
        d.rectangle([x, by, x + CELL_W - 1, by + 3], fill=accent)
        center_text(d, x, by + 9, CELL_W, ent['label'], f_main, TEXT_MAIN)
        center_text(d, x, by + 36, CELL_W,
                    f'{Path(ent["path"]).name}  {ent["w"]}x{ent["h"]}', f_sub, TEXT_SUB)

    return y0 + rows * CELL_H


def write_inventory(out, main_assets, unit_barracks):
    md = out.with_suffix('.md')
    lines = [
        '# 全量建筑资源清单（1:1 原尺寸）',
        '',
        '## 结论',
        '',
        f'工程内建筑贴图共 {len(main_assets) + len(unit_barracks)} 张，全部 312×312 RGBA。'
        '总览图按文件原始像素 1:1 摆放，未缩放；标注名取自 `src/system/ArtManifest.js` 的 `label` 字段。',
        '',
        '## 地图建筑（9 张）',
        '',
        '| 使用名字 | 资源文件 | 尺寸 | 资源 key |',
        '|---|---|---|---|',
    ]
    for e in main_assets:
        lines.append(f'| {e["label"]} | `{e["path"]}` | {e["w"]}×{e["h"]} | `{e["key"]}` |')
    lines += [
        '',
        '## 兵种专属兵营（40 张）',
        '',
        '| 使用名字 | 资源文件 | 尺寸 | 资源 key |',
        '|---|---|---|---|',
    ]
    for e in unit_barracks:
        lines.append(f'| {e["label"]} | `{e["path"]}` | {e["w"]}×{e["h"]} | `{e["key"]}` |')
    lines += [
        '',
        '## 口径说明',
        '',
        '- `label` 是资源清单里的正式名字，和总览图上的中文标注一致。',
        '- `config/buildings.json` 中的显示名另有一套口径：兵营Lv1~Lv4 / 箭塔 / 金矿Lv1~Lv2 / 大本营；'
        '本清单以资源清单 label 为准，便于按文件名定位素材。',
        '- `ruin.png` 的 label 为「建筑摧毁态」，不是可建造建筑，已一并列入便于总览。',
        '',
    ]
    md.write_text('\n'.join(lines), encoding='utf-8')
    print(f'wrote {md}')


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    out.parent.mkdir(parents=True, exist_ok=True)

    entries = parse_buildings()
    main_assets = [e for e in entries if not e['path'].startswith('buildings/barracks_unit_')]
    unit_barracks = [e for e in entries if e['path'].startswith('buildings/barracks_unit_')]
    if len(entries) != 49 or len(main_assets) != 9 or len(unit_barracks) != 40:
        raise ValueError(f'资源数量异常: total={len(entries)} main={len(main_assets)} unit={len(unit_barracks)}')

    rows = ((len(main_assets) + COLS - 1) // COLS) + ((len(unit_barracks) + COLS - 1) // COLS)
    W = 2 * MARGIN + COLS * CELL_W
    H = HEADER_H + 2 * SECTION_H + rows * CELL_H + SECTION_GAP + BOTTOM

    sheet = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(sheet)
    f_title = load_font(34)
    f_subtitle = load_font(18)
    f_section = load_font(24)
    f_main = load_font(20)
    f_cellsub = load_font(14)

    center_text(d, MARGIN, 16, W - 2 * MARGIN, '占地之王 · 建筑资源总览（1:1 原尺寸）', f_title, TEXT_MAIN)
    center_text(d, MARGIN, 58, W - 2 * MARGIN,
                f'共 {len(entries)} 张 · 全部 312x312 px · 标注名取自 ArtManifest.label', f_subtitle, TEXT_SUB)

    y = draw_section(sheet, d, main_assets, HEADER_H, '地图建筑 · 兵营等级 / 箭塔 / 金矿 / 大本营 / 摧毁态',
                     ACCENT_A, f_section, f_main, f_cellsub)
    draw_section(sheet, d, unit_barracks, y + SECTION_GAP, '兵种专属兵营 · 40 兵种',
                 ACCENT_B, f_section, f_main, f_cellsub)

    sheet.save(out)
    print(f'wrote {out} ({W}x{H}), entries={len(entries)}')
    write_inventory(out, main_assets, unit_barracks)


if __name__ == '__main__':
    main()
