#!/usr/bin/env python3
"""
程序化绘制「障碍砖块」正式图：以当前 hex_bright 石砖为几何/alpha 底，
只改 RGB —— 冷板岩灰去饱和 + 顶面刻入双峰山纹 + 少量裂纹。

- 几何 100% 继承 hex_bright（顶面 x35..277 / y8..206，侧面到 y291），
  绝不改 alpha / 轮廓 / 尺寸，保证 solidBoardPlacement 常量不动、严丝合缝。
- 不依赖 numpy，纯 Pillow。
用法： python3 tools/draw-obstacle-tile.py [input_hex_bright] [output_png]
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'assets/tiles/hex_bright.png'
DST = sys.argv[2] if len(sys.argv) > 2 else '.workbuddy/art-staging/hex_obstacle.png'

# 顶面六边形顶点（312 图内，来自 hex_bright 实测：顶(156,8)/左右角 35,277/前缘底尖 206）
TOP_HEX = [(156, 8), (277, 57), (277, 157), (156, 206), (35, 157), (35, 57)]


def clamp(v):
    return 0 if v < 0 else (255 if v > 255 else int(v))


def cold_gray(rgb):
    """冷板岩灰映射：保留原明暗纹理，R<G<B 制造冷色，侧面自然更暗。"""
    r, g, b = rgb[:3]
    L = 0.299 * r + 0.587 * g + 0.114 * b
    return (clamp(L * 0.78 - 2), clamp(L * 0.90 + 1), clamp(L * 1.05 + 6))


def shade(rgb, f):
    return (clamp(rgb[0] * f), clamp(rgb[1] * f), clamp(rgb[2] * f))


def main():
    src = Image.open(SRC).convert('RGBA')
    assert src.size == (312, 312), '锚点图必须 312×312'
    alpha = src.getchannel('A')  # 几何真相源，全程不改

    # 1) 冷灰化：逐像素映射 RGB，alpha 原样保留
    cold = Image.new('RGBA', src.size)
    cold.putdata([cold_gray(p) + (p[3],) for p in src.getdata()])

    # 顶面掩码：六边形内缩 3px，避免刻痕溢出到侧面/边缘
    top_mask = Image.new('L', src.size, 0)
    md = ImageDraw.Draw(top_mask)
    cx, cy = 156, 107
    inner = [(cx + (x - cx) * 0.93, cy + (y - cy) * 0.93) for x, y in TOP_HEX]
    md.polygon(inner, fill=255)
    top_mask = top_mask.filter(ImageFilter.GaussianBlur(1))

    # 2) 顶面刻入双峰山纹（不是贴上去的剪影，而是凿进石面的凹刻）
    #    形状与既有双峰剪影语义一致，只是改为「刻痕」表现。
    peaks = [
        (84, 150), (112, 72), (140, 118), (176, 62), (228, 150),
    ]  # 底左→左峰→谷→右峰→底右
    body = peaks + [(84, 150)]

    inc = Image.new('RGBA', src.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(inc)
    # 2a) 内阴影（右下偏移）：凿刻的凹陷暗面，比顶面暗一档
    d.polygon([(x + 3, y + 4) for x, y in body], fill=(44, 56, 72, 165))
    # 2b) 凹面主体：石面实色下压（不透明实心，像凿掉一层皮），比顶面暗但仍是石头色
    d.polygon(body, fill=(74, 89, 109, 215))
    # 2c) 上沿受光高光：细而克制的凿口亮边（只上沿，宽度 2），避免「画线」感
    upper = [(84, 150), (112, 72), (140, 118), (176, 62), (228, 150)]
    d.line(upper, fill=(150, 170, 195, 150), width=2, joint='curve')
    # 2d) 下沿暗边：凹面下缘补一条更暗的边，强化凹陷体积
    d.line([(84, 150), (228, 150)], fill=(38, 48, 62, 130), width=2)

    # 只把刻痕合成到顶面区域
    inc.putalpha(Image.composite(inc.getchannel('A'), Image.new('L', src.size, 0), top_mask))
    cold = Image.alpha_composite(cold, inc)

    # 3) 少量裂纹：几条低对比折线，从顶面边缘向内，强化「封死/不可通行」
    cracks = Image.new('RGBA', src.size, (0, 0, 0, 0))
    cd = ImageDraw.Draw(cracks)
    for pts in [
        [(60, 120), (96, 132), (120, 126)],
        [(232, 96), (206, 112), (188, 108)],
        [(150, 178), (162, 160), (158, 146)],
    ]:
        cd.line(pts, fill=(40, 52, 66, 90), width=2, joint='curve')
    cracks.putalpha(Image.composite(cracks.getchannel('A'), Image.new('L', src.size, 0), top_mask))
    cold = Image.alpha_composite(cold, cracks)

    # 4) alpha 原样写回，几何纹丝不动
    cold.putalpha(alpha)
    cold.save(DST)
    print('wrote', DST, cold.size, 'bbox=', cold.getchannel('A').getbbox())


if __name__ == '__main__':
    main()
