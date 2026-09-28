"""校验 md 正文中「纯文本 .md 路径引用」（反引号内）是否指向存在的文件。
这类引用不是 markdown 链接，但读者常照着去打开，失效同样影响使用。
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))))
EXC = {'backups', 'node_modules', '__pycache__', '.git', 'tmp-devtools'}
SCAN = ['docs', 'archive', 'scripts',
        'territory-king-developer', 'territory-king-game']

PAT = re.compile(r'`([^`\n]{3,120}?\.md)`')


def collect():
    out = []
    for d in SCAN:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dp, dn, fn in os.walk(base):
            dn[:] = [x for x in dn if x not in EXC]
            for f in fn:
                if f.lower().endswith('.md'):
                    out.append(os.path.join(dp, f))
    return sorted(out)


def main():
    bad = []
    total = 0
    for f in collect():
        src = io.open(f, encoding='utf-8', errors='ignore').read()
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        # 剔除代码块（目录结构示意里的文件名不是引用）
        lines = []
        in_fence = False
        for line in src.split('\n'):
            if line.lstrip().startswith('```'):
                in_fence = not in_fence
                continue
            if not in_fence:
                lines.append(line)
        src = '\n'.join(lines)
        for m in PAT.finditer(src):
            t = m.group(1).strip()
            if t.startswith('http') or '*' in t or t.startswith('#'):
                continue
            total += 1
            # 候选基准：项目根 / 文件所在目录 / docs 中心及其各分类 / 归档区 /
            # 云函数目录（正文里常见 `01-design/xxx.md` 这类相对 docs 的简写）
            sub = ['00-overview', '01-design', '02-deployment',
                   '03-operations', '04-changelog', '05-assets']
            bases = [ROOT, os.path.dirname(os.path.abspath(f)),
                     os.path.join(ROOT, 'docs'),
                     os.path.join(ROOT, 'docs', '99-archive'),
                     os.path.join(ROOT, 'territory-king-developer',
                                  'cloudfunctions'),
                     os.path.join(ROOT, 'archive')]
            bases += [os.path.join(ROOT, 'docs', x) for x in sub]
            cands = [os.path.join(b, t) for b in bases]
            if not any(os.path.exists(c) for c in cands):
                bad.append((rel, t))
    print('纯文本 .md 路径引用：共 %d 处，失效 %d 处' % (total, len(bad)))
    cur = None
    for r, t in bad:
        if r != cur:
            print('\n[%s]' % r)
            cur = r
        print('   %s' % t)


if __name__ == '__main__':
    main()
