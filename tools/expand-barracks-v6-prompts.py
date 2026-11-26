#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展开兵营 V6 的完整 prompt（3 张）。

用户 2026-11-26 追加指令：
  31 死灵法师 -> 墓地还不够阴深（要更幽暗，但保留墓地形态）
  32 吸血鬼   -> 去除白色，改为红黑建筑
  33 蒸汽坦克 -> 改为一层式蒸汽朋克工厂表现

画风策略调整：V4/V5 的"提亮暗部"不再适用，改用
「饱和暗色 + 彩色轮廓光 + 发光点缀」，保证阴深但可读，
同时保留圆润厚涂 / 无黑线稿 / 卡通质感（不回到早期线稿淡彩脏黑）。
风格锚点从 V2 方案文档逐字抽取。
用法: python3 tools/expand-barracks-v6-prompts.py
输出: .workbuddy/art-staging/western-redraw-v6/prompts.json
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = (ROOT / "docs/art/ART-BARRACKS-V2-NONBUILDING-REDRAW.md").read_text(encoding="utf-8")


def block(after):
    i = DOC.index(after)
    return re.search(r"```\n(.*?)\n```", DOC[i:], re.S).group(1).strip()


SEG1 = block("### 段 1 ·")
SEG4 = block("### 段 4")
NEG_BASE = block("### Negative prompt（B/C/D 档")
NEG_AB = block("### Negative prompt · A/B 档")

# V6 画风锚：暗色角色专用——饱和暗色但可读，禁止纯黑糊与黑描边
STYLE_DARK = (
    " CRITICAL STYLE MATCH — this must look like the SAME asset family as the rest of the barracks: "
    "painterly thick-rounded brushwork, plump soft forms, smooth color transitions, chunky simplified shapes, "
    "clean glossy candy-like highlights. NO black ink outlines, NO line art, NO sketch lines, NO flat cel shading, "
    "NO black contour strokes around shapes, NO fine detailed linework. "
    "This is a deliberately DARK and moody building, but darkness must come from RICH SATURATED COLORS "
    "(deep violet, indigo, dark teal, crimson, oxblood, dark burgundy), NEVER flat pure black, NEVER a muddy "
    "black mass. Keep every structure readable through colored rim light, glowing accents and a clear value "
    "hierarchy: dark walls, mid-tone trims, BRIGHT magical or warm light sources. "
    "Add cool glowing details (emerald green, ghostly blue, crimson) as focal points. "
    "Keep it soft, round and cartoon-like even when dark."
)

BUILD_FRAME = (
    "Square 1:1 canvas, building centered slightly low, full building including the elliptical stone base "
    "fills about 82 percent of canvas width, 8 to 10 percent clean margin on all sides, no cropping, no "
    "perspective drift, flat even framing. The single signature object stays fully inside the frame and "
    "is never hidden by flags, banners or roof decorations."
)

NEG_EXTRA = (
    "black outlines, line art, ink sketch, black contour, harsh dark edges, cel shading, flat shading, "
    "pure black shadows, muddy dark mass, grayscale, monochrome, white walls, cream walls, "
    "realistic texture, fine linework"
)

# name, BUILDING, MAT, ACC, SIG, PROP, SIGPCT, SIGW, EXTRA
DATA = {
    "31": (
        "死灵法师-幽暗墓地(阴深化)",
        "a deeply shadowed gothic necromancer GRAVEYARD landmark: a cluster of crooked small pointed chapels "
        "and broken arches surrounded by a dense field of tilted tombstones and grave markers, ornate dark iron "
        "fence around the cemetery, a skull carved into the central arch, low ground fog curling between the "
        "graves, a green magical flame glowing above the tallest spire",
        "dark violet stone, moss-covered grey stone and black iron fence",
        "deep indigo and emerald green glow",
        "the dense field of tilted tombstones behind a dark iron fence with an emerald green flame spire above",
        "ghostly blue wisps, skull carvings, crooked crosses and ground fog", 30, 34,
        " The graveyard must feel GLOOMY and EERIE: dark violet and mossy grey stone, heavy indigo shadows, "
        "cold green and ghost-blue magical light. Walls may be dark but MUST stay saturated violet or indigo "
        "and readable — never pure black. Keep the many visible tombstones and the iron fence. "
        "NO white walls, NO cream stone, NO bright sunny stone."),
    "32": (
        "吸血鬼-红黑哥特城堡(去白改色)",
        "a gothic vampire castle with deep oxblood red and dark burgundy walls, black obsidian roofs and "
        "thin black iron spires, pointed arch windows glowing hot crimson from within, a small black bat "
        "perched on the tallest tower, jagged dark stone base",
        "oxblood red stone, black obsidian roof and black iron",
        "crimson red and dark violet",
        "the tallest black iron gothic spire with a small bat silhouetted against red window glow",
        "glowing crimson arched windows, black iron fences and rose-red ornaments", 35, 18,
        " ABSOLUTELY NO white, NO cream, NO pale rose walls — the castle must be RED AND BLACK: "
        "oxblood / burgundy walls with black roofs and black ironwork. Crimson glowing windows keep it readable. "
        "Colors stay rich and saturated, never a flat black mass."),
    "33": (
        "蒸汽坦克-一层式蒸汽朋克工厂",
        "a SINGLE-STOREY steampunk factory building: a wide low industrial workshop hall with a broad riveted "
        "red-copper and brass facade, a large rolling factory door, exposed gears and piping on the walls, "
        "a cluster of short chimneys puffing soft white steam, glowing blue pressure gauges and small arched "
        "industrial windows, standing on an elliptical stone display base",
        "red copper, polished brass, iron and timber",
        "copper red and sky blue gauge glow",
        "the wide riveted copper-and-brass factory facade with a huge rolling door and exposed gears",
        "steam puffs, pressure gauges, pipes and short smokestacks", 38, 34,
        " This must be a ONE-STOREY factory hall: wide, low and horizontally spread, clearly an industrial "
        "workshop building. NO second floor, NO upper tower, NO tall multi-storey structure, NO cottage roof, "
        "NO residential windows and NO ordinary house door. Keep it steampunk with gears, rivets, copper, "
        "brass, pipes, gauges and steam."),
}


def main():
    out = {}
    for n, (name, subj, mat, acc, sig, prop, pct, w, extra) in DATA.items():
        body = (
            "A {BUILDING} for a fantasy unit barracks. Constructed from {MAT}, with {ACC} as the dominant "
            "accent color, echoing the unit character art. One dominant oversized signature object dominates "
            "the scene: {SIG}. This single signature object must occupy at least {SIGPCT} percent of the building "
            "height and at least {SIGW} percent of the canvas width; it must read clearly when scaled down to "
            "10 percent. All other details, including {PROP}, are secondary and quieter. The architecture must "
            "clearly express this unit role and be unmistakably Western fantasy medieval, not Eastern."
        ).format(BUILDING=subj, MAT=mat, ACC=acc, SIG=sig, PROP=prop, SIGPCT=pct, SIGW=w)
        neg = NEG_BASE + ", " + NEG_AB + ", " + NEG_EXTRA
        prompt = (SEG1 + "\n\n" + body + extra + STYLE_DARK + "\n\n" + BUILD_FRAME +
                  "\n\n" + SEG4 + "\n\nNegative prompt: " + neg)
        out[n] = {"name": name, "prompt": prompt}

    dst = ROOT / ".workbuddy/art-staging/western-redraw-v6/prompts.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(out)} prompts -> {dst}")
    for n, v in out.items():
        print(n, v["name"], len(v["prompt"]))


if __name__ == "__main__":
    main()
