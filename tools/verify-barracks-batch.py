#!/usr/bin/env python3
"""兵营 40 张批量验收：规格合规 + 10% 缩略图接触表 + 灰度剪影表。

用法: python3 tools/verify-barracks-batch.py <cutout_dir> [out_dir]
输出:
- 控制台逐张规格报告（尺寸/模式/四角alpha/主体占比/边缘杂色）
- CONTACT-SHEET.png：40 张 312² 按 5x8 排列
- THUMB-10PCT.png：40 张缩到 31² 后放大 3 倍拼版，测可辨识度
- SILHOUETTE.png：40 张涂黑剪影拼版
- VERIFY-REPORT.json
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw

NAMES = {
    '01': '剑士', '02': '弓箭手', '03': '枪兵', '04': '斥候', '05': '民兵',
    '06': '投石兵', '07': '学徒', '08': '盾兵', '09': '骑士', '10': '狂战士',
    '11': '骷髅兵', '12': '战士', '13': '猎人', '14': '牧师', '15': '卫兵',
    '16': '海盗', '17': '弩手', '18': '游侠', '19': '长枪兵', '20': '神射手',
    '21': '冰法师', '22': '圣堂武士', '23': '战车', '24': '驯兽师', '25': '法师',
    '26': '圣骑士', '27': '刽子手', '28': '战斗法师', '29': '大法师', '30': '十字军',
    '31': '死灵法师', '32': '吸血鬼', '33': '蒸汽坦克', '34': '死亡骑士', '35': '风暴法师',
    '36': '战象', '37': '凤凰', '38': '幼龙', '39': '战争泰坦', '40': '古龙',
}

COLS, CELL = 5, 260
PAD, LABEL = 8, 22


def check_one(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = im.load()
    corners = [px[0, 0][3], px[w-1, 0][3], px[0, h-1][3], px[w-1, h-1][3]]
    opaque = sum(1 for y in range(h) for x in range(w) if px[x, y][3] > 200)
    total = w * h
    ratio = opaque / total
    # 边缘杂色：alpha>0 但接近深蓝紫 (b-r>45) 的像素数
    edge_blue = sum(1 for y in range(0, h, 2) for x in range(0, w, 2)
                    if px[x, y][3] > 180 and px[x, y][2] - px[x, y][0] > 45
                    and px[x, y][2] > 90)
    ok_size = (w == 312 and h == 312)
    ok_corner = all(a < 10 for a in corners)
    ok_ratio = 0.10 < ratio < 0.80
    ok_blue = edge_blue < 40
    return {
        'size': f'{w}x{h}', 'ok_size': ok_size,
        'corners': corners, 'ok_corner': ok_corner,
        'opaque_ratio': round(ratio, 3), 'ok_ratio': ok_ratio,
        'blue_residue': edge_blue, 'ok_blue': ok_blue,
        'pass': ok_size and ok_corner and ok_ratio and ok_blue,
    }


def load_all(cutout):
    imgs = {}
    for num in NAMES:
        p = cutout / f'barracks_unit_{num}.png'
        if p.exists():
            imgs[num] = Image.open(p).convert('RGBA')
    return imgs


def make_sheet(imgs, out, mode):
    rows = (len(imgs) + COLS - 1) // COLS
    W = COLS * (CELL + PAD) + PAD
    H = rows * (CELL + LABEL + PAD) + PAD
    sheet = Image.new('RGB', (W, H), (24, 38, 62))
    d = ImageDraw.Draw(sheet)
    for i, (num, im) in enumerate(sorted(imgs.items())):
        r, c = divmod(i, COLS)
        x = PAD + c * (CELL + PAD)
        y = PAD + r * (CELL + LABEL + PAD)
        if mode == 'full':
            tile = im.resize((CELL, CELL), Image.LANCZOS)
            bg = Image.new('RGBA', (CELL, CELL), (34, 52, 82, 255))
            bg.alpha_composite(tile)
            sheet.paste(bg.convert('RGB'), (x, y))
        elif mode == 'thumb':
            t = im.resize((31, 31), Image.LANCZOS)
            tile = t.resize((CELL, CELL), Image.NEAREST)
            bg = Image.new('RGBA', (CELL, CELL), (34, 52, 82, 255))
            bg.alpha_composite(tile)
            sheet.paste(bg.convert('RGB'), (x, y))
        elif mode == 'silhouette':
            a = im.getchannel('A').point(lambda v: 255 if v > 110 else 0)
            sil = Image.new('RGBA', im.size, (250, 210, 60, 0))
            sil.putalpha(a)
            tile = sil.resize((CELL, CELL), Image.LANCZOS)
            bg = Image.new('RGBA', (CELL, CELL), (34, 52, 82, 255))
            bg.alpha_composite(tile)
            sheet.paste(bg.convert('RGB'), (x, y))
        d.text((x + 4, y + CELL + 3), f'{num} {NAMES[num]}', fill=(235, 240, 250))
    sheet.save(out)
    print(f'  wrote {out.name} ({W}x{H})')


def main():
    cutout = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else cutout
    out.mkdir(parents=True, exist_ok=True)
    imgs = load_all(cutout)
    print(f'found {len(imgs)}/40 images')
    report = {}
    for num in sorted(NAMES):
        p = cutout / f'barracks_unit_{num}.png'
        if not p.exists():
            report[num] = {'missing': True, 'pass': False}
            print(f'  {num} {NAMES[num]:<6} MISSING')
            continue
        r = check_one(p)
        report[num] = r
        flag = 'OK  ' if r['pass'] else 'FAIL'
        print(f'  {num} {NAMES[num]:<6} {flag} size={r["size"]} corner={r["corners"]} '
              f'fill={r["opaque_ratio"]} blue={r["blue_residue"]}')
    make_sheet(imgs, out / 'CONTACT-SHEET.png', 'full')
    make_sheet(imgs, out / 'THUMB-10PCT.png', 'thumb')
    make_sheet(imgs, out / 'SILHOUETTE.png', 'silhouette')
    (out / 'VERIFY-REPORT.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    passed = sum(1 for v in report.values() if v.get('pass'))
    print(f'PASS {passed}/{len(NAMES)}')


if __name__ == '__main__':
    main()
