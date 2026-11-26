#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展开兵营 V3「8 张定向打回修订」的完整 prompt。

锚点从 V2 方案文档逐字抽取。每张的槽位按用户 2026-11-26 打回意见定制。
用法: python3 tools/expand-barracks-v3-prompts.py
输出: .workbuddy/art-staging/western-redraw-v3/prompts.json
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

SCENE_TPL = (
    "An open-air Western fantasy {SCENE} serving as a fantasy unit barracks landmark. "
    "Made entirely of {MAT}, with {ACC} as the dominant accent color, echoing the unit character art. "
    "One dominant oversized signature object dominates the scene: {SIG}. "
    "This single signature object must occupy at least {SIGPCT} percent of the {SUBJ} height and at "
    "least {SIGW} percent of the canvas width; it must read clearly when the image is scaled down to 10 percent. "
    "All other details, including {PROP}, are secondary and must stay visually quieter and smaller than "
    "the signature object. This is a pure open-air natural landmark with NO building, NO house, NO walls, "
    "NO roof, NO door and NO windows. The scene must clearly express this unit role and be unmistakably "
    "Western fantasy, not Eastern. Distinctive silhouette compared to other barracks in the same family."
)
BUILD_TPL = (
    "A {BUILDING} for a fantasy unit barracks. Constructed from {MAT}, with {ACC} as the dominant "
    "accent color, echoing the unit character art. One dominant oversized signature object dominates "
    "the scene: {SIG}. This single signature object must occupy at least {SIGPCT} percent of the {SUBJ} "
    "height and at least {SIGW} percent of the canvas width; it must read clearly when the image is "
    "scaled down to 10 percent. All other details, including {PROP}, are secondary and must stay visually "
    "quieter and smaller than the signature object. The architecture itself must clearly express this "
    "unit role and be unmistakably Western fantasy medieval, not Eastern. Distinctive silhouette compared "
    "to other barracks in the same family."
)
SCENE_FRAME = (
    "Square 1:1 canvas, the whole scene centered slightly low, full scene including the elliptical stone "
    "base fills about 82 percent of canvas width, 8 to 10 percent clean margin on all sides, no cropping, "
    "no perspective drift, flat even framing. The single signature object stays fully inside the frame "
    "and is never hidden by decorations."
)
BUILD_FRAME = (
    "Square 1:1 canvas, building centered slightly low, full building including the elliptical stone base "
    "fills about 82 percent of canvas width, 8 to 10 percent clean margin on all sides, no cropping, no "
    "perspective drift, flat even framing. The single signature object stays fully inside the frame and "
    "is never hidden by flags, banners or roof decorations."
)

# kind, name, BUILDING/SCENE, MAT, ACC, SIG, PROP, SIGPCT, SIGW, SUBJ, EXTRA
DATA = {
    "02": ("build", "弓箭手-箭术塔楼建筑",
           "a Western fantasy archery training fortress with a timber shooting gallery, a steep-roofed watchtower, straw butt targets mounted along the wall and an arrow rack, clearly a solid building with walls and a roof",
           "honey timber, cream stone and rope", "deep red",
           "a giant ornate red recurve bow mounted on the tower facade as a heraldic emblem",
           "straw targets, quivers and arrows", 25, 15, "building", ""),
    "10": ("build", "狂战士-维京长屋",
           "a proper Norse Viking longhouse building with dark rough timber walls, a steep pitched roof crowned by a carved dragon-head ridge ornament, rune-carved door posts, animal-hide banners and a stone base",
           "dark timber, bone and rough stone", "dark red",
           "a giant double-bladed battleaxe planted before the longhouse",
           "rune stones, animal skins and shield racks", 35, 20, "building", ""),
    "11": ("scene", "骷髅兵-Q版露天骨场",
           "an open-air cute cartoon bone field with small crooked tombstones, bone piles and broken swords, absolutely no building",
           "bleached bones, cracked earth and grey stone rubble", "bone white",
           "a medium-sized ROUNDED CHIBI CARTOON SKULL with big round friendly eye sockets sitting on the bone pile, cute and soft rather than scary or realistic",
           "small bones, cartoon tombstones and broken blades", 25, 15, "scene", ""),
    "16": ("scene", "海盗-无云纹遮挡帆船",
           "a complete large sailing ship beached on the ground with a FULLY VISIBLE wooden hull, a tall mast and a billowing square sail; the decorative curled scrollwork at the prow must be SMALL and must NOT cover or block any part of the hull or sail",
           "old timber, rope and canvas sail", "sea blue",
           "a moderately sized carved ship figurehead at the prow with the billowing main sail clearly visible above it as the focal point",
           "barrels and coiled rope", 35, 20, "scene", ""),
    "24": ("build", "驯兽师-兽皮兽骨营地建筑",
           "a rugged beast-tamer outpost building inspired by an orc beast-master: an animal-hide covered timber lodge with a bone-trophy totem pole, round wooden shields hung on the walls, spear racks and a small iron-bar cage attached to the side",
           "animal hides, dark timber, bone trophies and iron", "earth orange and leather brown",
           "a giant round wooden shield with an iron rim leaning against the lodge",
           "bone totems, spears and iron cages", 30, 18, "building", ""),
    "37": ("scene", "凤凰-火焰巨巢质感统一",
           "a gigantic branching bird nest perched on a rocky cliff with flame feathers and embers, no stone walls and no roof",
           "woven branches, copper and embers", "warm orange red",
           "a giant flame-patterned egg with a fiery feather crest sitting in the nest",
           "flame feathers and glowing embers", 40, 20, "scene",
           " CRITICAL STYLE MATCH: this image must use the EXACT same painterly thick-rounded brushwork, plump soft forms, smooth color transitions and chunky simplified shapes as the rest of the barracks family. NO fine feathery linework, NO realistic fire texture, NO intricate detail, NO sharp edges, NO photorealistic shading. Keep it soft, round and candy-like."),
    "38": ("scene", "幼龙-蛋居巢穴中央",
           "a natural rocky cave grotto with a nest of vines and soft moss at the center, warm golden glow inside, no brickwork and no house",
           "natural rock, moss and vines", "emerald green and gold",
           "one giant emerald dragon-scale egg with golden veins placed at the EXACT CENTER of the nest inside the cave, clearly the single focal point",
           "gold nuggets, ferns and a ring of stones forming the nest", 40, 20, "scene",
           " The egg must be in the CENTER of the cave nest, not at the cave entrance and not off to the side."),
    "40": ("scene", "古龙-龙窟洞口",
           "a dark dragon lair CAVERN ENTRANCE in natural black rock, the cave mouth itself is the main landmark, framed by prehistoric dragon bone ribs and with scattered gold coins at the entrance",
           "natural black rock, dragon bones and treasure", "bronze and dark gold",
           "the large arched cavern mouth framed by a dragon rib bone arch with a warm gold glow inside",
           "scattered coins and broken dragon bones at the entrance", 40, 20, "scene",
           " The cave opening itself is the subject. NO giant dragon skull statue, NO dragon head sculpture, NO dragon face monument."),
}


def main():
    out = {}
    for n, (kind, name, subj, mat, acc, sig, prop, pct, w, subjnoun, extra) in DATA.items():
        body = (BUILD_TPL if kind == "build" else SCENE_TPL).format(
            BUILDING=subj, SCENE=subj, MAT=mat, ACC=acc, SIG=sig, PROP=prop,
            SIGPCT=pct, SIGW=w, SUBJ=subjnoun)
        frame = BUILD_FRAME if kind == "build" else SCENE_FRAME
        base = SEG1 if kind == "build" else SEG1A
        neg = NEG_BASE if kind == "build" else NEG_BASE + ", " + NEG_AB
        prompt = base + "\n\n" + body + extra + "\n\n" + frame + "\n\n" + SEG4 + "\n\nNegative prompt: " + neg
        out[n] = {"name": name, "prompt": prompt}

    dst = ROOT / ".workbuddy/art-staging/western-redraw-v3/prompts.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(out)} prompts -> {dst}")
    for n, v in out.items():
        print(n, v["name"], len(v["prompt"]))


if __name__ == "__main__":
    main()
