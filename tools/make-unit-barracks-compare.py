#!/usr/bin/env python3
"""生成「兵种立绘 vs 现有兵营」并排对照图，供重绘评审与灵感提取。

左：unit_XX 立绘（174x216）；右：barracks_unit_XX 兵营（312²）。
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path('E:/GitRep/KingOfTheOccupiers')
NUMS = [2, 4, 5, 8, 9, 10, 11, 12, 14, 15, 16, 18, 19, 20, 23, 24, 27, 28, 30, 31, 32, 35, 37, 38, 39, 40]
NAMES = {
    2:'弓箭手',4:'斥候',5:'民兵',8:'盾兵',9:'骑士',10:'狂战士',11:'骷髅兵',12:'战士',
    14:'牧师',15:'卫兵',16:'海盗',18:'游侠',19:'长枪兵',20:'神射手',23:'战车',24:'驯兽师',
    27:'刽子手',28:'战斗法师',30:'十字军',31:'死灵法师',32:'吸血鬼',35:'风暴法师',
    37:'凤凰',38:'幼龙',39:'战争泰坦',40:'古龙',
}
FONT = 'C:/Windows/Fonts/simhei.ttf'
UW, UH = 174, 216
BW = 260
CELL_W = UW + BW + 30
CELL_H = 280
COLS = 4
PAD = 12
LABEL = 30


def main():
    rows = (len(NUMS) + COLS - 1) // COLS
    W = COLS * (CELL_W + PAD) + PAD
    H = rows * (CELL_H + LABEL + PAD) + PAD
    sheet = Image.new('RGB', (W, H), (16, 28, 48))
    d = ImageDraw.Draw(sheet)
    f = ImageFont.truetype(FONT, 22)
    fs = ImageFont.truetype(FONT, 16)

    for i, n in enumerate(NUMS):
        r, c = divmod(i, COLS)
        x = PAD + c * (CELL_W + PAD)
        y = PAD + r * (CELL_H + LABEL + PAD)
        d.text((x + 6, y + 4), f'{n:02d} {NAMES[n]}', fill=(255, 220, 120), font=f)

        # 立绘（左）
        u = Image.open(ROOT / 'assets/units' / f'unit_{n:02d}.png').convert('RGBA')
        ubg = Image.new('RGBA', (UW, UH), (30, 48, 76, 255))
        ubg.alpha_composite(u)
        sheet.paste(ubg.convert('RGB'), (x + 6, y + LABEL))
        # 兵营（右）
        b = Image.open(ROOT / 'assets/buildings' / f'barracks_unit_{n:02d}.png').convert('RGBA')
        btile = b.resize((BW, BW), Image.LANCZOS)
        bbg = Image.new('RGBA', (BW, BW), (30, 48, 76, 255))
        bbg.alpha_composite(btile)
        bx = x + 6 + UW + 18
        sheet.paste(bbg.convert('RGB'), (bx, y + LABEL))
        # 小标题
        d.text((x + 6 + UW//2 - 16, y + LABEL + UH + 6), '立绘', fill=(150, 190, 230), font=fs)
        d.text((bx + BW//2 - 16, y + LABEL + BW + 6), '兵营', fill=(150, 190, 230), font=fs)

    out = ROOT / '.workbuddy/art-staging/barracks-textonly-v3/UNIT-BARRACKS-COMPARE.png'
    sheet.save(out)
    print(f'wrote {out} ({W}x{H})')


if __name__ == '__main__':
    main()
