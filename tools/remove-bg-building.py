#!/usr/bin/env python3
"""建筑图抠底：把 AI 生成的浅色棋盘格/纯色底转透明，输出 312² RGBA。
用法: python3 tools/remove-bg-building.py <input> <output> [target=312]
纯 Pillow 实现：基于四角背景色的 flood fill，边缘做羽化避免硬锯齿。
"""
import sys
from PIL import Image, ImageFilter

def remove_bg(src, dst, target=312, feather=1):
    im = Image.open(src).convert('RGB')
    w, h = im.size
    px = im.load()
    # 采样背景色：AI 出图棋盘格示意透明，通常是两种交替浅色（如 235 与 205）
    # 从四角及边缘多点采样，聚类出 1~2 个背景色
    sample_pts = [(2,2),(w-3,2),(2,h-3),(w-3,h-3),
                  (w//4,2),(w//2,2),(w*3//4,2),
                  (2,h//2),(2,h*3//4),(w-3,h//2)]
    samples = [px[x,y][:3] for x,y in sample_pts if 0<=x<w and 0<=y<h]
    # 简易聚类：按亮度分两组，取每组均值
    bgs = []
    sorted_by_lum = sorted(samples, key=lambda c: sum(c))
    # 前一半暗色组、后一半亮色组
    k = max(2, len(samples)//2)
    dark = sorted_by_lum[:k][:3]; light = sorted_by_lum[k-3:]
    def avg(lst): return tuple(sum(c[i] for c in lst)//len(lst) for i in range(3))
    g1, g2 = avg(dark), avg(light)
    # 若两组接近(<18)视为纯色背景，只用一个
    if max(abs(g1[i]-g2[i]) for i in range(3)) < 18:
        bgs = [avg(samples)]
    else:
        bgs = [g1, g2]
    bg = bgs[0]
    tol = 46
    def is_bg(r,g,b):
        return any(abs(r-c[0])<tol and abs(g-c[1])<tol and abs(b-c[2])<tol for c in bgs)
    # 逐像素判定 + 边缘羽化：与背景色接近度做 alpha
    alpha = Image.new('L', (w,h), 255)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            r,g,b = px[x,y]
            if is_bg(r,g,b):
                ap[x,y] = 0
            else:
                # 边缘半透明过渡：距离背景色越近 alpha 越低
                d = max(abs(r-bg[0]),abs(g-bg[1]),abs(b-bg[2]))
                if d < tol+30:
                    ap[x,y] = int(255 * (d-(tol)) / 30) if d>tol else 0
    # 形态学：填掉主体内部误判的小洞（简单：3x3 中值滤波平滑 alpha）
    alpha = alpha.filter(ImageFilter.MedianFilter(3))
    # 裁到非透明包围盒
    bbox = alpha.getbbox()
    if bbox:
        im = im.crop(bbox); alpha = alpha.crop(bbox)
    # 等比缩放进 target²，居中
    cw,ch = im.size
    scale = min(target/cw, target/ch) * 0.94
    nw,nh = int(cw*scale), int(ch*scale)
    im = im.resize((nw,nh), Image.LANCZOS)
    alpha = alpha.resize((nw,nh), Image.LANCZOS)
    out = Image.new('RGBA',(target,target),(0,0,0,0))
    ox,oy = (target-nw)//2, (target-nh)//2
    out.paste(im,(ox,oy))
    final_alpha = Image.new('L',(target,target),0)
    final_alpha.paste(alpha,(ox,oy))
    out.putalpha(final_alpha)
    out.save(dst)
    print(f'{src} -> {dst} bg={bg} bbox={bbox} out={out.size}')

if __name__=='__main__':
    remove_bg(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv)>3 else 312)
