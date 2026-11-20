#!/usr/bin/env python3
"""从 OLD de-bg (checkerboard noise) 石砖图中提取干净本体。

输入：v2_clean（alpha>=200 石砖本体 + 铺满画布的半透明棋盘格噪点）
输出：312×312 透明 PNG，只保留圆润六边形石砖 + 程序化米白投影。

做法：
1) alpha>=200 实心像素求凸包 -> 石砖硬轮廓；
2) 凸包内只保留 alpha>=128 的像素（保住裂纹/高光纹理，滤掉半透明噪点）；
3) 连通域只保留最大块（滤掉凸包内零星白点）；
4) 投影程序化生成：轮廓外扩成环、只取下缘、米白软填充 + 轻微模糊；
5) 紧裁 + 等比缩放到目标尺寸。
"""
import sys
from collections import deque
from PIL import Image, ImageFilter, ImageDraw


def convex_hull(points):
    points = sorted(set(points))
    if len(points) <= 1:
        return points
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower = []
    for p in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def main(src, dst, size=312, body_th=200, pad=2, shadow_px=10):
    im = Image.open(src).convert('RGBA')
    px = im.load()
    w, h = im.size

    solid = [(x, y) for y in range(h) for x in range(w) if px[x, y][3] >= body_th]
    if len(solid) < 100:
        raise SystemExit('no solid body found')
    hull = convex_hull(solid)

    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).polygon(hull, fill=255)
    mp = mask.load()

    # 1) 凸包内只留 alpha>=128 的原像素
    body = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    bp = body.load()
    for y in range(h):
        for x in range(w):
            if mp[x, y] and px[x, y][3] >= 128:
                bp[x, y] = px[x, y]

    # 2) 连通域：只保留最大块
    ba = body.getchannel('A')
    bap = ba.load()
    seen = bytearray(w * h)
    best = None
    best_n = 0
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if bap[x, y] < 40 or seen[i]:
                continue
            q = deque([(x, y)]); seen[i] = 1; comp = []
            while q:
                cx, cy = q.popleft(); comp.append((cx, cy))
                for nx, ny in ((cx-1,cy),(cx+1,cy),(cx,cy-1),(cx,cy+1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if bap[nx, ny] >= 40 and not seen[j]:
                            seen[j] = 1; q.append((nx, ny))
            if len(comp) > best_n:
                best_n = len(comp); best = comp
    body2 = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    b2p = body2.load()
    for x, y in best:
        b2p[x, y] = bp[x, y]

    # 3) 程序化米白软投影：轮廓外扩 -> 只取下缘环 -> 米白 -> 模糊
    dilated = mask.filter(ImageFilter.MaxFilter(shadow_px * 2 + 1))
    dp = dilated.load()
    cy = sum(p[1] for p in hull) / len(hull)
    shadow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    sp = shadow.load()
    for y in range(h):
        for x in range(w):
            if dp[x, y] and not mp[x, y] and y > cy + 6:
                sp[x, y] = (255, 250, 235, 120)
    shadow = shadow.filter(ImageFilter.GaussianBlur(3))

    out = Image.alpha_composite(shadow, body2)

    # 4) 紧裁 + 等比缩放
    bbox = out.getchannel('A').getbbox()
    crop = out.crop(bbox)
    cw, ch = crop.size
    scale = (size - 2 * pad) / max(cw, ch)
    nw, nh = max(1, round(cw * scale)), max(1, round(ch * scale))
    crop = crop.resize((nw, nh), Image.LANCZOS)
    final = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    final.paste(crop, ((size - nw) // 2, (size - nh) // 2), crop)
    final.save(dst)
    print('solid bbox', min(p[0] for p in solid), min(p[1] for p in solid),
          max(p[0] for p in solid), max(p[1] for p in solid),
          '| largest comp', best_n, '| content bbox', bbox, '->', (nw, nh))


if __name__ == '__main__':
    main(*sys.argv[1:])
