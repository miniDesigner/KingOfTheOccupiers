#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成软件著作权登记用的源程序文档（HTML 格式，可直接用 Word 打开另存为 docx/pdf）。

规则（中国版权保护中心）：
  - 前 30 页 + 后 30 页，共 60 页
  - 每页 50 行
  - 页眉标注软件全称、版本号、页码
  - 内容必须是真实源程序

用法： python3 tools/gen-copyright-source.py
输出： docs/申报/软著/占地之王V1.0-源程序.html
"""

from pathlib import Path
from html import escape
import sys

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "申报" / "软著" / "占地之王V1.0-源程序.html"

SOFTWARE = "占地之王"
VERSION = "V1.0"
LINES_PER_PAGE = 50
PAGES_EACH_SIDE = 30

# 源码拼接顺序：按职责分层，入口在前、工具在后，最后附微信入口桩
ORDER = [
    "src/config.js",
    "src/game/Game.js",
    "src/world/HexMath.js",
    "src/world/HexTile.js",
    "src/world/HexMap.js",
    "src/entity/Player.js",
    "src/entity/Building.js",
    "src/entity/MarchGroup.js",
    "src/entity/AIPlayer.js",
    "src/entity/SnapshotPlayer.js",
    "src/system/PathfindingSystem.js",
    "src/system/CombatSystem.js",
    "src/system/EconomySystem.js",
    "src/system/BuildSystem.js",
    "src/system/MarchSystem.js",
    "src/system/TowerSystem.js",
    "src/system/SkillSystem.js",
    "src/system/SynergySystem.js",
    "src/system/AnimationManager.js",
    "src/system/InputSystem.js",
    "src/system/Layout.js",
    "src/system/SafeArea.js",
    "src/system/RenderSystem.js",
    "src/system/ArtSystem.js",
    "src/system/ArtLayer.js",
    "src/system/ArtManifest.js",
    "src/system/FontSystem.js",
    "src/system/AudioManager.js",
    "src/system/AdManager.js",
    "src/system/ComplianceSystem.js",
    "src/system/HealthAdvice.js",
    "src/meta/PlayerProfile.js",
    "src/meta/ProfileManager.js",
    "src/meta/PowerSystem.js",
    "src/meta/BonusCalculator.js",
    "src/meta/DeploymentSystem.js",
    "src/meta/EquipmentSystem.js",
    "src/meta/TechTreeSystem.js",
    "src/meta/ShopSystem.js",
    "src/meta/QuestSystem.js",
    "src/meta/BattlePassSystem.js",
    "src/meta/LadderSystem.js",
    "src/meta/LeaderboardSystem.js",
    "src/meta/AccountManager.js",
    "src/meta/AsyncMatchSystem.js",
    "src/meta/ShareSystem.js",
    "src/data/ConfigLoader.js",
    "src/data/levels.js",
    "src/data/races.js",
    "src/net/CloudClient.js",
    "src/net/SessionManager.js",
    "src/utils/math.js",
    "src/utils/rng.js",
    "game.js",  # 微信小游戏入口桩（含分包加载逻辑）
]


def collect_lines():
    """按 ORDER 拼接源码，返回 (行列表, 实际读取的文件数, 缺失文件列表)"""
    lines = []
    read_count = 0
    missing = []
    for rel in ORDER:
        p = ROOT / rel
        if not p.exists():
            missing.append(rel)
            continue
        text = p.read_text(encoding="utf-8")
        lines.append(f"// === {rel} ===")
        lines.extend(text.replace("\r\n", "\n").replace("\r", "\n").split("\n"))
        read_count += 1
    return lines, read_count, missing


def build_html(pages):
    """把分页后的行列表渲染成带页眉的 HTML"""
    total = len(pages)
    css = """
    @page { size: A4; margin: 16mm 12mm 14mm 12mm; }
    body { margin: 0; font-family: Consolas, "Courier New", monospace; }
    .page { page-break-after: always; min-height: 265mm; position: relative; }
    .page:last-child { page-break-after: auto; }
    .head { border-bottom: 1px solid #333; padding-bottom: 3mm; margin-bottom: 4mm;
            font-size: 9pt; display: flex; justify-content: space-between; }
    pre { margin: 0; font-size: 8.5pt; line-height: 1.32;
          white-space: pre-wrap; word-break: break-all; }
    """

    parts = [
        "<!DOCTYPE html>",
        '<html lang="zh-CN"><head><meta charset="UTF-8">',
        f"<title>{SOFTWARE} {VERSION} 源程序</title>",
        f"<style>{css}</style></head><body>",
    ]
    for idx, page_lines in enumerate(pages, start=1):
        parts.append('<div class="page">')
        parts.append(
            '<div class="head">'
            f"<span>{SOFTWARE} {VERSION} · 源程序</span>"
            f"<span>第 {idx} / {total} 页</span>"
            "</div>"
        )
        parts.append("<pre><code>")
        parts.append(escape("\n".join(page_lines)))
        parts.append("</code></pre>")
        parts.append("</div>")
    parts.append("</body></html>")
    return "\n".join(parts)


def main():
    lines, read_count, missing = collect_lines()
    if missing:
        print("警告：以下文件不存在，已跳过：")
        for m in missing:
            print("  -", m)

    total_lines = len(lines)
    target_lines = LINES_PER_PAGE * PAGES_EACH_SIDE
    head_half = target_lines
    tail_start = max(head_half, total_lines - target_lines)

    selected = lines[:head_half] + lines[tail_start:]
    # 不足 60 页时全部提交
    if total_lines <= target_lines:
        selected = lines

    pages = [
        selected[i:i + LINES_PER_PAGE]
        for i in range(0, len(selected), LINES_PER_PAGE)
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(build_html(pages), encoding="utf-8")

    print(f"读取源文件：{read_count} 个")
    print(f"源码总行数：{total_lines} 行")
    print(f"提交行数：{len(selected)} 行 → {len(pages)} 页（{LINES_PER_PAGE} 行/页）")
    if total_lines > target_lines * 2:
        print("说明：总行数超过 3000 行，按规则取前 1500 + 后 1500 行")
    else:
        print("说明：总行数不足 3000 行，已全部提交")
    print(f"输出：{OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover
        print(f"生成失败：{exc}", file=sys.stderr)
        sys.exit(1)
