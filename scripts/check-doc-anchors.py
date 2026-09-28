"""校验 md 文档内的锚点链接（#xxx）是否能在目标文档里找到对应标题。
GitHub 风格 slug：小写、去标点、空格->连字符、保留中文。
"""
import io
import os
import re
import sys
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))))

MD_LINK = re.compile(r'\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
EXCLUDE_DIR_PARTS = {'backups', 'node_modules', '__pycache__', '.git',
                     'tmp-devtools', 'assets'}
SCAN_DIRS = ['docs', 'archive', 'scripts',
             'territory-king-developer', 'territory-king-game']

# 代码块围栏内的行不算标题
FENCE = re.compile(r'^\s*```')


def slug(text):
    t = text.strip()
    # 去掉 markdown 链接语法保留文本
    t = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', t)
    # 去掉行内代码反引号
    t = t.replace('`', '')
    t = t.lower()
    # 去掉 GitHub 会忽略的标点（保留中文、字母数字、- _ 空格）
    t = re.sub(r'[^\w\u4e00-\u9fff\-_ ]', '', t, flags=re.UNICODE)
    t = t.replace(' ', '-')
    return t


def collect_md_files():
    out = []
    for d in SCAN_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in EXCLUDE_DIR_PARTS]
            for fn in filenames:
                if fn.lower().endswith('.md'):
                    out.append(os.path.join(dirpath, fn))
    return sorted(out)


def headings(path):
    """返回该文件所有标题的 slug 集合"""
    res = set()
    in_fence = False
    for line in io.open(path, encoding='utf-8', errors='ignore'):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = re.match(r'^(#{1,6})\s+(.*)$', line.rstrip('\n'))
        if m:
            res.add(slug(m.group(2)))
    return res


def main():
    files = collect_md_files()
    cache = {}
    broken = []
    ok = 0
    for f in files:
        src = io.open(f, encoding='utf-8', errors='ignore').read()
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        for m in MD_LINK.finditer(src):
            raw = m.group(1).strip()
            if '#' not in raw:
                continue
            target, _, anchor = raw.partition('#')
            anchor = unquote(anchor)
            if not anchor:
                continue
            if target:
                tp = os.path.normpath(os.path.join(
                    os.path.dirname(os.path.abspath(f)), unquote(target)))
            else:
                tp = os.path.abspath(f)
            if not os.path.exists(tp):
                continue  # 文件本身失效，交给 check-doc-links.py 报
            if tp not in cache:
                cache[tp] = headings(tp)
            if anchor in cache[tp]:
                ok += 1
            else:
                broken.append((rel, raw, anchor, os.path.relpath(
                    tp, ROOT).replace('\\', '/')))

    print('锚点链接：有效 %d / **失效 %d**' % (ok, len(broken)))
    if broken:
        print('\n===== 失效锚点明细 =====')
        cur = None
        for rel, raw, anc, tp in broken:
            if rel != cur:
                print('\n[%s]' % rel)
                cur = rel
            print('   (%s)  锚点 "#%s" 在 %s 中找不到' % (raw, anc, tp))
    return 0 if not broken else 1


if __name__ == '__main__':
    sys.exit(main())
