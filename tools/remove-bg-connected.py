#!/usr/bin/env python3
"""连通域抠底：只挖掉与画布边缘连通的背景，保留主体内部的浅色区域。

与 remove-bg-building.py 的区别：
- 旧脚本用全局颜色阈值 —— 只要像素接近背景色就挖，会把雪顶、米白石基这类
  「主体内部的浅色」误判成背景，形成黑洞（2026-11-25 山脉基准图踩过坑）。
- 本脚本从四条边做 flood fill，只有「连通到边缘」的背景才透明。被主体包围的
  浅色区域不与边缘连通，自然保留。

用法: python3 tools/remove-bg-connected.py <input> <output> [target=312] [tol=48]
纯 Pillow 实现，无第三方依赖。
"""
import sys
from collections import deque
from PIL import Image, ImageFilter


def remove_bg_connected(src, dst, target=312, tol=48, feather=0.6):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    px = im.load()

    # 1) 采样四角与边缘中点作为背景色
    sample_pts = [(2, 2), (w-3, 2), (2, h-3), (w-3, h-3),
                  (w//2, 2), (w//2, h-3), (2, h//2), (w-3, h//2)]
    samples = [px[x, y] for x, y in sample_pts if 0 <= x < w and 0 <= y < h]
    bg = tuple(sum(c[i] for c in samples)//len(samples) for i in range(3))

    def is_bg(r, g, b):
        return abs(r-bg[0]) < tol and abs(g-bg[1]) < tol and abs(b-bg[2]) < tol

    # 2) flood fill：只从边缘入队，染连通到边缘的背景
    visited = bytearray(w*h)
    q = deque()
    for x in range(w):
        for y in (0, h-1):
            i = y*w + x
            if not visited[i] and is_bg(*px[x, y]):
                visited[i] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w-1):
            i = y*w + x
            if not visited[i] and is_bg(*px[x, y]):
                visited[i] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
            if 0 <= nx < w and 0 <= ny < h:
                i = ny*w + nx
                if not visited[i] and is_bg(*px[nx, ny]):
                    visited[i] = 1
                    q.append((nx, ny))

    # 3) alpha：连通背景=0，其余=255，边缘轻羽化
    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        row = y*w
        for x in range(w):
            if visited[row+x]:
                ap[x, y] = 0
    if feather > 0:
        alpha = alpha.filter(ImageFilter.GaussianBlur(feather))

    # 4) 裁包围盒 + 等比缩放居中到 target²（不横向拉伸）
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
    ox, oy = (target-nw)//2, (target-nh)//2
    out.paste(im, (ox, oy))
    fa = Image.new('L', (target, target), 0)
    fa.paste(alpha, (ox, oy))
    out.putalpha(fa)
    out.save(dst)
    print(f'{src} -> {dst} bg={bg} bbox={bbox} bg_px={sum(visited)} out={out.size}')
    return out


if __name__ == '__main__':
    remove_bg_connected(
        sys.argv[1], sys.argv[2],
        int(sys.argv[3]) if len(sys.argv) > 3 else 312,
        int(sys.argv[4]) if len(sys.argv) > 4 else 48)
