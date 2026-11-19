#!/usr/bin/env python3
"""纯色(白)背景图标去背 + 缩放后处理。

ImageGen 的 background=transparent 对当前模型不生效，输出为 RGB 白底。
本脚本把近白背景转为平滑 alpha，保留主体边缘抗锯齿，并按清单尺寸 LANCZOS 缩放。

用法:
  python3 tools/remove-white-bg.py <输入图> <输出图> <目标边长> [--threshold N]

参数:
  threshold  白度阈值(0~255)，低于此值视为完全不透明。默认 250。
             值越大去背越激进(边缘更细)，越小保留越多浅色高光。
"""
import sys
from PIL import Image


def remove_white_bg(img, threshold=250):
    """把白底转 alpha。返回 RGBA。
    思路：每个像素的"白度"= min(r,g,b)。主体色饱和度高=>白度低=>alpha=255；
    背景纯白=>白度高=>alpha=0。中间带做线性过渡保边缘平滑。
    """
    img = img.convert('RGB')
    src = img.load()
    w, h = img.size
    out = Image.new('RGBA', (w, h))
    dst = out.load()

    soft_lo = threshold - 45  # 白度低于此 => 完全不透明
    soft_hi = threshold       # 白度高于此 => 完全透明

    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            whiteness = min(r, g, b)
            if whiteness <= soft_lo:
                a = 255
            elif whiteness >= soft_hi:
                a = 0
            else:
                a = int(255 * (soft_hi - whiteness) / (soft_hi - soft_lo))

            if a == 0:
                dst[x, y] = (0, 0, 0, 0)
            elif a == 255:
                dst[x, y] = (r, g, b, 255)
            else:
                # 反解半透明像素的前景色，避免边缘残留白晕：
                # observed = fg*a/255 + 255*(1-a/255)  => fg = (observed-255*(1-a/255))/(a/255)
                f = a / 255.0
                fg = tuple(max(0, min(255, int((c - 255 * (1 - f)) / f))) for c in (r, g, b))
                dst[x, y] = (*fg, a)
    return out


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    in_path, out_path, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
    threshold = 250
    if '--threshold' in sys.argv:
        threshold = int(sys.argv[sys.argv.index('--threshold') + 1])

    img = Image.open(in_path)
    rgba = remove_white_bg(img, threshold)
    if size > 0:
        rgba = rgba.resize((size, size), Image.LANCZOS)

    # 用内容包围盒自动裁掉多余透明边(保留少量 padding)
    bbox = rgba.getbbox()
    if bbox:
        pad = max(2, size // 40)
        l = max(0, bbox[0] - pad); t = max(0, bbox[1] - pad)
        rr = min(rgba.width, bbox[2] + pad); bb = min(rgba.height, bbox[3] + pad)
        rgba = rgba.crop((l, t, rr, bb))
        rgba = rgba.resize((size, size), Image.LANCZOS)

    rgba.save(out_path)
    a = rgba.getchannel('A')
    print(f"saved {out_path}  size={rgba.size}  alpha={a.getextrema()}")


if __name__ == '__main__':
    main()
