#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ImageGen 暗玫红底专用抠底（V2 去房屋化批次）。

背景事实：混元出图在纯品红提示下，本批实际出的是暗玫红底 (约 142,54,73)，
与上一批亮玫红 (230,17,144) / 蓝紫 (48,65,154) 都不同。通用脚本
remove-bg-artgen.py 的 near 容差 52 会把主体深棕木墙 (约 89,56,49) 误判为背景
（g 通道仅差 2），形成白色破洞。本脚本改用严格 tol 的连通域抠底。

三步：
1) 从四边 flood fill，严格容差 tol 只挖连通到边缘的背景；
2) 右下角水印（浅灰白/粉白，非玫红）连通块挖成透明；
3) 裁包围盒 + 等比缩放居中 + 轻羽化。

用法: python3 tools/remove-bg-artgen-magenta.py <input> <output> [target=312] [tol=24]
纯 Pillow 实现。
"""
import sys
from collections import deque
from PIL import Image, ImageFilter


def is_magenta_bg(r, g, b, bg, tol):
    """暗玫红背景：接近采样色，且满足红显著高于绿的色相约束。"""
    near = abs(r - bg[0]) < tol and abs(g - bg[1]) < tol and abs(b - bg[2]) < tol
    magenta_hue = r > g + 45 and r > 100 and b > g
    return near and magenta_hue


def is_watermark(r, g, b, bg):
    """右下角水印：浅灰白/粉白/浅粉字，或明显亮于暗玫红背景的杂色。

    该脚本只在 x>0.76w,y>0.85h 的最右下角搜索，主体底座已缩到安全边距内，
    此区域不会有主体像素，故可宽松判定，包括水印里的粉红描边。
    """
    light = r > 120 and g > 80 and b > 80 and max(r, g, b) - min(r, g, b) < 115
    bright = r > 150 and g > 75 and b > 75  # 水印粉色描边/白字
    return light or bright


def remove_bg(src, dst, target=312, tol=24, closed=False):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    px = im.load()

    # 1) 采样背景色
    pts = [(2, 2), (w-3, 2), (2, h-3), (w-3, h-3),
           (w//2, 2), (w//2, h-3), (2, h//2), (w-3, h//2)]
    samples = [px[x, y] for x, y in pts]
    bg = tuple(sum(c[i] for c in samples)//len(samples) for i in range(3))

    # 1b) 封闭区背景清除（可选）：全图按严格玫红色相挖，专清铁环/拱洞等
    #     不与边缘连通的背景残留。色相阈值 r-g>50 保证暖棕主体(r-g≈33)不被误伤。
    closed_mask = bytearray(w*h)
    if closed:
        for y in range(h):
            row = y*w
            for x in range(w):
                r, g, b = px[x, y]
                if r > 125 and r - g > 50 and b > g and b > 60:
                    closed_mask[row+x] = 1

    # 2) 四边 flood fill 连通背景
    visited = bytearray(w*h)
    q = deque()
    for x in range(w):
        for y in (0, h-1):
            i = y*w+x
            if not visited[i] and is_magenta_bg(*px[x, y], bg, tol):
                visited[i] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w-1):
            i = y*w+x
            if not visited[i] and is_magenta_bg(*px[x, y], bg, tol):
                visited[i] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
            if 0 <= nx < w and 0 <= ny < h:
                i = ny*w+nx
                if not visited[i] and is_magenta_bg(*px[nx, ny], bg, tol):
                    visited[i] = 1
                    q.append((nx, ny))

    # 3) 右下角水印（浅灰白连通块），只清 x>0.76w,y>0.85h，面积上限防误伤
    # 最右下角 x>0.76w,y>0.85h 内没有主体（底座已缩到安全边距内），
    # 该区域所有非背景像素一律视为水印（含淡粉抗锯齿边），直接挖掉。
    x0, y0 = int(w*0.76), int(h*0.85)
    wm_mask = bytearray(w*h)
    for y in range(y0, h):
        row = y*w
        for x in range(x0, w):
            r, g, b = px[x, y]
            if not is_magenta_bg(r, g, b, bg, 30):
                wm_mask[row+x] = 1

    # 4) alpha
    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        row = y*w
        for x in range(w):
            if visited[row+x] or wm_mask[row+x] or closed_mask[row+x]:
                ap[x, y] = 0
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))

    # 5) 裁包围盒 + 等比缩放居中
    bbox = alpha.getbbox()
    if bbox:
        im = im.crop(bbox)
        alpha = alpha.crop(bbox)
    cw, ch = im.size
    scale = min(target/cw, target/ch) * 0.94
    nw, nh = int(cw*scale), int(ch*scale)
    im = im.resize((nw, nh), Image.LANCZOS)
    alpha = alpha.resize((nw, nh), Image.LANCZOS)
    out = Image.new('RGBA', (target, target), (0, 0, 0, 0))
    out.paste(im, ((target-nw)//2, (target-nh)//2))
    fa = Image.new('L', (target, target), 0)
    fa.paste(alpha, ((target-nw)//2, (target-nh)//2))
    out.putalpha(fa)
    out.save(dst)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    t = int(sys.argv[3]) if len(sys.argv) > 3 else 312
    tol = int(sys.argv[4]) if len(sys.argv) > 4 else 24
    closed = len(sys.argv) > 5 and sys.argv[5] == '--closed'
    remove_bg(sys.argv[1], sys.argv[2], t, tol, closed)
    print(f'{sys.argv[1]} -> {sys.argv[2]} (tol={tol}, closed={closed})')
