#!/usr/bin/env python3
"""ImageGen 混元出图专用抠底：去水印 + 清封闭区背景残留 + 连通域抠底。

与 remove-bg-connected.py 的区别：
- 混元模型出的是深蓝紫底 (约 48,65,154)，不是提示词要求的品红；且右下角带
  "AI生成 / WORKBUDDY" 浅灰白水印。单纯连通域抠底会让封闭区（如弓弦与屋顶
  之间）残留背景色块，水印也会被当主体保留。
- 本脚本三步：① 右下角浅灰白水印连通块填背景色；② 全图范围清除"蓝紫背景
  色系"像素（判据 b 通道显著大于 r 通道，暖色主体/米白石基不会被误伤）；
  ③ 边缘 flood fill 连通域抠底，保留主体内部浅色。

用法: python3 tools/remove-bg-artgen.py <input> <output> [target=312]
纯 Pillow 实现。
"""
import sys
from collections import deque
from PIL import Image, ImageFilter


def is_bg_like(r, g, b, bg):
    """蓝紫背景判定：接近采样背景色 或 b 通道显著高于 r（暖色主体不会满足）。"""
    near = abs(r - bg[0]) < 52 and abs(g - bg[1]) < 52 and abs(b - bg[2]) < 52
    blue_dominant = b - r > 45 and b - g > 30 and b > 90
    return near or blue_dominant


def is_watermark(r, g, b, bg):
    """右下角水印像素：浅灰白 或 高饱和粉/紫文字，且明显区别于背景色。
    底座米石不会出现在 x>0.80w 且 y>0.88h 的最右下角，故该区域可宽松判定。"""
    light_grey = r > 110 and g > 110 and b > 110 and max(r, g, b) - min(r, g, b) < 60
    bright_pink = r > 150 and b > 110 and r > g + 45 and b > g + 20
    return (light_grey or bright_pink) and not (
        abs(r - bg[0]) < 30 and abs(g - bg[1]) < 30 and abs(b - bg[2]) < 30)


def remove_bg(src, dst, target=312):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    px = im.load()

    # 1) 采样四角 + 边缘中点估计背景色
    pts = [(2, 2), (w-3, 2), (2, h-3), (w-3, h-3),
           (w//2, 2), (w//2, h-3), (2, h//2), (w-3, h//2)]
    samples = [px[x, y] for x, y in pts if 0 <= x < w and 0 <= y < h]
    bg = tuple(sum(c[i] for c in samples)//len(samples) for i in range(3))

    # 2) 右下角水印：在 x>0.80w 且 y>0.88h 区域内找浅灰白连通块，填成背景色
    x0, y0 = int(w*0.76), int(h*0.86)
    wm = bytearray(w*h)
    q = deque()
    for y in range(y0, h):
        for x in range(x0, w):
            i = y*w+x
            if is_watermark(*px[x, y], bg):
                wm[i] = 1
                q.append((x, y))
    seen = bytearray(w*h)
    while q:
        x, y = q.popleft()
        for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
            if x0 <= nx < w and y0 <= ny < h:
                i = ny*w+nx
                if wm[i] and not seen[i]:
                    seen[i] = 1
                    q.append((nx, ny))
    # 连通块直接填背景。仅对确定的水印连通块（面积<0.6%画布）处理，
    # 避免误伤延伸到右下角的主体（如 07 学徒图的粉色书本装饰）。
    num_wm = sum(1 for i in range(w*h) if wm[i] or seen[i])
    if num_wm < w*h*0.006:
        for i in range(w*h):
            if wm[i] or seen[i]:
                px[i % w, i // w] = bg

    # 3) 全图清蓝紫背景系像素（含弓弦围出的封闭区域），但不碰暖色主体
    #    记录 cleared 掩码：封闭区虽不连通边缘，也要挖成透明
    cleared = bytearray(w*h)
    for y in range(h):
        row = y*w
        for x in range(w):
            i = row+x
            r, g, b = px[x, y]
            if is_bg_like(r, g, b, bg):
                cleared[i] = 1
                px[x, y] = bg

    # 4) 边缘 flood fill 连通域抠底（保护主体内部浅色）
    visited = bytearray(w*h)
    q = deque()
    for x in range(w):
        for y in (0, h-1):
            i = y*w+x
            if not visited[i] and is_bg_like(*px[x, y], bg):
                visited[i] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w-1):
            i = y*w+x
            if not visited[i] and is_bg_like(*px[x, y], bg):
                visited[i] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
            if 0 <= nx < w and 0 <= ny < h:
                i = ny*w+nx
                if not visited[i] and is_bg_like(*px[nx, ny], bg):
                    visited[i] = 1
                    q.append((nx, ny))

    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        row = y*w
        for x in range(w):
            if visited[row+x] or cleared[row+x]:
                ap[x, y] = 0
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))

    # 5) 裁包围盒 + 等比缩放居中（不横向拉伸）
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
    remove_bg(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 312)
    print(f'{sys.argv[1]} -> {sys.argv[2]}')
