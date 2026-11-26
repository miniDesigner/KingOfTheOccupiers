#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展开兵营 V5 形态回退的完整 prompt（3 张）。

用户 2026-11-26 追加指令：
  25 法师   -> 改回旧版顶部法师帽表现
  31 死灵法师 -> 改回旧版墓地建筑（墓碑+铁栅栏+哥特尖顶）
  33 蒸汽坦克 -> 改回旧版工厂样式（黄铜锅炉机械，非房屋）

原则：形态回退到 pre-v4，画风保留 V4 的圆润厚涂 / 去黑线稿 / 提亮暗部 / 冷色点缀。
风格锚点从 V2 方案文档逐字抽取。
用法: python3 tools/expand-barracks-v5-prompts.py
输出: .workbuddy/art-staging/western-redraw-v5/prompts.json
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

STYLE_UNIFY = (
    " CRITICAL STYLE MATCH — this must look like the SAME asset family as the rest of the barracks: "
    "painterly thick-rounded brushwork, plump soft forms, smooth color transitions, chunky simplified shapes, "
    "clean glossy candy-like highlights. NO black ink outlines, NO line art, NO sketch lines, NO flat cel shading, "
    "NO black contour strokes around shapes, NO fine detailed linework. "
    "Lift all dark shadow areas so the building reads clearly and never becomes a black mass; "
    "shadows must be colored (indigo, teal or warm brown), NEVER pure black. "
    "Add a few cool accent details (sky blue, teal or turquoise banners, gemstones, roof trim or magical glow) "
    "to balance the otherwise warm gold palette. Keep it soft, round, bright and cartoon-like."
)

BUILD_FRAME = (
    "Square 1:1 canvas, building centered slightly low, full building including the elliptical stone base "
    "fills about 82 percent of canvas width, 8 to 10 percent clean margin on all sides, no cropping, no "
    "perspective drift, flat even framing. The single signature object stays fully inside the frame and "
    "is never hidden by flags, banners or roof decorations."
)

NEG_EXTRA = (
    "black outlines, line art, ink sketch, black contour, harsh dark edges, cel shading, flat shading, "
    "pure black shadows, muddy dark mass, grayscale, monochrome, realistic texture, fine linework"
)

# name, BUILDING, MAT, ACC, SIG, PROP, SIGPCT, SIGW, EXTRA
DATA = {
    "25": (
        "法师-法师帽奥术塔(形态回退)",
        "a squat whimsical mage tower with warm cream plaster walls, a round window and a small arched door, "
        "crowned by a GIANT POINTED WIZARD HAT with a wide floppy brim and a softly bent tip, an open spellbook "
        "resting on the hat brim and magical sparkles streaming from the hat tip",
        "cream plaster, warm orange trim, purple felt and paper",
        "magenta pink and sky blue magic glow",
        "the giant pointed purple wizard hat with a wide brim sitting on top of the tower",
        "an open spellbook, floating rune sparkles and small stars", 40, 32,
        " The top of the tower MUST be a clearly recognizable wizard hat (wide brim + tall pointed cone), "
        "NOT a crystal, NOT a gemstone, NOT a spire. Keep the friendly cartoon sag in the hat tip."),
    "31": (
        "死灵法师-墓地建筑(形态回退)",
        "a gothic necromancer GRAVEYARD landmark: a cluster of small pointed stone chapels and arches surrounded "
        "by a dense field of crooked tombstones and grave markers, an ornate iron fence around the cemetery, "
        "a skull carved into the central arch and a green magical flame glowing above the tallest spire",
        "pale cream stone, pale lavender stone and black iron fence",
        "pale lavender and emerald green glow",
        "the dense graveyard of crooked tombstones with the iron fence and a green-flame spire above it",
        "skull carvings, iron fence posts, ghostly wisps and pointed arches", 30, 34,
        " This must read as a CEMETERY / GRAVEYARD: many visible tombstones and an iron fence are required. "
        "Walls must stay LIGHT cream or pale lavender and readable, never a dark mass; the iron fence may be "
        "dark but thin and delicate."),
    "33": (
        "蒸汽坦克-黄铜锅炉工厂(形态回退)",
        "a whimsical steam-powered machine shaped like a huge horizontal brass boiler drum on a tracked chassis, "
        "a big round front hatch with a glowing blue gauge, riveted brass plates, exposed gears and pipes, "
        "a small chimney puffing soft white steam, standing on an elliptical stone display base",
        "polished brass, gold metal, iron and timber",
        "gold and sky blue gauge glow",
        "the big horizontal riveted brass boiler drum with a glowing blue round gauge",
        "steam puffs, exposed gears, pipes and track wheels", 42, 34,
        " This is a MACHINE / FACTORY ENGINE, NOT a house: NO cottage walls, NO pitched house roof, NO windows "
        "and NO front door. The main body is a horizontal cylindrical boiler with rivets and mechanical parts."),
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
        prompt = (SEG1 + "\n\n" + body + extra + STYLE_UNIFY + "\n\n" + BUILD_FRAME +
                  "\n\n" + SEG4 + "\n\nNegative prompt: " + neg)
        out[n] = {"name": name, "prompt": prompt}

    dst = ROOT / ".workbuddy/art-staging/western-redraw-v5/prompts.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(out)} prompts -> {dst}")
    for n, v in out.items():
        print(n, v["name"], len(v["prompt"]))


if __name__ == "__main__":
    main()
