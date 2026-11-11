#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
补齐上一轮审查中「连素材实体都没有」的资源（可复跑）：

  1) assets/audio/sfx/*.mp3   17 个音效  ┐ 与 config/audio.json 的 url 一一对应
  2) assets/audio/bgm/battle.mp3  1 个 BGM ┘
  3) assets/fonts/title.ttf / number.ttf  2 个真实可加载字体（中文子集）

音频用 numpy 合成 PCM → ffmpeg/libmp3lame 压成低码率单声道 mp3（占位音，
后续同名替换为正式音源即可）。字体用 fontTools 从系统 CJK 字体按游戏实际
用到的字符做子集，并统一转成 TrueType(glyf) 轮廓，保证微信 wx.loadFont 可用。

用法：python3 tools/gen-missing-assets.py
"""
import io
import json
import math
import os
import re
import struct
import subprocess
import wave

import numpy as np

PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(PROJ, 'assets')
AUDIO = os.path.join(ASSETS, 'audio')
SFX_DIR = os.path.join(AUDIO, 'sfx')
BGM_DIR = os.path.join(AUDIO, 'bgm')
FONTS = os.path.join(ASSETS, 'fonts')
SR = 22050

os.makedirs(SFX_DIR, exist_ok=True)
os.makedirs(BGM_DIR, exist_ok=True)
os.makedirs(FONTS, exist_ok=True)


# ---------------------------------------------------------------- 音频合成
def env(n, attack=0.01, release=0.6):
    """线性 attack + 指数 release 包络，避免爆音"""
    a = max(1, int(SR * attack))
    e = np.ones(n, dtype=np.float32)
    e[:a] = np.linspace(0, 1, a)
    tail = np.exp(-np.linspace(0, 4.5, n)) * release + (1 - release)
    return e * tail


def tone(freq, dur, kind='sine', vol=0.5, attack=0.008, release=0.65, f2=None):
    n = int(SR * dur)
    t = np.linspace(0, dur, n, endpoint=False)
    f = np.linspace(freq, f2 or freq, n) if f2 else np.full(n, freq)
    ph = 2 * np.pi * np.cumsum(f) / SR
    if kind == 'sine':
        s = np.sin(ph)
    elif kind == 'square':
        s = np.sign(np.sin(ph)) * 0.6
    elif kind == 'tri':
        s = 2 / np.pi * np.arcsin(np.sin(ph))
    elif kind == 'noise':
        s = np.random.default_rng(int(freq)).standard_normal(n) * 0.35
    else:
        s = np.sin(ph) + 0.3 * np.sin(2 * ph)
    return (s * env(n, attack, release) * vol).astype(np.float32)


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n, dtype=np.float32)
    for p in parts:
        out[:len(p)] += p
    return out


def chord(freqs, dur, vol=0.32):
    return mix(*[tone(f, dur, 'sine', vol / len(freqs), release=0.85) for f in freqs])


def write_mp3(samples, path, bitrate='32k'):
    """PCM float32 → WAV(stdin) → ffmpeg → mp3"""
    pcm = np.clip(samples, -1, 1)
    pcm16 = (pcm * 32767).astype('<i2')
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm16.tobytes())
    r = subprocess.run(
        ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
         '-f', 'wav', '-i', 'pipe:0', '-codec:a', 'libmp3lame',
         '-b:a', bitrate, '-ar', str(SR), '-ac', '1', path],
        input=buf.getvalue(), capture_output=True)
    if r.returncode != 0:
        raise RuntimeError('ffmpeg 失败 %s: %s' % (path, r.stderr.decode()))
    return os.path.getsize(path)


# 17 个音效：按事件语义给出可辨识的占位音（频率/时长/波形不同）
SFX = {
    'flip':            lambda: tone(520, 0.09, 'tri', 0.55, f2=760),
    'random_reveal':   lambda: tone(600, 0.30, 'sine', 0.5, f2=1000),
    'build':           lambda: chord([392, 523, 659], 0.28, 0.55),
    'destroy':         lambda: tone(110, 0.34, 'noise', 0.6, f2=70),
    'march':           lambda: tone(190, 0.16, 'square', 0.4, f2=150),
    'combat_building': lambda: tone(240, 0.14, 'square', 0.45, f2=180),
    'combat_warrior':  lambda: tone(310, 0.14, 'tri', 0.45, f2=260),
    'tower_shoot':     lambda: tone(880, 0.10, 'sine', 0.5, f2=1200),
    'crit':            lambda: mix(tone(1000, 0.18, 'square', 0.5, f2=1500),
                                   tone(500, 0.18, 'sine', 0.3)),
    'heal':            lambda: tone(660, 0.30, 'sine', 0.45, f2=880),
    'revive':          lambda: tone(330, 0.42, 'sine', 0.5, f2=990),
    'synergy':         lambda: chord([523, 659, 784], 0.34, 0.55),
    'victory':         lambda: mix(chord([523, 659, 784], 0.55, 0.5),
                                   tone(1046, 0.35, 'sine', 0.28)),
    'defeat':          lambda: tone(440, 0.62, 'sine', 0.45, f2=180),
    'button_click':    lambda: tone(700, 0.055, 'tri', 0.5),
    'level_select':    lambda: tone(760, 0.09, 'sine', 0.45, f2=920),
    'coin':            lambda: mix(tone(1180, 0.09, 'sine', 0.45),
                                   tone(1560, 0.07, 'sine', 0.25)),
}


def make_bgm():
    """8 秒 C 大调缓慢琶音 + 低音 pad，首尾归零便于无缝循环"""
    dur, notes = 8.0, [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 392.0]
    n = int(SR * dur)
    seg = n // len(notes)
    out = np.zeros(n, dtype=np.float32)
    for i, f in enumerate(notes):
        seg_len = seg if i < len(notes) - 1 else n - seg * i
        t = np.linspace(0, seg_len / SR, seg_len, endpoint=False)
        bell = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) \
               * np.exp(-np.linspace(0, 3.2, seg_len)) * 0.16
        out[i * seg:i * seg + seg_len] += bell
    t = np.linspace(0, dur, n, endpoint=False)
    pad = (np.sin(2 * np.pi * 130.81 * t) + 0.5 * np.sin(2 * np.pi * 196 * t)) * 0.055
    out += pad
    fade = int(SR * 0.35)
    out[:fade] *= np.linspace(0, 1, fade)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out.astype(np.float32)


def gen_audio():
    # 严格按 config/audio.json 的 url 生成，避免路径漂移
    cfg = json.load(open(os.path.join(PROJ, 'config', 'audio.json'), encoding='utf-8'))
    urls = [cfg['bgm']['url']] + [v['url'] for v in cfg['sfx'].values()]
    made = []
    for name, fn in SFX.items():
        p = os.path.join(SFX_DIR, name + '.mp3')
        made.append((p, write_mp3(fn(), p)))
    bgm_path = os.path.join(BGM_DIR, 'battle.mp3')
    made.append((bgm_path, write_mp3(make_bgm(), bgm_path, '40k')))
    # 校验：配置里的每个 url 都真实存在
    missing = [u for u in urls if not os.path.isfile(os.path.join(PROJ, u))]
    return made, missing


# ---------------------------------------------------------------- 字体子集
def game_charset():
    """扫描源码与配置，收集游戏实际显示的字符（中文 + ASCII + 常用符号）"""
    chars = set(chr(c) for c in range(0x20, 0x7f))
    chars.update('·—…、。，！？：；「」『』（）【】《》％＋－×÷★☆✓⚡↑↓→←♥♦♠♣')
    roots = [os.path.join(PROJ, 'src'), os.path.join(PROJ, 'config')]
    files = [os.path.join(PROJ, 'game.js')]
    for root in roots:
        for dp, _dn, fns in os.walk(root):
            for fn in fns:
                if fn.endswith(('.js', '.json')):
                    files.append(os.path.join(dp, fn))
    for fp in files:
        try:
            txt = open(fp, encoding='utf-8').read()
        except Exception:
            continue
        for ch in txt:
            if '\u4e00' <= ch <= '\u9fff' or '\u3400' <= ch <= '\u4dbf':
                chars.add(ch)
    return ''.join(sorted(chars))


CJK_CANDIDATES = [
    ('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 2),
    ('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 0),
    ('/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc', 2),
    ('/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc', 0),
]
LATIN_FALLBACK = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def cff_to_glyf(font):
    """把 CFF(OTF) 轮廓转成 TrueType glyf 轮廓，保证 wx.loadFont 兼容 .ttf"""
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.ttLib import newTable

    if 'glyf' in font:
        return font
    glyphSet = font.getGlyphSet()
    order = font.getGlyphOrder()
    glyf = newTable('glyf')
    glyf.glyphOrder = list(order)
    glyf.glyphs = {}
    upem = font['head'].unitsPerEm
    for name in order:
        pen = TTGlyphPen(glyphSet)
        cu = Cu2QuPen(pen, max_err=upem * 0.001, reverse_direction=True)
        glyphSet[name].draw(cu)
        glyf.glyphs[name] = pen.glyph()
    font['glyf'] = glyf
    font['loca'] = newTable('loca')
    font['head'].indexToLocFormat = 0
    # CFF 源字体的 maxp 是 0.5 版（CFF 专用，只有 numGlyphs）。转成 glyf 后
    # 必须换成 1.0 版并补齐全部上限字段；fontTools 的 recalc() 会填 maxPoints
    # 等，但不会填 maxZones/maxStorage 等静态上限，故这里显式给全字段。
    maxp = newTable('maxp')
    maxp.tableVersion = 0x00010000
    maxp.numGlyphs = len(order)
    for k in ('maxPoints', 'maxContours', 'maxCompositePoints',
              'maxCompositeContours', 'maxTwilightPoints', 'maxStorage',
              'maxFunctionDefs', 'maxInstructionDefs', 'maxStackElements',
              'maxSizeOfInstructions', 'maxComponentElements'):
        setattr(maxp, k, 0)
    maxp.maxZones = 2          # TrueType 规范：1 或 2，必须存在
    maxp.maxComponentDepth = 0
    try:
        maxp.recalc(font)      # 能用则用（重算真实上限），不影响已补齐的静态字段
    except Exception:
        pass
    for k in ('maxZones', 'maxStorage', 'maxFunctionDefs', 'maxInstructionDefs',
              'maxStackElements', 'maxSizeOfInstructions', 'maxComponentDepth'):
        if not hasattr(maxp, k):
            setattr(maxp, k, 2 if k == 'maxZones' else 0)
    font['maxp'] = maxp
    for t in ('CFF ', 'CFF2', 'VORG'):
        if t in font:
            del font[t]
    font.sfntVersion = '\x00\x01\x00\x00'
    return font


def gen_fonts():
    from fontTools import subset
    from fontTools.ttLib import TTFont, TTCollection

    full_text = game_charset()
    # 数字字只需数字与度量符号，无需整套中文 → 体积可从 ~670KB 降到几十 KB
    number_text = '0123456789+-×÷.%/,:xXKMB ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    out = []
    specs = [
        ('title.ttf', CJK_CANDIDATES[2], full_text, 'KingTitle'),
        ('number.ttf', CJK_CANDIDATES[0], number_text, 'KingNumber'),
    ]
    for fname, (src, idx), text, family in specs:
        dst = os.path.join(FONTS, fname)
        font = None
        if os.path.isfile(src):
            try:
                coll = TTCollection(src, lazy=False)
                font = coll.fonts[min(idx, len(coll.fonts) - 1)]
            except Exception:
                try:
                    font = TTFont(src, fontNumber=idx)
                except Exception:
                    font = None
        if font is None and os.path.isfile(LATIN_FALLBACK):
            font = TTFont(LATIN_FALLBACK)
        if font is None:
            raise RuntimeError('找不到可用源字体')
        opt = subset.Options()
        opt.name_IDs = [1, 2, 4, 6]
        opt.name_legacy = True
        opt.notdef_outline = True
        opt.recalc_bounds = True
        opt.hinting = False                 # 去 hinting，显著减小 glyf 体积
        opt.drop_tables += ['DSIG', 'GPOS', 'GSUB', 'GDEF', 'BASE', 'JSTF']
        sub = subset.Subsetter(options=opt)
        sub.populate(text=text)
        sub.subset(font)
        font = cff_to_glyf(font)
        name = font['name']
        for rec in name.names:
            if rec.nameID in (1, 4, 6, 16):
                try:
                    rec.string = family.encode('utf-16-be') if rec.isUnicode() \
                        else family.encode('latin-1')
                except Exception:
                    pass
        font.save(dst)
        out.append((dst, os.path.getsize(dst)))
    return out, len(full_text)


if __name__ == '__main__':
    print('=== 生成缺失的音频实体 ===')
    made, missing = gen_audio()
    for p, sz in made:
        print('  %-46s %6d B' % (os.path.relpath(p, PROJ), sz))
    print('  小计 %d 个文件，%d KB' % (len(made), sum(s for _p, s in made) // 1024))
    print('  config/audio.json 中缺失的 url:', missing or '无')
    print('=== 生成缺失的字体实体 ===')
    fmade, nchar = gen_fonts()
    print('  游戏字符集: %d 个字符' % nchar)
    for p, sz in fmade:
        print('  %-46s %6d B' % (os.path.relpath(p, PROJ), sz))
    print('完成。')
