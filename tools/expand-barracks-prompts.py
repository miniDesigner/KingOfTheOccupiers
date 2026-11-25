#!/usr/bin/env python3
"""把 PROMPT-PACK-REMAINING-36.md 展开成 prompts.json（编号 -> 完整 prompt）。

固定段从文件里按标题提取，槽位从表格解析，保证 36 张风格锚点逐字一致。
"""
import json
import re
import sys
from pathlib import Path

SRC = Path('E:/GitRep/KingOfTheOccupiers/.workbuddy/art-staging/barracks-textonly-v3/PROMPT-PACK-REMAINING-36.md')
OUT = Path('E:/GitRep/KingOfTheOccupiers/.workbuddy/art-staging/barracks-textonly-v3/prompts.json')


def code_block_after(text, heading):
    idx = text.index(heading)
    m = re.search(r'```\n(.*?)\n```', text[idx:], re.S)
    return m.group(1).strip()


def main():
    text = SRC.read_text(encoding='utf-8')
    seg1 = code_block_after(text, '### 段 1 · 风格锚点')
    seg2tpl = code_block_after(text, '### 段 2 · 主体描述模板')
    seg3 = code_block_after(text, '### 段 3 · 画布与构图')
    seg4 = code_block_after(text, '### 段 4 · 技术约束与禁忌')
    neg = code_block_after(text, '### Negative prompt')

    # 解析槽位表：| 02 | 弓箭手 | ... |
    tbl_idx = text.index('## 36 张槽位表')
    rows = []
    for line in text[tbl_idx:].splitlines():
        line = line.strip()
        if not line.startswith('|'):
            if rows:
                break
            continue
        cells = [c.strip() for c in line.strip('|').split('|')]
        if len(cells) < 7 or not re.fullmatch(r'\d{2}', cells[0]):
            continue
        rows.append(cells)

    assert len(rows) == 36, f'期望 36 行，实际 {len(rows)}'

    out = {}
    for num, name, building, signature, material, accent, prop in rows:
        seg2 = (seg2tpl
                .replace('{BUILDING}', building)
                .replace('{SIGNATURE}', signature)
                .replace('{MATERIAL}', material)
                .replace('{ACCENT}', accent)
                .replace('{PROP}', prop))
        prompt = '\n\n'.join([seg1, seg2, seg3, seg4]) + '\n\nNegative prompt: ' + neg
        out[num] = {'name': name, 'prompt': prompt}

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'wrote {OUT} ({len(out)} prompts)')
    print('sample 02 head:', out['02']['prompt'][:80])


if __name__ == '__main__':
    main()
