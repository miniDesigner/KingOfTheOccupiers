#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""展开兵营 V2「去房屋化 + 形态精确化」方案的完整 prompt。
用法:
  python tools/expand-barracks-v2-prompts.py <输出json路径> [编号,编号,...]
默认展开方案里全部 12 张需出图的（A/B/C 档，D 档 02/12/15/27 不出图）。
风格锚点段从方案文档逐字抽取，避免手抄漂移。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "docs/art/ART-BARRACKS-V2-NONBUILDING-REDRAW.md"

# 需出图的 12 座（D 档不动）
SCENE_NUMS = ["11", "16", "19", "24", "37", "38", "39", "40"]  # 段1A
BUILD_NUMS = ["09", "10", "23", "30"]                            # 段1

def block(doc, after):
    i = doc.index(after)
    return re.search(r"```\n(.*?)\n```", doc[i:], re.S).group(1).strip()

# 场景段模板（A/B档 + 16船/19营地）
SCENE_TPL = (
    "An open-air Western fantasy {SCENE} serving as a fantasy unit barracks landmark. "
    "Made entirely of {MAT}, with {ACC} as the dominant accent color, echoing the unit character art. "
    "One dominant oversized signature object dominates the scene: {SIG}. "
    "This single signature object must occupy at least 40 percent of the scene height and at least "
    "20 percent of the canvas width; it must read clearly when the image is scaled down to 10 percent. "
    "All other details, including {PROP}, are secondary and must stay visually quieter and smaller "
    "than the signature object. This is a pure open-air natural landmark with NO building, NO house, "
    "NO walls, NO roof, NO door and NO windows. The scene must clearly express this unit role and be "
    "unmistakably Western fantasy, not Eastern. Distinctive silhouette compared to other barracks in the same family."
)

# 建筑段模板（C档 4座）
BUILD_TPL = (
    "A {BUILDING} for a fantasy unit barracks. Constructed from {MAT}, with {ACC} as the dominant "
    "accent color, echoing the unit character art. One dominant oversized signature object dominates "
    "the scene: {SIG}. This single signature object must occupy at least 35 percent of the building "
    "height and at least 20 percent of the canvas width; it must read clearly when the image is scaled "
    "down to 10 percent. All other details, including {PROP}, are secondary and must stay visually "
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

# 槽位表
DATA = {
    # --- 段1A 场景模板 ---
    "11": dict(name="骷髅兵-露天骨场", SCENE="open-air bone field on cracked earth with scattered crooked tombstones, bone piles and broken swords, absolutely no building", MAT="bleached bones, cracked earth and grey stone rubble", ACC="bone white", SIG="a gigantic skull with deeply sunken eye sockets rising from the bone pile", PROP="scattered bones and broken blades"),
    "16": dict(name="海盗-完整大帆船", SCENE="a complete large sailing ship beached on the ground with a full hull, a tall mast and a billowing square sail, a Western fantasy pirate vessel", MAT="old timber, rope and canvas sail", ACC="sea blue", SIG="a gigantic carved ship figurehead with a billowing main sail above it as the focal point", PROP="barrels and coiled rope"),
    "19": dict(name="长枪兵-驻扎营地", SCENE="a military encampment of canvas tents with a wooden palisade fence and a campfire, absolutely no stone tower", MAT="canvas tents, timber palisade and iron spear racks", ACC="warm bronze", SIG="a row of giant upright spears with level spearpoints planted at the camp center", PROP="a campfire and wooden crates"),
    "24": dict(name="驯兽师-野外兽栏", SCENE="a wild animal corral with prominent iron-bar cages, wooden stake fences, iron chains and saddlery, absolutely no house", MAT="timber stakes, iron bars and leather harness", ACC="earth orange", SIG="a giant curved animal horn arching above the iron cage", PROP="iron cages, chains and bones"),
    "37": dict(name="凤凰-树枝巨巢", SCENE="a gigantic branching bird nest perched on a rocky cliff with flame feathers and embers, no stone walls and no roof", MAT="woven branches, copper and embers", ACC="warm orange red", SIG="a giant flame-patterned egg with a fiery feather crest sitting in the nest", PROP="flame feathers and glowing embers"),
    "38": dict(name="幼龙-岩洞蛋窟", SCENE="a natural rocky cave grotto with vines and warm golden glow inside, no brickwork and no house", MAT="natural rock, moss and vines", ACC="emerald green and gold", SIG="a giant emerald dragon-scale egg with golden veins displayed at the cave mouth", PROP="gold nuggets and ferns"),
    "39": dict(name="战争泰坦-巨岩台地", SCENE="a bare giant rock plateau with broken stone columns and rock debris, no house and no roof", MAT="massive granite rock and broken columns", ACC="granite grey", SIG="a giant stone fist propping up the rock platform", PROP="broken columns and rock fragments"),
    "40": dict(name="古龙-西方龙窟", SCENE="dragon lair of a Western dragon in a natural black rock cavern with a bone arch and scattered gold coins", MAT="natural black rock, dragon bones and treasure", ACC="bronze and dark gold", SIG="a gigantic Western dragon skull with horns, an open toothed jaw and wing-bone ribs rising at the center", PROP="scattered coins and broken dragon bones"),
    # --- 段1 建筑模板 ---
    "09": dict(name="骑士-开放式马厩", BUILDING="an open timber stable with horse stalls, hitching posts and a feed trough, no closed house", MAT="timber and stone", ACC="knight blue", SIG="a giant horseshoe with a carved horse head", PROP="horses and hay bales"),
    "10": dict(name="狂战士-北欧营地", BUILDING="a Norse Viking longhouse of dark rough timber with a dragon-head ridge ornament, rune stones and animal skins, no golden tiled roof", MAT="dark timber and bone", ACC="dark red", SIG="a giant double-bladed battleaxe", PROP="rune stones and animal skins"),
    "23": dict(name="战车-罗马跑场无轮盘", BUILDING="a Roman chariot racing arena with an oval sand track, stone bleachers and arched gateways, no giant wheel", MAT="stone and sand", ACC="war red", SIG="a complete Roman chariot with a raised blue banner as the focal point", PROP="starting gate and sand track"),
    "30": dict(name="十字军-独立十字盾", BUILDING="a Crusader stone fortress with a shield wall and a giant standalone cross shield planted in front", MAT="grey stone and iron", ACC="holy white and red", SIG="a gigantic standalone white shield with a bold red cross", PROP="a shield wall and banners"),
}

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / ".workbuddy/art-staging/western-redraw-v2/all-prompts.json")
    only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
    doc = DOC.read_text(encoding="utf-8")
    seg1 = block(doc, "### 段 1 ·")
    seg1a = block(doc, "### 段 1A")
    seg4 = block(doc, "### 段 4")
    neg_base = block(doc, "### Negative prompt（B/C/D 档")
    neg_ab = block(doc, "### Negative prompt · A/B 档")

    result = {}
    for n, v in DATA.items():
        if only and n not in only:
            continue
        if n in SCENE_NUMS:
            body = SCENE_TPL.format(**{k: v[k] for k in ("SCENE", "MAT", "ACC", "SIG", "PROP")})
            prompt = seg1a + "\n\n" + body + "\n\n" + SCENE_FRAME + "\n\n" + seg4 + "\n\nNegative prompt: " + neg_base + ", " + neg_ab
        else:
            body = BUILD_TPL.format(**{k: v[k] for k in ("BUILDING", "MAT", "ACC", "SIG", "PROP")})
            prompt = seg1 + "\n\n" + body + "\n\n" + BUILD_FRAME + "\n\n" + seg4 + "\n\nNegative prompt: " + neg_base
        result[n] = {"name": v["name"], "prompt": prompt}

    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(result)} prompts -> {out}")
    print("nums:", list(result.keys()))

if __name__ == "__main__":
    main()
