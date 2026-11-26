#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展开兵营 V4 迭代的完整 prompt（10 张）。

- 02/10/40：形态修正（塔楼降级 / 维京长屋 / 去龙骨洞窟）
- 07/14/25/29/31/32/33：形态不变，只统一画风（去线稿淡彩→圆润厚涂、提亮暗部、冷色点缀）

风格锚点从 V2 方案文档逐字抽取，避免手抄漂移。
用法: python3 tools/expand-barracks-v4-prompts.py
输出: .workbuddy/art-staging/western-redraw-v4/prompts.json
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
SEG1A = block("### 段 1A")
SEG4 = block("### 段 4")
NEG_BASE = block("### Negative prompt（B/C/D 档")
NEG_AB = block("### Negative prompt · A/B 档")

# 所有图共享的画风锚：去线稿 + 圆润厚涂 + 提亮暗部 + 冷色点缀
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

SCENE_FRAME = (
    "Square 1:1 canvas, the whole scene centered slightly low, full scene including the elliptical stone "
    "base fills about 82 percent of canvas width, 8 to 10 percent clean margin on all sides, no cropping, "
    "no perspective drift, flat even framing."
)
BUILD_FRAME = (
    "Square 1:1 canvas, building centered slightly low, full building including the elliptical stone base "
    "fills about 82 percent of canvas width, 8 to 10 percent clean margin on all sides, no cropping, no "
    "perspective drift, flat even framing."
)

NEG_EXTRA = (
    "black outlines, line art, ink sketch, black contour, harsh dark edges, cel shading, flat shading, "
    "pure black shadows, muddy dark mass, grayscale, monochrome, realistic texture, fine linework"
)

# kind, name, BUILDING/SCENE, MAT, ACC, SIG, PROP, SIGPCT, SIGW, SUBJ, EXTRA
DATA = {
    # --- 形态修正 3 张 ---
    "02": ("build", "弓箭手-箭术训练场(降级对标剑士枪兵)",
           "a modest Western fantasy archery training range, a low open timber shooting shelter with straw butt targets along a wooden fence and a small archery platform; deliberately simple and rustic like a training yard, NOT a grand stone castle tower, NOT high walls, NOT a tall spire",
           "honey timber, straw and rope", "deep red and sky blue",
           "a medium ornate red recurve bow mounted on the timber shelter as a simple emblem",
           "straw targets, quivers and arrow racks", 25, 15, "building",
           " The building must be simple and low-status, matching a plain swordsman training yard or spearman camp. NO tall stone tower, NO fortress, NO stained glass, NO flying buttresses."),
    "10": ("build", "狂战士-维京长屋(修正形象)",
           "a proper Norse Viking longhouse: a LONG low building with a curved boat-hull upside-down roof, carved dragon-head ornaments at both roof ends, dark rough timber plank walls, a row of round shields lining the front wall, animal-hide banners and a stone base",
           "dark timber, grass turf and rough stone", "dark red and teal",
           "a giant double-bladed battleaxe planted upright before the longhouse entrance",
           "round shields, rune posts and animal skins", 35, 20, "building",
           " The roof ends must curve like a Viking ship prow and stern, rounded and blunt — absolutely NO sharp upturned Eastern eaves, NO pagoda corners, NO Chinese roof tips."),
    "40": ("scene", "古龙-纯岩洞窟入口(去骨)",
           "a dark dragon lair CAVERN ENTRANCE in natural black and indigo rock, the cave mouth itself is the landmark, framed only by jagged natural rock formations, with scattered gold coins at the entrance",
           "natural dark rock, crystals and treasure", "bronze gold and cool teal",
           "the large arched cavern mouth with a warm gold glow inside and cool teal crystal glints on the rocks",
           "scattered coins and gold nuggets at the entrance", 40, 20, "scene",
           " ABSOLUTELY NO bones, NO skull, NO skeleton, NO rib bones, NO dragon bones anywhere. This is a LIVING dragon lair, the dragon is not dead. Dragon presence is hinted only by claw marks on the rock and glittering treasure."),

    # --- 画风统一 7 张（形态不变）---
    "07": ("build", "学徒-魔法书屋(画风统一)",
           "a whimsical apprentice mage hut whose roof is shaped like a giant OPEN BOOK with cream pages, a small arched wooden door, a crescent-moon emblem on the facade, honey-brown timber and cream plaster walls, standing on an elliptical stone base",
           "honey timber, cream plaster and paper", "gold and sky blue",
           "the giant open-book roof with golden pages",
           "a small wand rack and floating rune papers", 40, 30, "building", ""),
    "14": ("build", "牧师-白金小教堂(画风统一)",
           "a small white and cream chapel with a single slender bell spire topped by a golden cross, arched windows with pale blue stained glass, a rounded wooden door, warm cream stone walls, standing on an elliptical stone base",
           "cream stone, pale timber and stained glass", "gold and pale sky blue",
           "the slender golden bell spire with a cross at the top",
           "arched blue stained-glass windows and a small bell", 40, 18, "building", ""),
    "25": ("build", "法师-奥术塔(画风统一)",
           "a squat mage tower with warm cream plaster walls, an orange terracotta roof and a glowing pink magical crystal at the top emitting soft sparkles, a round window and a small arched door, standing on an elliptical stone base",
           "cream plaster, orange terracotta and crystal", "orange and magenta-pink with cool teal glow",
           "the glowing pink magical crystal crowning the tower",
           "floating sparkles and rune circles", 30, 18, "building", ""),
    "29": ("build", "大法师-浮空塔(画风统一)",
           "a tall ornate archmage tower of cream and gold stone, crowned by a floating golden orb encircled by rotating golden rings, a round clock-like window on the facade, stacked tiers and a small arched door, standing on an elliptical stone base",
           "cream stone, gold metal and crystal", "gold with sky blue gemstones",
           "the large floating golden orb with revolving rings at the top",
           "blue gemstones and arcane runes", 30, 22, "building", ""),
    "31": ("build", "死灵法师-哥特尖塔(画风统一,提亮)",
           "a gothic necromancer spire with cream-white and pale lavender stone walls, slender pointed arches, tall thin towers and leaf-like ornaments, a green magical flame glowing at the very top; walls must stay LIGHT and readable, never a dark mass",
           "pale cream stone, lavender stone and glass", "pale lavender and emerald green glow",
           "the glowing emerald-green flame atop the tallest spire",
           "pointed arch windows and small ghostly wisps", 35, 18, "building", ""),
    "32": ("build", "吸血鬼-哥特城堡(画风统一,提亮)",
           "a gothic vampire castle with pale rose and cream walls, multiple thin spires, pointed arch windows and delicate tracery, a small bat perched on the tallest tower; walls must stay LIGHT and readable, never a dark mass",
           "pale rose stone, cream stone and glass", "dusty rose and cool violet",
           "the tallest slender gothic spire with a small bat",
           "pointed windows and rose details", 35, 18, "building", ""),
    "33": ("build", "蒸汽坦克-黄铜锅炉(画风统一)",
           "a whimsical steam tank vehicle shaped like a large brass boiler on a tracked chassis, a round front hatch, riveted golden-brass panels, a small chimney puffing soft white steam, built on an elliptical stone display base",
           "polished brass, gold metal and timber", "gold and sky blue accents",
           "the big round riveted brass boiler drum with a glowing blue gauge",
           "steam puffs, gears and small wheels", 40, 30, "building", ""),
}


def main():
    out = {}
    for n, (kind, name, subj, mat, acc, sig, prop, pct, w, subjnoun, extra) in DATA.items():
        body = (
            "A {BUILDING} for a fantasy unit barracks. Constructed from {MAT}, with {ACC} as the dominant "
            "accent color, echoing the unit character art. One dominant oversized signature object dominates "
            "the scene: {SIG}. This single signature object must occupy at least {SIGPCT} percent of the {SUBJ} "
            "height and at least {SIGW} percent of the canvas width; it must read clearly when scaled down to "
            "10 percent. All other details, including {PROP}, are secondary and quieter. The architecture must "
            "clearly express this unit role and be unmistakably Western fantasy medieval, not Eastern."
        ).format(BUILDING=subj, MAT=mat, ACC=acc, SIG=sig, PROP=prop, SIGPCT=pct, SIGW=w, SUBJ=subjnoun)
        frame = SCENE_FRAME if kind == "scene" else BUILD_FRAME
        base = SEG1A if kind == "scene" else SEG1
        neg = NEG_BASE + ", " + NEG_AB + ", " + NEG_EXTRA
        prompt = (base + "\n\n" + body + extra + STYLE_UNIFY + "\n\n" + frame +
                  "\n\n" + SEG4 + "\n\nNegative prompt: " + neg)
        out[n] = {"name": name, "prompt": prompt}

    dst = ROOT / ".workbuddy/art-staging/western-redraw-v4/prompts.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(out)} prompts -> {dst}")
    for n, v in out.items():
        print(n, v["name"], len(v["prompt"]))


if __name__ == "__main__":
    main()
