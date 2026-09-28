"""校验文档内所有相对链接（markdown [x](y) + HTML <a href>）是否指向存在的文件。
用法：python scripts/check-doc-links.py [根目录...]
"""
import io
import os
import re
import sys
from urllib.parse import unquote

# 脚本位于 <项目根>/territory-king-developer/scripts/ → 上溯三级到项目根
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))))

MD_LINK = re.compile(r'\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
HTML_LINK = re.compile(r'<a\s+[^>]*href="([^"]+)"', re.I)

# 目录型扫描范围
SCAN_DIRS = ['docs', 'archive', 'scripts',
             'territory-king-developer', 'territory-king-game']
EXCLUDE_DIR_PARTS = {'backups', 'node_modules', '__pycache__', '.git',
                     'tmp-devtools', 'assets'}


FENCE = re.compile(r'^\s*```')
INLINE = re.compile(r'`[^`\n]*`')


def strip_code(src):
    """剔除围栏代码块与行内代码 —— 里面的链接语法只是示例，不是真引用"""
    out = []
    in_fence = False
    for line in src.split('\n'):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        out.append(INLINE.sub('', line))
    return '\n'.join(out)


def should_scan(path):
    parts = set(path.replace('\\', '/').split('/'))
    return not (parts & EXCLUDE_DIR_PARTS)


def collect_md_files():
    out = []
    for d in SCAN_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames
                           if x not in EXCLUDE_DIR_PARTS]
            rel_dir = os.path.relpath(dirpath, ROOT).replace('\\', '/')
            if not should_scan(rel_dir):
                continue
            for fn in filenames:
                if fn.lower().endswith('.md'):
                    out.append(os.path.join(dirpath, fn))
    return sorted(out)


def resolve(src_file, target):
    """把链接目标解析为绝对文件路径；返回 (abs_path, kind) kind in
    {file, anchor, external, mailto, unknown}"""
    t = target.strip()
    if not t:
        return None, 'unknown'
    if t.startswith('#'):
        return None, 'anchor'
    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*://', t):
        return None, 'external'
    if t.startswith('mailto:'):
        return None, 'external'
    # 去掉锚点片段
    t = unquote(t.split('#')[0])
    if not t:
        return None, 'anchor'
    base = os.path.dirname(os.path.abspath(src_file))
    return os.path.normpath(os.path.join(base, t)), 'file'


def main():
    files = collect_md_files()
    broken = []
    ok_count = 0
    anchor_count = 0
    ext_count = 0
    per_file = {}

    for f in files:
        try:
            src = io.open(f, encoding='utf-8').read()
        except Exception:
            continue
        src = strip_code(src)
        rel_src = os.path.relpath(f, ROOT).replace('\\', '/')
        targets = [(m.group(1), 'md') for m in MD_LINK.finditer(src)]
        targets += [(m.group(1), 'html') for m in HTML_LINK.finditer(src)]
        for t, kind in targets:
            ap, k = resolve(f, t)
            if k == 'anchor':
                anchor_count += 1
            elif k == 'external':
                ext_count += 1
            elif k == 'file':
                if os.path.exists(ap):
                    ok_count += 1
                else:
                    broken.append((rel_src, t, os.path.relpath(
                        ap, ROOT).replace('\\', '/')))
                    per_file.setdefault(rel_src, []).append(t)

    print('扫描 md 文件：%d' % len(files))
    print('链接统计：有效 %d / 锚点 %d / 外链 %d / **失效 %d**'
          % (ok_count, anchor_count, ext_count, len(broken)))
    if broken:
        print('\n===== 失效链接明细 =====')
        cur = None
        for src, t, ap in broken:
            if src != cur:
                print('\n[%s]' % src)
                cur = src
            print('   %s  ->  %s (不存在)' % (t, ap))
    print('\n===== 按文件汇总 =====')
    for k in sorted(per_file, key=lambda x: -len(per_file[x])):
        print('%-60s %d' % (k, len(per_file[k])))
    return 0 if not broken else 1


if __name__ == '__main__':
    sys.exit(main())
