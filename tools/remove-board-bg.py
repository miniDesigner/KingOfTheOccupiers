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
from PIL import Image, ImageChops, ImageDraw, ImageFilter


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

    # 色相阈值会在石砖暗侧面留下大量针孔（青度不足的像素被误判为背景），
    # 且针孔常与外轮廓相连，flood fill 区分不了。石砖主体是凸六边形，
    # 改为对主体像素求凸包并填充，得到干净实心的轮廓；下方投影单独保留半透明。
    raw_a = out.getchannel('A')
    a = ImageChops.lighter(raw_a, raw_a.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7)))
    ap = a.load()

    def avg_color(xa, xb, ya, yb, fallback):
        sr = sg = sb = n = 0
        for yy in range(max(0, ya), min(h, yb)):
            for xx in range(max(0, xa), min(w, xb)):
                if ap[xx, yy] > 200:
                    r, g, b, _ = dst[xx, yy]
                    sr += r; sg += g; sb += b; n += 1
        return (sr // n, sg // n, sb // n) if n else fallback

    side = avg_color(x0, x1 + 1, max(0, y1 - 40), min(h, y1 + 10), (70, 100, 115))
    face = avg_color(x0 + 40, x1 - 40, y0 + 40, max(y0 + 41, y1 - 80), (118, 140, 152))
    side_line = max(0, y1 - 60)

    def convex_hull(points):
        pts = sorted(set(points))
        if len(pts) < 3:
            return pts
        def cross(o, a, b):
            return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
        lower = []
        for p in pts:
            while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
                lower.pop()
            lower.append(p)
        upper = []
        for p in reversed(pts):
            while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
                upper.pop()
            upper.append(p)
        return lower[:-1] + upper[:-1]

    # 主体：青色 bbox 上沿到 y1+8，排除下方独立投影
    body_pts = [(x, y) for y in range(y0, min(h, y1 + 9), 3)
                for x in range(x0, x1 + 1, 3) if ap[x, y] > 0]
    hull = convex_hull(body_pts)
    hull_mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(hull_mask).polygon(hull, fill=255)
    hm = hull_mask.load()
    side_line = max(0, y1 - 60)
    for y in range(h):
        for x in range(w):
            inside = hm[x, y] > 0
            opacity = ap[x, y]
            if inside and opacity == 0:
                # 轮廓内的针孔：补成对应区域材质色，保留原有纹理像素不动
                fill = side if y >= side_line else face
                dst[x, y] = (fill[0], fill[1], fill[2], 255)
            elif inside and y >= side_line:
                # 侧面上残留的浅灰/白色背景像素（阈值误判为不透明）：换成侧面暗青灰
                r, g, b, _ = dst[x, y]
                if r > 125 and abs(b - r) < 18 and abs(g - r) < 18:
                    dst[x, y] = (side[0], side[1], side[2], 255)
            elif not inside and opacity > 0 and y < y1 + 9:
                # 轮廓外的零散噪点：直接剔除
                dst[x, y] = (0, 0, 0, 0)

    # 侧面的半透明白边在深底棋盘上会变成灰白噪点：轮廓内统一实心，轮廓外统一清空
    for y in range(side_line, h):
        for x in range(x0, x1 + 1):
            r, g, b, _ = dst[x, y]
            if hm[x, y]:
                dst[x, y] = (r, g, b, 255)
            else:
                dst[x, y] = (r, g, b, 0)
    a = out.getchannel('A')

    # 投影：独立连通域下移一点、降低 alpha，避免贴纸感
    shadow_pts = [(x, y) for y in range(min(h, y1 + 10), min(h, y1 + 100), 3)
                  for x in range(x0, x1 + 1, 3) if ap[x, y] > 0]
    if len(shadow_pts) >= 3:
        sh = convex_hull(shadow_pts)
        sd = ImageDraw.Draw(out)
        sd.polygon([(x, min(h - 1, y + 6)) for x, y in sh], fill=(*side, 96))
        a = out.getchannel('A')

    out.putalpha(a.filter(ImageFilter.GaussianBlur(0.6)))

    # 内容 bbox 紧裁：保持与已落地渲染标定（顶面宽 98.5% / 高 80% / 中心 y=40%）一致，
    # 不改动裁切与等比缩放逻辑，只修 alpha 空洞。
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
