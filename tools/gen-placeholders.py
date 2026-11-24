#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""占位素材程序化生成器（可复跑）。

按 assets/PLACEHOLDER-MANIFEST.csv 声明的尺寸，用 Pillow 生成仍是「占位说明卡」的素材，
风格严格对齐 docs/art/ART-STYLE.md「晴空乐园」与现有正式素材（btn/tab/list_item/hex_bright）。

设计 token（与 ART-STYLE.md 2.1 同源）：
  云白卡 #EAF8FF / 天蓝描边 #5BB8E8 / 明黄 #FFD23F / 活力橙 #FF8C42
  深靛底 #182D53 / 海军蓝 #2B4A6F / 墨色字 #16304F

分批（按 --group 选择，默认 all）：
  ui      界面 38 张   九宫格底板/品质框/卡片/按钮态/开关/节点/条
  fx      特效 21 张   光晕/闪光/波纹/光柱/粒子（径向渐变+模糊）
  tile    地块 5 张    从 hex_bright 派生（暗格/可翻/空格/河流/边界）
  bg      背景 6 张    场景底/圆/面板/banner
  app     应用 3 张    图标/启动图/分享卡
  font    字体说明卡 2 张
  unit    兵种进阶 24 + 行走帧 3（从 40 张立绘派生）

用法： python3 tools/gen-placeholders.py [--group ui|fx|tile|bg|app|font|unit|all]
"""
import csv
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
MANIFEST = ASSETS / 'PLACEHOLDER-MANIFEST.csv'

# ---------------- 设计 token（ART-STYLE.md 2.1 晴空乐园）----------------
CLOUD = (234, 248, 255)      # #EAF8FF 云白卡
CLOUD_HI = (238, 249, 255)   # 高光
SKY = (91, 184, 232)        # #5BB8E8 天蓝
SKY_DK = (62, 159, 209)     # #3E9FD1
YELLOW = (255, 210, 63)     # #FFD23F 明黄
YELLOW_HI = (255, 218, 98)
ORANGE = (255, 140, 66)     # #FF8C42 活力橙
ORANGE_DK = (217, 107, 36)
NAVY = (43, 74, 111)        # #2B4A6F
INK = (22, 48, 79)          # #16304F
DEEP = (24, 45, 83)         # #182D53 深靛
SLATE = (110, 130, 150)     # 石砖灰蓝

QUALITY = {
    'q1': (176, 184, 192), 'q2': (80, 180, 120), 'q3': (80, 150, 230),
    'q4': (170, 100, 230), 'q5': (255, 190, 60), 'q6': (255, 110, 90),
}

ROWS = list(csv.DictReader(open(MANIFEST, encoding='utf-8-sig')))
SIZE = {}
for r in ROWS:
    p = r['目标路径（相对 assets/）'].strip()
    w, h = r['尺寸（@3x 出图）'].replace('×', 'x').split('x')
    SIZE[p] = (int(w), int(h))


def size_of(path):
    return SIZE.get(path, (256, 256))


def load_manifest(path):
    """从 CSV 读尺寸，缺省 256。"""
    return SIZE.get(path, (256, 256))


def save(img, rel):
    """统一保存：9宫格转 P 保持小体积，其余按扩展名。"""
    out = ASSETS / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix.lower() == '.jpg':
        img.convert('RGB').save(out, 'JPEG', quality=88, optimize=True)
    elif rel.endswith('.9.png') or img.mode == 'P':
        img.convert('RGBA').save(out, 'PNG', optimize=True)
    else:
        img.convert('RGBA').save(out, 'PNG', optimize=True)


def font(sz):
    for fp in ['C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/msyh.ttc',
               '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        try:
            return ImageFont.truetype(fp, sz)
        except Exception:
            continue
    return ImageFont.load_default()


def rr(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def vgrad(w, h, top, bottom):
    im = Image.new('RGBA', (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(4))
        d.line([(0, y), (w, y)], fill=c)
    return im


def nine_marks(im, slice_px, color=(0, 0, 0, 40)):
    """画九宫格切线标记（与现有正式图一致的细线）。"""
    d = ImageDraw.Draw(im)
    w, h = im.size
    s = min(slice_px, w // 2, h // 2)
    for x in (s, w - s):
        d.line([(x, 0), (x, h * 0.12)], fill=color, width=1)
        d.line([(x, h * 0.88), (x, h)], fill=color, width=1)
    for y in (s, h - s):
        d.line([(0, y), (w * 0.10, y)], fill=color, width=1)
        d.line([(w * 0.90, y), (w, y)], fill=color, width=1)
    return im


def panel_card(w, h, base=CLOUD, border=SKY, radius=None, slice_px=None, marks=True):
    """云白卡 / 面板：圆角矩形 + 天蓝描边 + 顶部高光。"""
    radius = radius or min(w, h) // 8
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rr(d, (2, 2, w - 3, h - 3), radius, fill=base, outline=border, width=max(2, w // 90))
    # 顶部高光带
    hi = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    rr(hd, (6, 6, w - 7, h // 2), max(1, radius - 3), fill=CLOUD_HI)
    im = Image.alpha_composite(im, hi)
    if marks and slice_px:
        nine_marks(im, slice_px)
    return im


def btn(w, h, state='normal', slice_px=None):
    """黄橙按钮：与 btn_normal 同源。"""
    top, bot, edge = {
        'normal': (YELLOW_HI, YELLOW, ORANGE),
        'hover': ((255, 224, 122), (255, 224, 122), YELLOW),
        'pressed': (ORANGE, (230, 140, 70), ORANGE_DK),
    }[state]
    im = vgrad(w, h, (*top, 255), (*bot, 255))
    d = ImageDraw.Draw(im)
    rr(d, (2, 2, w - 3, h - 3), min(w, h) // 5, fill=None, outline=(*edge, 255), width=max(3, w // 70))
    # 顶部胶囊高光
    m = min(w, h) // 5
    rr(d, (m, 6, w - m, h // 2), max(2, m // 2), fill=(255, 255, 255, 55))
    if slice_px:
        nine_marks(im, slice_px)
    return im


# ============================ 界面 ============================
def gen_ui():
    made = []
    # 品质框 q1~q6（156×255，slice 24）
    for q, col in QUALITY.items():
        p = f'ui/quality_{q}.9.png'
        w, h = size_of(p)
        im = panel_card(w, h, base=(*col, 40), border=(*col, 255), radius=18, slice_px=24)
        d = ImageDraw.Draw(im)
        rr(d, (8, 8, w - 9, h - 9), 14, outline=(*col, 180), width=2)
        save(im, p); made.append(p)

    # 通用面板/卡片/空卡
    for p, base, border in [
        ('ui/panel.9.png', (24, 45, 83, 235), (91, 184, 232, 255)),
        ('ui/card.9.png', CLOUD, SKY),
        ('ui/card_empty.9.png', (234, 248, 255, 150), (147, 209, 240, 200)),
    ]:
        w, h = size_of(p)
        sl = 144 if 'panel' in p else 27
        save(panel_card(w, h, base=base, border=border, slice_px=sl), p); made.append(p)

    # 进度条填充（覆盖旧的带调试文字版）
    p = 'ui/bar_fill.9.png'
    w, h = size_of(p)
    im = vgrad(w, h, (55, 120, 230, 255), (43, 100, 200, 255))
    d = ImageDraw.Draw(im)
    rr(d, (1, 1, w - 2, h - 2), h // 2, outline=(*SKY, 200), width=2)
    nine_marks(im, 20)
    save(im, p); made.append(p)

    # 进度条底槽
    p = 'ui/bar_track.9.png'
    w, h = size_of(p)
    im = vgrad(w, h, (20, 38, 70, 255), (30, 55, 95, 255))
    d = ImageDraw.Draw(im)
    rr(d, (1, 1, w - 2, h - 2), h // 2, outline=(91, 184, 232, 160), width=2)
    nine_marks(im, 20)
    save(im, p); made.append(p)

    # 返回按钮 2 态
    for p, st in [('ui/back_normal.png', 'normal'), ('ui/back_pressed.png', 'pressed')]:
        w, h = size_of(p)
        save(btn(w, h, st, slice_px=None), p); made.append(p)

    # 开关 2 态
    for p, on in [('ui/switch_off.png', False), ('ui/switch_on.png', True)]:
        w, h = size_of(p)
        im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        track = SKY if on else (150, 165, 180)
        rr(d, (2, h // 4, w - 3, 3 * h // 4), h // 4, fill=(*track, 255), outline=(*NAVY, 180), width=2)
        knob_x = w - h // 2 - 6 if on else h // 2 + 6
        d.ellipse((knob_x - h // 3, h // 2 - h // 3, knob_x + h // 3, h // 2 + h // 3),
                  fill=(255, 255, 255, 255), outline=(*NAVY, 200), width=2)
        save(im, p); made.append(p)

    # 商店卡 2
    for p, free in [('ui/shop_card_normal.9.png', False), ('ui/shop_card_free.9.png', True)]:
        w, h = size_of(p)
        im = panel_card(w, h, base=CLOUD if not free else (232, 255, 240, 255),
                        border=SKY if not free else (80, 180, 120), radius=24, slice_px=36)
        save(im, p); made.append(p)

    # 科技节点 3 + 连线
    for p, col in [
        ('ui/tech_node_locked.9.png', (120, 130, 145)),
        ('ui/tech_node_upgradeable.9.png', YELLOW),
        ('ui/tech_node_max.9.png', SKY),
    ]:
        w, h = size_of(p)
        im = panel_card(w, h, base=(*col, 45), border=(*col, 255), radius=20, slice_px=24)
        save(im, p); made.append(p)
    p = 'ui/tech_line.png'
    w, h = size_of(p)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(im).line([(4, h // 2), (w - 4, h // 2)], fill=(*SKY, 200), width=3)
    save(im, p); made.append(p)

    # 通行证 4 格
    for p, col in [
        ('ui/bp_cell_locked.9.png', (110, 120, 135)),
        ('ui/bp_cell_claimable.9.png', YELLOW),
        ('ui/bp_cell_claimed.9.png', (100, 170, 120)),
        ('ui/bp_cell_premium.9.png', (170, 110, 230)),
    ]:
        w, h = size_of(p)
        save(panel_card(w, h, base=(*col, 40), border=(*col, 255), radius=16, slice_px=24), p)
        made.append(p)

    # 教程卡 + dots
    p = 'ui/tutorial_card.9.png'
    w, h = size_of(p)
    save(panel_card(w, h, base=(24, 45, 83, 230), border=SKY, radius=28, slice_px=30), p); made.append(p)
    p = 'ui/tutorial_dots.png'
    w, h = size_of(p)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for i in range(5):
        x = w // 2 + (i - 2) * 34
        col = YELLOW if i == 2 else (255, 255, 255, 130)
        d.ellipse((x - 6, h // 2 - 6, x + 6, h // 2 + 6), fill=col)
    save(im, p); made.append(p)

    # 槽位 2
    for p, hl in [('ui/slot_empty.9.png', False), ('ui/slot_drag.png', True)]:
        w, h = size_of(p)
        save(panel_card(w, h, base=(*SKY, 30) if hl else (234, 248, 255, 110),
                        border=YELLOW if hl else SKY, radius=18, slice_px=24), p)
        made.append(p)

    # 详情底板 2
    for p in ['ui/unit_detail.9.png', 'ui/building_detail.9.png']:
        w, h = size_of(p)
        save(panel_card(w, h, base=(24, 45, 83, 235), border=SKY, radius=30, slice_px=40), p)
        made.append(p)

    # 结算 3
    for p, col in [('ui/result_star.9.png', YELLOW),
                   ('ui/result_promote.9.png', ORANGE),
                   ('ui/result_summary.9.png', CLOUD)]:
        w, h = size_of(p)
        save(panel_card(w, h, base=(*col, 60) if col != CLOUD else CLOUD,
                        border=col if col != CLOUD else SKY, radius=20, slice_px=24), p)
        made.append(p)

    # 抽卡 3 条
    for p in ['ui/gacha_rate.9.png', 'ui/gacha_pity.9.png', 'ui/gacha_collection.9.png']:
        w, h = size_of(p)
        im = vgrad(w, h, (24, 45, 83, 220), (43, 74, 111, 220))
        nine_marks(im, 20)
        save(im, p); made.append(p)

    # 加载提示
    p = 'ui/loading_tip.9.png'
    w, h = size_of(p)
    save(panel_card(w, h, base=(24, 45, 83, 200), border=SKY, radius=22, slice_px=26), p); made.append(p)

    return made


# ============================ 特效 ============================
def glow(w, h, color, inner=0.0, blur=18):
    """径向渐变光晕。"""
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = w / 2, h / 2
    steps = 28
    for i in range(steps, 0, -1):
        t = i / steps
        rad = max(1, int(min(cx, cy) * t))
        a = int(180 * (1 - t) ** 1.6 + 12)
        c = (*color, a)
        d.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=c)
    return im.filter(ImageFilter.GaussianBlur(blur))


def gen_fx():
    made = []
    # 抽卡稀有度 3
    for q in ['q4', 'q5', 'q6']:
        p = f'effects/gacha_epic_{q}.png'
        w, h = size_of(p)
        save(glow(w, h, QUALITY[q], blur=26), p); made.append(p)
    # 品质光晕 5
    for q in ['q1', 'q3', 'q4', 'q5', 'q6']:
        p = f'effects/quality_glow_{q}.png'
        w, h = size_of(p)
        save(glow(w, h, QUALITY[q], blur=14), p); made.append(p)
    # 烟花
    p = 'effects/firework.png'; w, h = size_of(p)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    rng = random.Random(7)
    for _ in range(36):
        ang = rng.uniform(0, 2 * math.pi); r = rng.uniform(30, min(w, h) // 2 - 10)
        x, y = w / 2 + math.cos(ang) * r, h / 2 + math.sin(ang) * r
        col = rng.choice([YELLOW, ORANGE, SKY, (255, 255, 255)])
        d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(*col, 230))
    save(im.filter(ImageFilter.GaussianBlur(2)), p); made.append(p)
    # 失败闪白/碎片
    p = 'effects/defeat_flash.png'; w, h = size_of(p)
    save(glow(w, h, (200, 210, 225), blur=30), p); made.append(p)
    p = 'effects/defeat_debris.png'; w, h = size_of(p)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    rng = random.Random(11)
    for _ in range(14):
        x, y = rng.randint(20, w - 20), rng.randint(20, h - 20)
        s = rng.randint(6, 18)
        d.polygon([(x, y - s), (x + s, y), (x, y + s), (x - s, y)], fill=(110, 120, 140, 180))
    save(im, p); made.append(p)
    # 战斗 4
    for p, col, sc in [
        ('effects/combat_hit.png', (255, 255, 255), 1.0),
        ('effects/combat_crit.png', ORANGE, 1.0),
        ('effects/combat_flash.png', (255, 245, 200), 1.0),
        ('effects/combat_knockback.png', SKY, 1.0),
    ]:
        w, h = size_of(p)
        im = glow(w, h, col, blur=8)
        if 'hit' in p or 'crit' in p:
            d = ImageDraw.Draw(im)
            # 星芒
            cx, cy = w / 2, h / 2
            for k in range(4):
                a = k * math.pi / 2 + math.pi / 4
                ex, ey = cx + math.cos(a) * w * 0.42, cy + math.sin(a) * h * 0.42
                d.line([(cx, cy), (ex, ey)], fill=(*col, 220), width=5)
        save(im, p); made.append(p)
    # 领地波纹
    p = 'effects/territory_wave.png'; w, h = size_of(p)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for r in range(20, min(w, h) // 2, 26):
        d.ellipse((w / 2 - r, h / 2 - r, w / 2 + r, h / 2 + r), outline=(*SKY, 170), width=4)
    save(im.filter(ImageFilter.GaussianBlur(2)), p); made.append(p)
    # 建筑光柱
    p = 'effects/build_beam.png'; w, h = size_of(p)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for i in range(0, h, 4):
        a = int(120 * (1 - i / h))
        d.rectangle((w // 2 - 12, i, w // 2 + 12, i + 4), fill=(*YELLOW, a))
    save(im.filter(ImageFilter.GaussianBlur(8)), p); made.append(p)
    # 引导圈
    p = 'effects/tutorial_halo.png'; w, h = size_of(p)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse((w * .12, h * .12, w * .88, h * .88), outline=(*YELLOW, 230), width=10)
    save(im.filter(ImageFilter.GaussianBlur(2)), p); made.append(p)
    # 段位流光
    p = 'effects/rank_shine.png'; w, h = size_of(p)
    save(glow(w, h, YELLOW, blur=16), p); made.append(p)
    # 环境粒子
    p = 'effects/ambient.png'; w, h = size_of(p)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    rng = random.Random(3)
    for _ in range(18):
        x, y = rng.randint(5, w - 5), rng.randint(5, h - 5); s = rng.randint(1, 3)
        d.ellipse((x - s, y - s, x + s, y + s), fill=(255, 255, 255, rng.randint(60, 150)))
    save(im.filter(ImageFilter.GaussianBlur(1)), p); made.append(p)
    # 成就盖章（effects/achieve_stamp.png）已于 2026-11-24 清理：零引用，无 draw 调用
    return made


# ============================ 地块 ============================
def hex_mask(w, h, pad=10):
    m = Image.new('L', (w, h), 0); d = ImageDraw.Draw(m)
    d.regular_polygon((w / 2, h / 2, min(w, h) / 2 - pad), 6, rotation=0, fill=255)
    return m


def gen_tile():
    made = []
    src = ASSETS / 'tiles/hex_bright.png'
    base = Image.open(src).convert('RGBA') if src.exists() else Image.new('RGBA', (312, 312), (*SLATE, 255))
    for p, mode in [
        ('tiles/hex_dark.png', 'dark'),
        ('tiles/hex_flippable.png', 'flip'),
        ('tiles/hex_empty.png', 'empty'),
        ('tiles/river.png', 'river'),
        ('tiles/territory_edge.png', 'edge'),
    ]:
        w, h = size_of(p)
        im = base.resize((w, h), Image.LANCZOS).copy()
        if mode == 'dark':
            im = Image.blend(im, Image.new('RGBA', (w, h), (18, 30, 50, 255)), 0.55)
        elif mode == 'flip':
            im = Image.blend(im, Image.new('RGBA', (w, h), (*SKY, 255)), 0.30)
        elif mode == 'empty':
            im = Image.blend(im, Image.new('RGBA', (w, h), (230, 238, 245, 255)), 0.72)
        elif mode == 'river':
            im = Image.blend(im, Image.new('RGBA', (w, h), (*SKY_DK, 255)), 0.55)
        elif mode == 'edge':
            im = Image.blend(im, Image.new('RGBA', (w, h), (*ORANGE, 255)), 0.35)
        save(im, p); made.append(p)
    return made


# ============================ 背景 ============================
def gen_bg():
    made = []
    for p in ['bg/gacha_bg.jpg', 'bg/subpage_bg.jpg', 'bg/bp_banner.jpg']:
        w, h = size_of(p)
        im = vgrad(w, h, (18, 32, 58, 255), (40, 70, 110, 255))
        d = ImageDraw.Draw(im)
        rng = random.Random(13)
        for _ in range(28):
            x, y = rng.randint(0, w), rng.randint(0, h); r = rng.randint(90, 260)
            d.ellipse((x - r, y - r, x + r, y + r), fill=(*SKY, rng.randint(6, 18)))
        im = im.filter(ImageFilter.GaussianBlur(40))
        save(im, p); made.append(p)
    # 圆 / 面板 / panel_bg.9
    p = 'bg/gacha_circle.png'; w, h = size_of(p)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    r = min(w, h) * 0.34
    d.ellipse((w / 2 - r, h / 2 - r, w / 2 + r, h / 2 + r), outline=(*YELLOW, 180), width=14)
    save(im, p); made.append(p)
    for p in ['bg/match_panel.png', 'bg/panel_bg.9.png']:
        w, h = size_of(p)
        im = panel_card(w, h, base=(24, 45, 83, 225), border=SKY, radius=60, slice_px=240)
        save(im, p); made.append(p)
    return made


# ============================ 应用 ============================
def gen_app():
    made = []
    # 注意：应用类 manifest 路径列写的是 assets/icon_432.png（相对 assets/），
    # 落盘即 assets/assets/icon_432.png，不是 app/ 子目录。
    p = 'assets/icon_432.png'; w, h = size_of(p)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    rr(d, (10, 10, w - 10, h - 10), w // 5, fill=(*DEEP, 255), outline=(*YELLOW, 255), width=10)
    d.ellipse((w * .28, h * .26, w * .72, h * .7), fill=(*YELLOW, 255))
    d.polygon([(w * .38, h * .48), (w * .62, h * .48), (w * .5, h * .30)], fill=(*ORANGE, 255))
    save(im, p); made.append(p)
    for p in ['assets/splash.png', 'assets/share_card.png']:
        w, h = size_of(p)
        im = vgrad(w, h, (18, 32, 58, 255), (43, 74, 111, 255))
        d = ImageDraw.Draw(im)
        d.text((w * .14, h * .42), '占 地 之 王', font=font(max(28, w // 12)), fill=(*YELLOW, 255))
        d.text((w * .22, h * .52), 'King of the Occupiers', font=font(max(14, w // 34)), fill=(*CLOUD, 230))
        save(im, p); made.append(p)
    return made


# 字体说明卡（fonts/*.ttf.png）已于 2026-11-24 清理：真实 .ttf 在主包，说明卡零引用


# ============================ 兵种进阶 / 行走 ============================
# 种族进阶 → 立绘编号映射（100% 复用现有正式立绘，只加阶差装饰）
RACE_MAP = {
    'human':  [5, 1, 9, 26],     # 民兵/剑士/骑士/圣骑士
    'beast':  [10, 12, 24, 39],  # 狂战士/战士/驯兽师/战争泰坦
    'undead': [11, 32, 31, 34],  # 骷髅兵/吸血鬼/死灵法师/死亡骑士
    'elf':    [2, 18, 20, 22],   # 弓箭手/游侠/神射手/圣堂武士
    'dwarf':  [8, 15, 6, 30],    # 盾兵/卫兵/投石兵/十字军
    'dragon': [38, 37, 38, 40],  # 幼龙/凤凰/龙骑(复用幼龙)/古龙
}


def load_unit(i):
    p = ASSETS / f'units/unit_{i:02d}.png'
    return Image.open(p).convert('RGBA') if p.exists() else None


def gen_unit():
    made = []
    for race, ids in RACE_MAP.items():
        for lv, uid in enumerate(ids, 1):
            p = f'units/race_{race}_lv{lv}.png'
            w, h = size_of(p)          # 96×96
            src = load_unit(uid)
            im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
            if src:
                bbox = src.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
                if bbox:
                    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
                    half = max(bbox[2] - bbox[0], bbox[3] - bbox[1]) / 2 + 4
                    crop = src.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half)))
                    crop = crop.resize((w - 12, h - 12), Image.LANCZOS)
                    im.alpha_composite(crop, (6, 6))
            # 阶差装饰：右侧阶级角标（1~4 条金杠）
            d = ImageDraw.Draw(im)
            for k in range(lv):
                x = w - 9 - k * 6
                d.rectangle((x - 2, h - 14, x + 2, h - 5), fill=(*YELLOW, 255))
            save(im, p); made.append(p)
    # 行走帧 3（从剑士派生姿态）
    src = load_unit(1)
    for p, mode in [('units/unit_walk_start.png', 'start'),
                    ('units/unit_walk_loop.png', 'loop'),
                    ('units/unit_walk_attack.png', 'attack')]:
        w, h = size_of(p)  # 144×144
        im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        if src:
            r = src.resize((h - 20, h - 20), Image.LANCZOS)
            dx = {'start': -6, 'loop': 0, 'attack': 8}[mode]
            dy = {'start': 0, 'loop': 3, 'attack': -4}[mode]
            im.alpha_composite(r, ((w - r.width) // 2 + dx, 10 + dy))
        # 速度线
        if mode == 'attack':
            d = ImageDraw.Draw(im)
            for k in range(3):
                d.line((6 + k * 8, 40 + k * 26, 34 + k * 8, 40 + k * 26),
                       fill=(255, 255, 255, 150), width=3)
        save(im, p); made.append(p)
    return made


GROUPS = {
    'ui': gen_ui, 'fx': gen_fx, 'tile': gen_tile, 'bg': gen_bg,
    'app': gen_app, 'unit': gen_unit,
}


def main():
    args = sys.argv[1:]
    groups = [a for a in args if not a.startswith('--')] or ['all']
    selected = list(GROUPS) if 'all' in groups else groups
    total = 0
    for g in selected:
        if g not in GROUPS:
            print(f'未知分组: {g}'); continue
        made = GROUPS[g]()
        total += len(made)
        print(f'[{g}] 生成 {len(made)} 张')
    print(f'合计 {total} 张')


if __name__ == '__main__':
    main()
