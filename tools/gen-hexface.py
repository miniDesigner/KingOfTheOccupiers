"""Rebuild hex_bright as a TRUE pointy-top hexagon tile matching drawHexShape.

Root cause fixed (2026-11-20):
  The OLD brick's top face was a "shield" (pointed top, straight bottom edge)
  while the grid cell is a full pointy-top hexagon (two tips). Fill the cell with
  the shield -> the cell's lower slanted edges had no texture -> dark seams.

Approach (user-approved route A):
  - TOP: exact compressed pointy-top hexagon (tips y=8/206, corners y=57.5/156.5,
    half-width 121), stone texture inverse-mapped from the approved brick.
  - SIDE: THICK V-shaped thickness band hugging the two lower slant edges.
    THICK=60 matches the APPROVED original 45-degree brick's real side height
    (y202..262 = 60px) -- the earlier THICK=30 was half as thick and read as a
    thin rim. Texture is sampled from the ORIGINAL side wall (no regeneration):
    for each depth row we normalize u across that row's ACTUAL stone span, so a
    narrowing side wall never leaves transparent holes in the band.

  Texture source MUST be hex_bright-45deg-before-hexface.png (the approved
  original), NOT assets/hex_bright.png -- the latter was swapped to this script's
  own output during live tests and sampling it would degrade the texture.
"""
from pathlib import Path
import math
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / '.workbuddy' / 'art-staging' / 'board-art'
SRC = BASE / 'hex_bright-45deg-before-hexface.png'

N = 312
CX = 156.0
TIP_TOP, TIP_BOT = 8.0, 206.0
CY = (TIP_TOP + TIP_BOT) / 2
HALF_W = 121.0
HALF_H = (TIP_BOT - TIP_TOP) / 2
CORNER_DY = HALF_H / 2
THICK = 88          # side-wall thickness (px in 312 space); 60 original, 88 for a
                    # clearly THICK/volumetric side after row-to-row overlap
SIDE_TEX_TOP, SIDE_TEX_BOT = 120, 196  # side texture sampled from the SAME uniform
                    # top-face stone band (avoids the radial smear of the old
                    # narrowing inverted-triangle side sampling)


def hex_halfwidth(y):
    if y < CY - CORNER_DY:
        return HALF_W * (y - (CY - HALF_H)) / (HALF_H - CORNER_DY)
    if y > CY + CORNER_DY:
        return HALF_W * ((CY + HALF_H) - y) / (HALF_H - CORNER_DY)
    return HALF_W


def build():
    src = Image.open(SRC).convert('RGBA')
    sp = src.load()

    # ---- layer 1: THICK V-shaped side band (drawn first, top face overlaps it) ----
    side = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    dp = side.load()
    left_corner = CX - HALF_W
    for x in range(N):
        for y in range(int(CY - CORNER_DY), N):
            u = (x - left_corner) / (2 * HALF_W)   # 0 at left corner .. 1 at right corner
            # side wall must NOT exceed the top hexagon's horizontal extent
            # (x=35..277). Without this guard u<0/u>1 pixels get a valid edge_y
            # via linear extrapolation and the band spills ~31px past each side.
            if u < 0 or u > 1:
                continue
            if u <= 0.5:
                edge_y = (CY + CORNER_DY) + (u / 0.5) * (TIP_BOT - (CY + CORNER_DY))
            else:
                edge_y = TIP_BOT - ((u - 0.5) / 0.5) * (TIP_BOT - (CY + CORNER_DY))
            s = y - edge_y
            # extend a few px ABOVE the seam so the side fills the 1px gap left
            # between the top-face hexagon edge and the side wall (otherwise a
            # dotted dark background line shows through the join after AA).
            if -3 <= s <= THICK:
                sdraw = max(0, s)
                # sample stone from the SAME uniform top-face band so the side
                # wall shares texture with the top (no radial smear, no holes).
                sy = int(SIDE_TEX_TOP + (sdraw / THICK) * (SIDE_TEX_BOT - SIDE_TEX_TOP))
                sy = max(SIDE_TEX_TOP, min(SIDE_TEX_BOT, sy))
                sxp = int(max(0, min(N - 1, 60 + u * 192)))
                c = sp[sxp, sy]
                if c[3] > 0:
                    if s < 0:
                        # AA seam filler: the top-face rim is semi-transparent;
                        # if a dark side pixel shows through it we get a dotted
                        # dark line. Fill with a near-top brightness so the seam
                        # blends instead of turning into a dark dash.
                        k = 0.98
                    else:
                        # --- split the side into TWO distinct lit faces + a ridge ---
                        # u=0(left shoulder)->0.5(bottom tip)->1(right shoulder).
                        # Left face catches light, right face falls into shadow,
                        # with a crisp vertical ridge at the bottom tip (u=0.5).
                        face_k = 1.10 if u <= 0.5 else 0.80
                        depth_k = 0.60 - 0.16 * (s / THICK)
                        k = face_k * depth_k
                        if s < 5:
                            k *= 1.12
                        if abs(u - 0.5) < 0.02 and s < THICK * 0.7:
                            k *= 1.14
                    dp[x, y] = (
                        min(255, int(c[0] * k)),
                        min(255, int(c[1] * k)),
                        min(255, int(c[2] * k)),
                        255,
                    )

    # ---- layer 2: top face hexagon ----
    face = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    fp = face.load()
    for y in range(N):
        hw = hex_halfwidth(y + 0.5)
        for x in range(N):
            dx = x + 0.5 - CX
            if TIP_TOP <= y <= TIP_BOT and abs(dx) <= hw and hw > 0:
                # FIXED-scale translation map (NOT dx/hw normalized): keeps grain
                # isotropic. Normalizing by hw crushes rows near the tips into a
                # narrow source strip then re-expands them -> radial streak smear.
                fy = (y - TIP_TOP) / (TIP_BOT - TIP_TOP)
                # sample the CLEAN interior stone band (x=60..252). The original
                # brick has a baked bevel/highlight on x<60 and x>252; using the
                # full 35..277 width smuggled vertical streaks into both sides.
                # Same x-range as the side wall -> top/side texture stays continuous.
                sxp = int(60 + ((dx + HALF_W) / (2 * HALF_W)) * 192)
                sy = int(40 + fy * (196 - 40))
                sxp = max(0, min(N - 1, sxp))
                sy = max(0, min(N - 1, sy))
                c = sp[sxp, sy]
                # NOTE: do NOT add a per-row bevel highlight along the lower seam
                # here. The slant edge falls on sub-pixel y positions, so a row-
                # based bright rim turns into a dotted/staircased line after AA.
                # The side wall already has its own smooth bevel (s<5) instead.
                fp[x, y] = c

    out = Image.alpha_composite(side, face)
    out.save(BASE / 'HEXFACE-transparent.png')

    dark = Image.new('RGBA', (N, N), (20, 30, 45, 255))
    dark.alpha_composite(out)
    dark.convert('RGB').save(BASE / 'HEXFACE-dark.png')

    chk = dark.convert('RGB').copy()
    d = ImageDraw.Draw(chk)
    verts = [
        (CX, CY - HALF_H), (CX + HALF_W, CY - CORNER_DY),
        (CX + HALF_W, CY + CORNER_DY), (CX, CY + HALF_H),
        (CX - HALF_W, CY + CORNER_DY), (CX - HALF_W, CY - CORNER_DY),
    ]
    d.line(verts + [verts[0]], fill=(90, 200, 255), width=2)
    chk.save(BASE / 'HEXFACE-shape-check.png')

    K = CORNER_DY / (HALF_W / math.sqrt(3))
    print(f'K={K:.3f} (target HEX_FLATTEN 0.707); tips {TIP_TOP}/{TIP_BOT}, corners {CY-CORNER_DY}/{CY+CORNER_DY}; THICK={THICK}px')
    print('saved HEXFACE-transparent.png / HEXFACE-dark.png / HEXFACE-shape-check.png')


if __name__ == '__main__':
    build()
