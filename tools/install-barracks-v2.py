#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 V2 去房屋化批次的 16 张验收通过图覆盖到 assets/buildings/。

16 张 = 5 张基准(11/16/19/38/40) + 7 张放量(09/10/23/24/30/37/39)
       + 4 张 D 档补做(02/12/15/27)。其余 24 张保持工程现状不动。
覆盖前先备份这 16 张原图到 .workbuddy/backups/pre-v2-nonbuilding-<日期>/。

用法: python3 tools/install-barracks-v2.py <cutout_dir> <project_root>
"""
import shutil
import sys
from datetime import datetime
from pathlib import Path
from PIL import Image

NUMS = ['02', '09', '10', '11', '12', '15', '16', '19',
        '23', '24', '27', '30', '37', '38', '39', '40']


def main():
    cutout = Path(sys.argv[1])
    root = Path(sys.argv[2])
    assets = root / 'assets' / 'buildings'
    backup = root / '.workbuddy' / 'backups' / ('pre-v2-nonbuilding-' + datetime.now().strftime('%Y%m%d'))
    backup.mkdir(parents=True, exist_ok=True)

    for n in NUMS:
        src = cutout / f'barracks_unit_{n}.png'
        assert src.exists(), f'缺少 {src}'
        im = Image.open(src)
        assert im.size == (312, 312) and im.mode == 'RGBA', f'{src} 规格错误 {im.size} {im.mode}'

    backed = 0
    for n in NUMS:
        dst = assets / f'barracks_unit_{n}.png'
        if dst.exists():
            shutil.copy2(dst, backup / dst.name)
            backed += 1

    total = 0
    for n in NUMS:
        src = cutout / f'barracks_unit_{n}.png'
        dst = assets / f'barracks_unit_{n}.png'
        shutil.copy2(src, dst)
        total += dst.stat().st_size
        im = Image.open(dst)
        assert im.size == (312, 312) and im.mode == 'RGBA', f'{dst} 覆盖后规格错误'

    print(f'backed up {backed} originals -> {backup}')
    print(f'installed {len(NUMS)} images -> {assets}')
    print(f'installed size: {total/1024:.1f} KB')


if __name__ == '__main__':
    main()
