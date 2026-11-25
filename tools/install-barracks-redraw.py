#!/usr/bin/env python3
"""把验收通过的 40 张兵营重绘覆盖到 assets/buildings/，并先备份原图。

用法: python3 tools/install-barracks-redraw.py <cutout_dir> <project_root>
流程：备份 assets/buildings/barracks_unit_*.png 到 .workbuddy/backups/pre-barracks-redraw-<日期>/ → 覆盖 → 逐张校验尺寸 → 报告。
"""
import shutil
import sys
from datetime import datetime
from pathlib import Path
from PIL import Image


def main():
    cutout = Path(sys.argv[1])
    root = Path(sys.argv[2])
    assets = root / 'assets' / 'buildings'
    backup = root / '.workbuddy' / 'backups' / ('pre-barracks-redraw-' + datetime.now().strftime('%Y%m%d'))
    backup.mkdir(parents=True, exist_ok=True)

    nums = [f'{i:02d}' for i in range(1, 41)]
    # 1) 校验 40 张齐全且规格正确
    for n in nums:
        src = cutout / f'barracks_unit_{n}.png'
        assert src.exists(), f'缺少 {src}'
        im = Image.open(src)
        assert im.size == (312, 312) and im.mode == 'RGBA', f'{src} 规格错误 {im.size} {im.mode}'

    # 2) 备份原图
    backed = 0
    for n in nums:
        dst = assets / f'barracks_unit_{n}.png'
        if dst.exists():
            shutil.copy2(dst, backup / dst.name)
            backed += 1

    # 3) 覆盖
    total_bytes = 0
    for n in nums:
        src = cutout / f'barracks_unit_{n}.png'
        dst = assets / f'barracks_unit_{n}.png'
        shutil.copy2(src, dst)
        total_bytes += dst.stat().st_size

    print(f'backed up {backed} originals -> {backup}')
    print(f'installed 40 images -> {assets}')
    print(f'total size: {total_bytes/1024/1024:.2f} MB')
    # 4) 抽查
    for n in ['01', '21', '36', '40']:
        im = Image.open(assets / f'barracks_unit_{n}.png')
        print(f'  verify {n}: {im.size} {im.mode}')


if __name__ == '__main__':
    main()
