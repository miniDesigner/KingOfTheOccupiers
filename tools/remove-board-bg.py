#!/usr/bin/env python3
"""棋盘立体石砖去背（文明7风格，AI 棚拍灰渐变背景专用）。

与 remove-white-bg.py 的区别：
- remove-white-bg.py 判「白度」(min RGB)，适合纯白背景的图标；
  棋盘石砖的 AI 出图是「带柔和渐变的灰色棚拍背景」(RGB 223~255)，
  用白度阈值会把浅灰背景误判成半透明，在深底棋盘上呈现棋盘格噪点。
- 本脚本按「色相 + 明度」区分：石砖是青灰(R<B, B-R>阈值)，背景是中性灰(R≈G≈B)。
  mask = 青色主体 ∪ 石砖正下方的深灰投影；背景/浅灰一律丢弃。

用法:
  python3 tools/remove-board-bg.py <输入图> <输出图> <目标边长>
"""
import sys
from PIL import Image, ImageFilter


def remove_board_bg(img, size):
    img = img.convert('RGB')
    src = img.load()
    w, h = img.size
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    dst = out.load()

    # 第一遍：找青灰石砖的 bbox（色相判据 B-R>12 且非过亮）
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            if b - r > 12 and b > 90 and r < 205:
                xs.append(x); ys.append(y)
    if not xs:
        return out.resize((size, size), Image.LANCZOS)
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    cx = (x0 + x1) // 2
    pad = 24

    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            cyan = (b - r > 8) and (b > 85) and (r < 215)
            # 投影：石砖 bbox 内或正下方(y1~y1+60)、明显暗于背景的中性灰
            in_shadow_zone = (x0 - pad <= x <= x1 + pad) and (y1 - 20 <= y <= y1 + 70)
            dark_gray = (in_shadow_zone and r < 185 and abs(r - b) < 14 and abs(r - g) < 14)
            if cyan or dark_gray:
                dst[x, y] = (r, g, b, 255)

    # 轻微羽化边缘（保实心，只柔化最外 1px 抗锯齿）
    a = out.getchannel('A').filter(ImageFilter.GaussianBlur(0.6))
    out.putalpha(a)

    # 内容 bbox 紧裁：立体石砖要按 1:1 尺寸(2×HEX_SIZE)贴合格子，
    # 不能留大边距（否则渲染时放大溢出到相邻格，侧面被切碎）。
    # 保留极小 padding 容纳厚度侧面的抗锯齿，缩放后主体占画布约 94%。
    bbox = out.getbbox()
    if bbox:
        p = max(2, size // 150)
        l, t = max(0, bbox[0] - p), max(0, bbox[1] - p)
        rr, bb = min(w, bbox[2] + p), min(h, bbox[3] + p)
        out = out.crop((l, t, rr, bb))
    return out.resize((size, size), Image.LANCZOS)


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
    result = remove_board_bg(Image.open(src), size)
    result.save(dst)
    a = result.getchannel('A')
    print(f'saved {dst} size={result.size} alpha={a.getextrema()}')


if __name__ == '__main__':
    main()
