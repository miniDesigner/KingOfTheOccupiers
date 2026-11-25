#!/usr/bin/env python3
"""生成兵营 40 张「带清晰兵种标注」的拼版图。

每张图下方加醒目深色标签条，用大号中文黑体写「编号 兵种名」，
便于直接对照识别。输出 ANNOTATED-40.png。
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

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

FONT = 'C:/Windows/Fonts/simhei.ttf'
COLS, CELL, PAD, LABEL = 5, 260, 12, 46


def main():
    cutout = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else cutout / 'ANNOTATED-40.png'
    rows = 8
    W = COLS * (CELL + PAD) + PAD
    H = rows * (CELL + LABEL + PAD) + PAD
    sheet = Image.new('RGB', (W, H), (16, 28, 48))
    d = ImageDraw.Draw(sheet)
    f = ImageFont.truetype(FONT, 26)
    fnum = ImageFont.truetype(FONT, 24)

    for i, num in enumerate([f'{n:02d}' for n in range(1, 41)]):
        r, c = divmod(i, COLS)
        x = PAD + c * (CELL + PAD)
        y = PAD + r * (CELL + LABEL + PAD)
        p = cutout / f'barracks_unit_{num}.png'
        im = Image.open(p).convert('RGBA')
        tile = im.resize((CELL, CELL), Image.LANCZOS)
        bg = Image.new('RGBA', (CELL, CELL), (30, 48, 76, 255))
        bg.alpha_composite(tile)
        sheet.paste(bg.convert('RGB'), (x, y))

        # 标签条
        ly = y + CELL
        d.rectangle([x, ly, x + CELL, ly + LABEL], fill=(40, 62, 96))
        d.rectangle([x, ly, x + CELL, ly + 3], fill=(255, 200, 70))
        label = f'{num}  {NAMES[num]}'
        bbox = d.textbbox((0, 0), label, font=f)
        tw = bbox[2] - bbox[0]
        d.text((x + (CELL - tw) // 2, ly + 8), label, fill=(255, 240, 210), font=f)

    sheet.save(out)
    print(f'wrote {out} ({W}x{H})')


if __name__ == '__main__':
    main()
