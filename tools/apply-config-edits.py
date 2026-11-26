#!/usr/bin/env python3
"""把可视化编辑器导出的 config-edits.json 写回 config/ 并重建 config/*.js。

用法:
  python tools/apply-config-edits.py config-edits.json
  python tools/apply-config-edits.py config-edits.json --dry-run

安全约束:
  - 只接受 config/ 下已存在的 .json 文件名，拒绝路径分隔符与 ..
  - 写回前整份备份到 .workbuddy/backups/config-before-editor-<时间戳>/
  - 默认写回后自动运行 node tools/build-config-js.mjs（微信小游戏 require 的 .js 来源）
"""
import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[1]


def diff_count(a, b, path=''):
    """递归统计叶子差异数量，返回 (数量, 示例列表)。"""
    n = 0
    samples = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                n += 1
                if len(samples) < 8:
                    samples.append(f'{path}.{k} (新增/删除)')
                continue
            c, s = diff_count(a[k], b[k], f'{path}.{k}' if path else k)
            n += c
            samples.extend(s[:8 - len(samples)])
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            n += 1
            if len(samples) < 8:
                samples.append(f'{path} 长度 {len(a)} -> {len(b)}')
        for i in range(min(len(a), len(b))):
            c, s = diff_count(a[i], b[i], f'{path}[{i}]')
            n += c
            samples.extend(s[:8 - len(samples)])
    elif a != b:
        n += 1
        if len(samples) < 8:
            samples.append(f'{path}: {a!r} -> {b!r}')
    return n, samples


def validate(pkg, config_dir):
    if not isinstance(pkg, dict) or 'files' not in pkg or not isinstance(pkg['files'], dict):
        raise ValueError('编辑包格式错误：缺少 files 对象')
    files = pkg['files']
    if not files:
        raise ValueError('编辑包为空，没有待写回的文件')
    for name, data in files.items():
        if not isinstance(name, str) or not name.endswith('.json'):
            raise ValueError(f'非法文件名: {name!r}')
        if '/' in name or '\\' in name or '..' in name:
            raise ValueError(f'文件名含路径分隔符或 ..，拒绝: {name!r}')
        target = config_dir / name
        if not target.is_file():
            raise ValueError(f'目标配置不存在: {target}')
        if not isinstance(data, (dict, list)):
            raise ValueError(f'{name} 的顶层必须是对象或数组')
    return files


def main():
    ap = argparse.ArgumentParser(description='写回数值配置编辑包')
    ap.add_argument('package', help='config-edits.json 路径')
    ap.add_argument('--root', default=str(DEFAULT_ROOT), help='项目根目录（默认脚本上级目录）')
    ap.add_argument('--dry-run', action='store_true', help='只校验和打印差异，不写文件')
    ap.add_argument('--no-build', action='store_true', help='写回后不运行 build-config-js.mjs')
    args = ap.parse_args()

    root = Path(args.root).resolve()
    config_dir = root / 'config'
    pkg_path = Path(args.package).resolve()
    if not pkg_path.is_file():
        print(f'ERROR 编辑包不存在: {pkg_path}', file=sys.stderr)
        return 1

    pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
    try:
        files = validate(pkg, config_dir)
    except ValueError as e:
        print(f'ERROR {e}', file=sys.stderr)
        return 1

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup_dir = root / '.workbuddy/backups' / f'config-before-editor-{stamp}'
    total = 0
    for name, data in files.items():
        target = config_dir / name
        old = json.loads(target.read_text(encoding='utf-8'))
        n, samples = diff_count(old, data)
        total += n
        print(f'[DIFF] {name}: {n} 处字段变化')
        for s in samples:
            print(f'       - {s}')
        if not args.dry_run:
            backup_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, backup_dir / name)
            target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            print(f'[WRITE] {target}')

    if args.dry_run:
        print(f'[DRY-RUN] 校验通过，共 {total} 处变化；未写入任何文件。')
        return 0

    print(f'[BACKUP] 原配置已备份至 {backup_dir}')

    if not args.no_build:
        build_script = root / 'tools/build-config-js.mjs'
        if not build_script.is_file():
            print(f'ERROR 找不到 {build_script}', file=sys.stderr)
            return 1
        proc = subprocess.run(['node', str(build_script)], cwd=str(root),
                              capture_output=True, text=True)
        if proc.returncode != 0:
            print(proc.stdout, file=sys.stderr)
            print(proc.stderr, file=sys.stderr)
            print('ERROR build-config-js.mjs 失败；JSON 已写回，请检查后手动重跑构建脚本。', file=sys.stderr)
            return 1
        print('[BUILD] config/*.js 已同步重建（微信小游戏读取的模块）')

    print(f'[DONE] {len(files)} 个文件 / {total} 处字段变化已生效。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
