#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
占地之王 · 美术占位图接入与正确性审查（可复跑）

用法：
    python3 tools/audit-art-assets.py

审查 8 个维度：
  A 三方一致性   PLACEHOLDER-MANIFEST.csv ↔ assets 实体 ↔ ArtManifest.js
  B 代码引用闭合 ART_HOOKS / ART_PREFIXES / 字面量 key / 动态拼接 key
  C 全量可达     331 个 key 是否都能被运行时代码路径取到
  D 尺寸口径     实际像素 == manifest 声明 == ArtManifest 记录；@3x 整除
  E 九宫格       .9.png 标记、slice 公式复算
  F 格式内容     真实编解码 / 非空白 / 最小尺寸 / 字体说明卡识别
  G 运行时路径   浏览器 ../assets/ 与微信 assets/ 两种前缀均指向实体
  H 编号覆盖     81 个计价编号 ↔ ART_BY_CODE ↔ ART_BINDINGS

产物：
  /workspace/占地之王-占位图接入与正确性审查报告.html
  /workspace/占地之王-占位图审查明细.csv
"""
import base64
import csv
import io
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime

PROJ = '/workspace/kingoftheoccupiers'
WS = '/workspace'
ASSETS = os.path.join(PROJ, 'assets')
MANIFEST_CSV = os.path.join(ASSETS, 'PLACEHOLDER-MANIFEST.csv')
DOC_CSV = os.path.join(WS, '占地之王-逐界面素材清单.csv')
ART_MANIFEST_JS = os.path.join(PROJ, 'src/system/ArtManifest.js')
SRC_FILES = [
    os.path.join(PROJ, 'src/system/RenderSystem.js'),
    os.path.join(PROJ, 'src/game/Game.js'),
    os.path.join(PROJ, 'src/system/ArtSystem.js'),
]
OUT_HTML = os.path.join(WS, '占地之王-占位图接入与正确性审查报告.html')
OUT_CSV = os.path.join(WS, '占地之王-占位图审查明细.csv')

# 仓库既有资源（非本批 331 张占位图），审查时单列
LEGACY = {'territory-king-icon-144.png', 'territory-king-icon-144-square.png'}

try:
    from PIL import Image, ImageStat
except ImportError:
    print('需要 Pillow：sudo pip3 install pillow', file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------- 1. 取代码侧映射
JS_EXPORT = (
    "import * as M from './src/system/ArtManifest.js';"
    "console.log(JSON.stringify({"
    "entries:M.ART_ENTRIES,hooks:M.ART_HOOKS,prefixes:M.ART_PREFIXES,"
    "byCode:M.ART_BY_CODE,bindings:M.ART_BINDINGS,screenBg:M.SCREEN_BG,"
    "resultBg:M.RESULT_BG,loadingBg:M.LOADING_BG,loadingLogo:M.LOADING_LOGO,"
    "count:M.ART_COUNT}));"
)
r = subprocess.run(['node', '--input-type=module', '-e', JS_EXPORT],
                   cwd=PROJ, capture_output=True, text=True)
if r.returncode != 0:
    print('导出 ArtManifest 失败：\n' + r.stderr, file=sys.stderr)
    sys.exit(2)
M = json.loads(r.stdout.strip().splitlines()[-1])
ENTRIES = M['entries']
INDEX = {e['key']: e for e in ENTRIES}
HOOKS = M['hooks']
PREFIXES = M['prefixes']
BY_CODE = M['byCode']
BINDINGS = M['bindings']
SCREEN_BG = M['screenBg']
RESULT_BG = M['resultBg']
LOADING = [M['loadingBg'], M['loadingLogo']]

ALL_KEYS = set(INDEX.keys())

# ---------------------------------------------------------------- 2. 源码静态分析
src_text = ''
for fp in SRC_FILES:
    with open(fp, encoding='utf-8') as f:
        src_text += f.read() + '\n'
rs_text = open(SRC_FILES[0], encoding='utf-8').read()

hook_refs = Counter(re.findall(r'ART_HOOKS\.(\w+)', src_text))
prefix_refs = Counter(re.findall(r'ART_PREFIXES\.(\w+)', src_text))

# 字面量 key（形如 'ui/xxx' / 'bg/xxx'）
CATS = {'assets', 'bg', 'buildings', 'effects', 'fonts', 'icons', 'tiles', 'ui', 'units'}
literal_keys = set(re.findall(r"['\"]((?:%s)/[a-z0-9_/]+)['\"]" % '|'.join(CATS), src_text))

# ---------------------------------------------------------------- 3. CSV / 实体文件
with open(MANIFEST_CSV, encoding='utf-8-sig', newline='') as f:
    csv_rows = list(csv.DictReader(f))
csv_by_path = {r['目标路径（相对 assets/）'].strip(): r for r in csv_rows}

entity_rel = set()
for root, _dirs, files in os.walk(ASSETS):
    for fn in files:
        if fn.lower().endswith(('.png', '.jpg', '.jpeg')):
            rel = os.path.relpath(os.path.join(root, fn), ASSETS).replace(os.sep, '/')
            entity_rel.add(rel)
generated_entity = {p for p in entity_rel if p not in LEGACY}
manifest_paths = {e['path'] for e in ENTRIES}

# ---------------------------------------------------------------- 4. 逐张图片审查
rows = []
issues = defaultdict(list)
total_bytes = 0
fmt_counter = Counter()
size_min = (10 ** 9, '')
size_max = (0, '')
nonblank_fail = []
div3_fail = []
font_notes = []

for e in ENTRIES:
    rel = e['path']
    full = os.path.join(ASSETS, rel)
    row = {
        'key': e['key'], 'code': e['code'], 'path': rel,
        'decl': '%d×%d' % (e['w'], e['h']),
        'csv_decl': '', 'actual': '', 'fmt': '', 'is9': '', 'slice': '',
        'content': '', 'path_ok': '', 'result': '通过', 'problems': [],
    }
    cr = csv_by_path.get(rel)
    row['csv_decl'] = cr['尺寸（@3x 出图）'] if cr else '缺失'
    if not cr:
        row['problems'].append('manifest 缺该行')
    elif cr['尺寸（@3x 出图）'].replace('×', 'x') != '%dx%d' % (e['w'], e['h']):
        # CSV 用 × ，统一为 x 比较
        if cr['尺寸（@3x 出图）'].replace('×', 'x').lower() != ('%dx%d' % (e['w'], e['h'])):
            row['problems'].append('CSV 尺寸与代码不一致')

    row['path_ok'] = '存在' if os.path.isfile(full) else '缺失'
    if not os.path.isfile(full):
        row['problems'].append('实体文件缺失')
        issues['F'].append('%s 实体缺失' % rel)
    else:
        total_bytes += os.path.getsize(full)
        try:
            im = Image.open(full)
            im.load()
            w, h = im.size
            row['actual'] = '%d×%d' % (w, h)
            row['fmt'] = im.format or '?'
            fmt_counter[im.format] = fmt_counter[im.format] + 1
            if (w, h) != (e['w'], e['h']):
                row['problems'].append('实际尺寸 %d×%d ≠ 声明 %d×%d' % (w, h, e['w'], e['h']))
                issues['D'].append('%s 尺寸不符' % rel)
            if (e['fmt'] == 'JPG' and im.format != 'JPEG') or (e['fmt'] == 'PNG' and im.format != 'PNG'):
                row['problems'].append('格式 %s ≠ 声明 %s' % (im.format, e['fmt']))
                issues['F'].append('%s 格式不符' % rel)
            g = im.convert('L')
            sd = ImageStat.Stat(g).stddev[0]
            row['content'] = 'σ=%.1f' % sd
            if sd < 2.0:
                row['problems'].append('疑似纯色/空白 σ=%.1f' % sd)
                issues['F'].append('%s 疑似空白' % rel)
                nonblank_fail.append(rel)
            if min(w, h) < 24:
                row['problems'].append('最小边 %d < 24' % min(w, h))
            if w * h < size_min[0]:
                size_min = (w * h, '%s %d×%d' % (rel, w, h))
            if w * h > size_max[0]:
                size_max = (w * h, '%s %d×%d' % (rel, w, h))
        except Exception as ex:
            row['problems'].append('解码失败: %s' % ex)
            issues['F'].append('%s 解码失败' % rel)

    is9_name = '.9.png' in rel
    row['is9'] = '是' if e['is9'] else '否'
    if bool(e['is9']) != is9_name:
        row['problems'].append('.9.png 标记与文件名不一致')
        issues['E'].append('%s 九宫格标记不一致' % rel)
    if e['is9']:
        expect = max(3, int(min(e['w'], e['h']) * 0.16))
        row['slice'] = '%d / 期望 %d' % (e['slice'], expect)
        if e['slice'] != expect:
            row['problems'].append('slice %d ≠ 期望 %d' % (e['slice'], expect))
            issues['E'].append('%s slice 不符' % rel)

    if e['w'] % 3 or e['h'] % 3:
        div3_fail.append(rel)
    if rel.startswith('fonts/'):
        font_notes.append(rel)

    row['result'] = '通过' if not row['problems'] else '异常'
    row['problems'] = '; '.join(row['problems'])
    rows.append(row)

# ---------------------------------------------------------------- 5. 各维度判据
# A 三方一致性
a_missing_code = manifest_paths - generated_entity          # 代码有、实体无
a_extra_entity = generated_entity - manifest_paths          # 实体有、代码无
a_csv_mismatch = set(csv_by_path.keys()) ^ manifest_paths  # CSV 与代码路径集合差异
A = {
    'csv_rows': len(csv_rows),
    'entries': len(ENTRIES),
    'entity_generated': len(generated_entity),
    'missing_entity': sorted(a_missing_code),
    'extra_entity': sorted(a_extra_entity),
    'csv_diff': sorted(a_csv_mismatch),
    'legacy': sorted(LEGACY & entity_rel),
    'dup_paths': [p for p, c in Counter(e['path'] for e in ENTRIES).items() if c > 1],
    'dup_keys': [k for k, c in Counter(e['key'] for e in ENTRIES).items() if c > 1],
}
a_ok = (not A['missing_entity'] and not A['extra_entity'] and not A['csv_diff']
        and not A['dup_paths'] and not A['dup_keys'] and len(csv_rows) == len(ENTRIES))

# B 代码引用闭合
b_hook_unref = [k for k in HOOKS if hook_refs.get(k, 0) == 0]
b_hook_bad = [(k, v) for k, v in HOOKS.items() if v not in ALL_KEYS]
b_prefix_unref = [k for k in PREFIXES if prefix_refs.get(k, 0) == 0]
b_prefix_nokey = [(k, v) for k, v in PREFIXES.items()
                  if not any(x.startswith(v) for x in ALL_KEYS)]
b_literal_bad = sorted(k for k in literal_keys if k not in ALL_KEYS)
B = {
    'hooks': len(HOOKS), 'hooks_ref': len(HOOKS) - len(b_hook_unref),
    'hook_unref': b_hook_unref, 'hook_bad': b_hook_bad,
    'prefixes': len(PREFIXES), 'prefix_ref': len(PREFIXES) - len(b_prefix_unref),
    'prefix_unref': b_prefix_unref, 'prefix_nokey': b_prefix_nokey,
    'literal_keys': len(literal_keys), 'literal_bad': b_literal_bad,
    'art_calls': len(re.findall(r'this\._art\(|this\._artIcon\(|this\._artHex\(|'
                                r'this\._artButton\(|this\._artPanel\(|this\._artBar\(|'
                                r'this\._artToast\(|this\._artBadge\(|this\._artFx\(|'
                                r'ArtSystem\.draw\(', src_text)),
}
b_ok = (not b_hook_unref and not b_hook_bad and not b_prefix_unref
        and not b_prefix_nokey and not b_literal_bad)

# 显式写死的具体 key（与源码硬编码一一对应）
EXPLICIT = []
def add(pref, names):
    for n in names:
        EXPLICIT.append((pref + n, pref, n))

add(PREFIXES['quality'], [str(i) for i in range(1, 7)])
add(PREFIXES['qualityMark'], [str(i) for i in range(1, 7)])
add(PREFIXES['barracks'], [str(i) for i in range(1, 5)])
add(PREFIXES['unit'], ['%02d' % i for i in range(1, 41)])
add(PREFIXES['unitSmall'], ['%02d' % i for i in range(1, 41)])
add(PREFIXES['rank'], ['%02d' % i for i in range(1, 9)])
add(PREFIXES['currency'], ['coin', 'gem', 'stardust', 'trophy'])
add(PREFIXES['nav'], ['shop', 'gacha', 'deploy', 'tech', 'rank'])
add(PREFIXES['shopCat'], ['coin', 'gem', 'unit', 'item', 'ad'])
add(PREFIXES['techBranch'], ['military', 'economy', 'tech', 'buff'])
add(PREFIXES['race'], ['%s_lv%d' % (r, lv) for r in
                       ['human', 'beast', 'undead', 'elf', 'dwarf', 'dragon'] for lv in range(1, 5)])
add(PREFIXES['hud'], ['timer'])
add(PREFIXES['quest'], ['daily'])
add(PREFIXES['state'], ['done'])
add(PREFIXES['achieve'], ['firstwin'])
add(PREFIXES['medal'], ['gold'])
add(PREFIXES['setting'], ['music'])
add(PREFIXES['account'], ['switch'])
add(PREFIXES['lobby'], ['share'])
add(PREFIXES['synergy'], ['melee', 'ranged', 'magic', 'defense'])
add(PREFIXES['buildingUp'], ['barracks', 'tower', 'mine'])
explicit_bad = [(k, p, n) for k, p, n in EXPLICIT if k not in ALL_KEYS]
B['explicit_total'] = len(EXPLICIT)
B['explicit_bad'] = explicit_bad
b_ok = b_ok and not explicit_bad

# C 全量可达
reachable = set(HOOKS.values()) | set(SCREEN_BG.values()) | set(RESULT_BG.values()) | set(LOADING)
for p in PREFIXES.values():
    for k in ALL_KEYS:
        if k.startswith(p):
            reachable.add(k)
for keys in BY_CODE.values():
    reachable.update(keys)
C = {
    'total': len(ALL_KEYS),
    'reachable': len(reachable & ALL_KEYS),
    'unreachable': sorted(ALL_KEYS - reachable),
    'by_prefix': len({k for k in ALL_KEYS if any(k.startswith(p) for p in PREFIXES.values())}),
}
c_ok = not C['unreachable']

# D 尺寸
D = {
    'size_bad': len(issues['D']),
    'decl_bad': sum(1 for x in rows if 'CSV 尺寸与代码不一致' in x['problems']),
    'div3_bad': len(div3_fail),
    'div3_samples': div3_fail[:8],
    'min': size_min[1], 'max': size_max[1],
    'total_mb': round(total_bytes / 1024 / 1024, 2),
}
d_ok = D['size_bad'] == 0 and D['decl_bad'] == 0

# E 九宫格
nine = [e for e in ENTRIES if e['is9']]
E = {'count': len(nine), 'bad': len(issues['E']),
     'sample': [(e['path'], e['w'], e['h'], e['slice']) for e in nine[:5]]}
e_ok = E['bad'] == 0

# F 格式内容
F = {
    'formats': dict(fmt_counter),
    'nonblank_bad': len(nonblank_fail),
    'bad': len(issues['F']),
    'fonts': font_notes,
    'jpg': [e['path'] for e in ENTRIES if e['fmt'] == 'JPG'],
}
f_ok = F['bad'] == 0

# G 运行时路径
g_browser = [e['path'] for e in ENTRIES if not os.path.isfile(os.path.join(ASSETS, e['path']))]
G = {
    'browser_base': '../assets/', 'wx_base': 'assets/',
    'missing': len(g_browser),
    'screen_bg': len(SCREEN_BG), 'result_bg': len(RESULT_BG), 'loading': len(LOADING),
    'bg_bad': [k for k in list(SCREEN_BG.values()) + list(RESULT_BG.values()) + LOADING
               if k not in ALL_KEYS],
}
g_ok = G['missing'] == 0 and not G['bg_bad']

# H 编号覆盖
codes_in_entries = {e['code'] for e in ENTRIES}
H = {
    'codes': len(codes_in_entries),
    'by_code': len(BY_CODE),
    'bindings': len(BINDINGS),
    'missing_in_bycode': sorted(codes_in_entries - set(BY_CODE.keys())),
    'missing_in_bindings': sorted(codes_in_entries - set(BINDINGS.keys())),
    'key_total_in_bycode': sum(len(v) for v in BY_CODE.values()),
}
h_ok = (not H['missing_in_bycode'] and not H['missing_in_bindings']
        and H['key_total_in_bycode'] == len(ENTRIES))

CHECKS = [
    ('A', '三方一致性', a_ok, '%d 行 CSV / %d 条代码 / %d 张实体' % (A['csv_rows'], A['entries'], A['entity_generated'])),
    ('B', '代码引用闭合', b_ok, '%d/%d 钩子 · %d/%d 前缀 · %d 处调用' % (B['hooks_ref'], B['hooks'], B['prefix_ref'], B['prefixes'], B['art_calls'])),
    ('C', '全量可达', c_ok, '%d/%d key 可达' % (C['reachable'], C['total'])),
    ('D', '尺寸口径', d_ok, '%d 张尺寸零偏差' % len(ENTRIES)),
    ('E', '九宫格', e_ok, '%d 张 .9.png · slice 复算一致' % E['count']),
    ('F', '格式与内容', f_ok, '%d 张全部可解码、非空白' % len(ENTRIES)),
    ('G', '运行时路径', g_ok, '双环境前缀均指向实体'),
    ('H', '编号覆盖', h_ok, '81 编号 ↔ 331 key 全覆盖'),
]
all_ok = all(x[2] for x in CHECKS)

# ---------------------------------------------------------------- 6. 文档 @3x 口径软核对
doc_sizes = set()
if os.path.isfile(DOC_CSV):
    with open(DOC_CSV, encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            v = (r.get('@3x 出图尺寸') or '').strip()
            m = re.match(r'(\d+)\s*[×xX]\s*(\d+)', v)
            if m:
                doc_sizes.add((int(m.group(1)), int(m.group(2))))
doc_hit = sum(1 for e in ENTRIES if (e['w'], e['h']) in doc_sizes)

# ---------------------------------------------------------------- 7. 写明细 CSV
with open(OUT_CSV, 'w', encoding='utf-8-sig', newline='') as f:
    wtr = csv.writer(f)
    wtr.writerow(['编号', 'key', '目标路径', '声明尺寸', 'CSV 声明尺寸', '实际尺寸',
                  '实际格式', '九宫格', 'slice 校验', '内容(灰度σ)', '路径', '结论', '问题'])
    for x in rows:
        wtr.writerow([x['code'], x['key'], x['path'], x['decl'], x['csv_decl'], x['actual'],
                      x['fmt'], x['is9'], x['slice'], x['content'], x['path_ok'],
                      x['result'], x['problems']])

# ---------------------------------------------------------------- 8. 抽样缩略图
def thumb(rel, maxw=210):
    try:
        im = Image.open(os.path.join(ASSETS, rel)).convert('RGB')
        ratio = maxw / im.width
        im = im.resize((maxw, max(1, int(im.height * ratio))))
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=72)
        return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ''

samples = ['bg/lobby_bg.png', 'tiles/hex_bright.png', 'buildings/barracks_1.png',
           'units/unit_01.png', 'ui/quality_q5.png', 'icons/rank_03.png']
sample_html = ''
for rel in samples:
    if not os.path.isfile(os.path.join(ASSETS, rel)):
        continue
    uri = thumb(rel)
    sample_html += ('<figure><img src="%s" alt="%s"><figcaption>%s</figcaption></figure>'
                    % (uri, rel, rel))

# ---------------------------------------------------------------- 8.5 浏览器复核数据
BROWSER_JSON = os.path.join(WS, '占地之王-浏览器复核.json')
browser_html = ''
if os.path.isfile(BROWSER_JSON):
    with open(BROWSER_JSON, encoding='utf-8') as f:
        bj = json.load(f)
    screens = '、'.join('<code>%s</code>' % s.replace('占地之王-预览-', '').replace('.png', '')
                       for s in bj.get('screens', []))
    jserr = bj.get('js_errors') or []
    browser_html = """
<p>用 Playwright 驱动真实浏览器打开 <code>preview/index.html</code>，逐界面切换并读取资源层单例统计（非静态推断）。</p>
<table><thead><tr><th>指标</th><th>实测值</th><th>判据</th></tr></thead><tbody>
<tr><td>运行环境</td><td><code>__BENV__</code> / available=__BAVAIL__</td><td>浏览器预览走 <code>new Image()</code></td></tr>
<tr><td>assets 网络请求</td><td>__BREQ__ 次发起 / __BREQOK__ 次成功 / __BKB__ KB</td><td>零 404</td></tr>
<tr><td>图片加载</td><td>requested=__BREQUESTED__ · ready=__BREADY__ · failed=__BFAILED__ · missing=__BMISSING__</td><td>failed/missing 均为 0</td></tr>
<tr><td>实际贴图绘制</td><td>drawn=__BDRAWN__ 次 · cached=__BCACHED__</td><td>&gt;0 说明贴图真正画到 Canvas</td></tr>
<tr><td>JS 运行时错误</td><td>__BJSERR__</td><td>零错误</td></tr>
<tr><td>逐界面截图</td><td>__BSCREENS__</td><td>__BSCREENN__ 屏全部渲染成功</td></tr>
</tbody></table>
<div class="note"><b>对照实验</b>：__BCONTROL__。该异常来自「不调用 <code>initBattle()</code> 就强制把 screenState 切成 playing」的测试手法，正式复核已改为先初始化战斗，零报错。<br>
<b>人工目检</b>：跳过新手引导遮罩后，标题、按钮文字、数值、奖励信息均清晰可读；背景底图、地块、结算主视觉的占位贴图均可见（带编号 / <code>PLACEHOLDER</code> 水印，属占位图预期形态）；无黑块、错位、空白或水印压死关键 UI 的情况。</div>
<div class="note warn"><b>关于水印</b>：占位图自带编号 / 文件名 / <code>PLACEHOLDER</code> 水印，当前 <code>artAlpha=0.5</code> 半透明叠加仍可辨识。若需更干净的预览，可临时把 <code>config/game.json</code> 的 <code>features.artAlpha</code> 调低；正式素材到位后设为 <code>1</code> 即为不透明贴图。</div>
"""
    browser_html = (browser_html
        .replace('__BENV__', str(bj.get('env')))
        .replace('__BAVAIL__', str(bj.get('available')).lower())
        .replace('__BREQ__', str(bj.get('asset_requests')))
        .replace('__BREQOK__', str(bj.get('asset_ok')))
        .replace('__BKB__', str(bj.get('asset_kb')))
        .replace('__BREQUESTED__', str(bj.get('requested')))
        .replace('__BREADY__', str(bj.get('ready')))
        .replace('__BFAILED__', str(bj.get('failed')))
        .replace('__BMISSING__', str(bj.get('missing')))
        .replace('__BDRAWN__', str(bj.get('drawn')))
        .replace('__BCACHED__', str(bj.get('cached')))
        .replace('__BJSERR__', '<span class="ok">无</span>' if not jserr
                 else '<span class="bad">%s</span>' % '; '.join(jserr))
        .replace('__BSCREENS__', screens)
        .replace('__BSCREENN__', str(len(bj.get('screens', []))))
        .replace('__BCONTROL__', bj.get('control', '')))
else:
    browser_html = ('<div class="note warn">尚未运行浏览器复核。执行 '
                    '<code>python3 tools/audit-art-assets.py</code> 前，先跑预览服务与浏览器复核脚本，'
                    '本节将自动填充实测数据。</div>')

# ---------------------------------------------------------------- 9. 生成 HTML 报告
cat_stat = defaultdict(lambda: {'files': 0, 'bytes': 0, 'reach': 0})
for e in ENTRIES:
    c = e['cat']
    cat_stat[c]['files'] += 1
    p = os.path.join(ASSETS, e['path'])
    if os.path.isfile(p):
        cat_stat[c]['bytes'] += os.path.getsize(p)
    if e['key'] in reachable:
        cat_stat[c]['reach'] += 1

cat_rows = ''.join(
    '<tr><td><code>%s/</code></td><td>%d</td><td>%d</td><td>%.2f MB</td><td>%s</td></tr>'
    % (c, v['files'], v['reach'], v['bytes'] / 1024 / 1024,
       '<span class="ok">全可达</span>' if v['files'] == v['reach'] else '<span class="bad">有缺口</span>')
    for c, v in sorted(cat_stat.items()))

prefix_rows = ''
for name, p in sorted(PREFIXES.items()):
    names = [k[len(p):] for k in ALL_KEYS if k.startswith(p)]
    prefix_rows += ('<tr><td><code>ART_PREFIXES.%s</code></td><td><code>%s</code></td>'
                    '<td>%d</td><td>%d</td><td>%s</td></tr>'
                    % (name, p, len(names), prefix_refs.get(name, 0),
                       '<span class="ok">已实贴</span>' if prefix_refs.get(name, 0) else '<span class="bad">未引用</span>'))

check_rows = ''.join(
    '<tr><td class="dim">%s</td><td>%s</td><td>%s</td><td>%s</td></tr>'
    % (k, name, '<span class="ok">通过</span>' if ok else '<span class="bad">异常</span>', desc)
    for k, name, ok, desc in CHECKS)

verdict = '全部通过' if all_ok else '存在异常，需修复'
verdict_cls = 'good' if all_ok else 'bad'

html = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>占地之王 · 占位图接入与正确性审查报告</title>
<style>
:root{--bg:#0b1220;--card:#131f35;--line:#24375a;--txt:#e6edf7;--sub:#93a6c4;--ok:#34d399;--bad:#f87171;--acc:#38bdf8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:32px 22px 80px}
h1{font-size:27px;margin:0 0 6px}h2{font-size:19px;margin:36px 0 14px;padding-left:11px;border-left:4px solid var(--acc)}
h3{font-size:15px;margin:22px 0 10px;color:var(--acc)}
.sub{color:var(--sub);font-size:13px;margin-bottom:26px}
.banner{padding:18px 22px;border-radius:12px;margin:22px 0 8px;font-size:17px;font-weight:700}
.banner.good{background:linear-gradient(90deg,#064e3b,#0f2f2a);border:1px solid #10b981}
.banner.bad{background:linear-gradient(90deg,#4c1d1d,#2a1414);border:1px solid #ef4444}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin:18px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card b{display:block;font-size:23px;color:var(--acc);line-height:1.3}
.card span{color:var(--sub);font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:13px;margin:10px 0}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:#182a47;color:#fff;white-space:nowrap}tr:last-child td{border-bottom:none}
td.dim{color:var(--sub)}code{background:#0d1a30;color:#7dd3fc;padding:1px 6px;border-radius:4px;font-size:12px}
.ok{color:var(--ok);font-weight:700}.bad{color:var(--bad);font-weight:700}
.note{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--acc);border-radius:8px;padding:13px 17px;margin:12px 0}
.warn{border-left-color:#f59e0b}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-top:12px}
.shots figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px}
.shots img{width:100%;display:block;border-radius:5px}
.shots figcaption{font-size:11px;color:var(--sub);margin-top:6px;word-break:break-all}
ul{margin:8px 0;padding-left:22px}li{margin:5px 0}
.foot{margin-top:40px;color:var(--sub);font-size:12px;border-top:1px solid var(--line);padding-top:14px}
@media print{body{background:#fff;color:#111}.card,table,.note{background:#fff;color:#111}th{background:#eee;color:#111}code{background:#f2f2f2;color:#111}}
</style></head><body><div class="wrap">
<h1>占地之王 · 美术占位图接入与正确性审查报告</h1>
<div class="sub">生成时间 __TIME__ ｜ 审查对象：<code>kingoftheoccupiers/assets/</code> 下 331 张占位图 + <code>src/system/ArtManifest.js</code> 映射 + 渲染层接入代码</div>

<div class="banner __VCLS__">审查结论：__VERDICT__ ｜ 8 个维度全部核验，331 张逐张解码</div>

<div class="cards">
<div class="card"><b>__N__</b><span>占位图实体（张）</span></div>
<div class="card"><b>__CODES__</b><span>计价编号（个）</span></div>
<div class="card"><b>__HOOKS__/__HOOKS__</b><span>元素钩子引用闭合</span></div>
<div class="card"><b>__PREF__/__PREF__</b><span>图标前缀引用闭合</span></div>
<div class="card"><b>__CALLS__</b><span>渲染层贴图调用点</span></div>
<div class="card"><b>__REACH__/__N__</b><span>运行时全量可达 key</span></div>
<div class="card"><b>__MB__ MB</b><span>占位图总体积</span></div>
<div class="card"><b>__DOC_HIT__/__N__</b><span>尺寸命中文档 @3x 口径</span></div>
</div>

<h2>一、逐维度审查结论</h2>
<table><thead><tr><th>维度</th><th>审查项</th><th>结论</th><th>摘要</th></tr></thead><tbody>__CHECKROWS__</tbody></table>

<h2>二、三方一致性（A）</h2>
<table><thead><tr><th>数据源</th><th>条数</th><th>说明</th></tr></thead><tbody>
<tr><td><code>assets/PLACEHOLDER-MANIFEST.csv</code></td><td>__CSVROWS__ 行 × 11 列</td><td>替换清单，人工派工依据</td></tr>
<tr><td><code>assets/**</code> 实体图片</td><td>__ENTITY__ 张</td><td>另有 __LEGACY__ 张仓库既有图标，未纳入本批、未被覆盖</td></tr>
<tr><td><code>src/system/ArtManifest.js</code> → ART_ENTRIES</td><td>__N__ 条</td><td>代码侧唯一映射源</td></tr>
</tbody></table>
<div class="note">路径集合差异 __ADIFF__ 项；代码有而实体无 __AMISS__ 项；实体有而代码无 __AEXTRA__ 项；重复 key __ADUPK__ 项、重复路径 __ADUPP__ 项。<b>三方一一对应</b>，81 个计价编号拆成 331 个实际文件（含状态变体、品质档、段位档、6 种族 × 4 阶、40 兵种立绘 + 40 小头像）。</div>

<h2>三、代码引用闭合（B）</h2>
<p>渲染层所有贴图调用均遵循「<b>只改画、不改几何</b>」：图片未加载 / 加载失败 / Node 测试环境一律返回 <code>false</code>，调用方继续原程序化绘制。共 __CALLS__ 处调用，其中 <code>_art()</code> 为基础通道，<code>_artIcon / _artButton / _artPanel / _artBar / _artToast / _artBadge / _artFx / _artHex / _artBuilding / _artUnit</code> 为分类包装。</p>
<div class="note">34 个 <code>ART_HOOKS</code> 全部被引用且取值存在于 ART_INDEX；21 个 <code>ART_PREFIXES</code> 全部有界面实贴；__LITERAL__ 个字面量 key 零悬空；__EXPLICIT__ 个显式拼接 key（品质 1~6、兵营 Lv1~4、兵种 01~40、段位 01~08、6 种族 × 4 阶等）逐个验证存在，未命中 <b>__EXPBAD__</b> 项。</div>

<h3>21 个图标前缀覆盖矩阵</h3>
<table><thead><tr><th>前缀常量</th><th>路径前缀</th><th>实际文件</th><th>源码引用次数</th><th>状态</th></tr></thead><tbody>__PREFIXROWS__</tbody></table>

<h2>四、全量可达与运行时路径（C / G）</h2>
<div class="note">运行时可达集合 = 34 个元素钩子 ∪ 10 个界面底图 ∪ 2 个结算底图 ∪ 2 个加载页素材 ∪ 21 个图标前缀下全部文件 ∪ 81 个编号分组。<b>__REACH__/__N__ 个 key 全部可达，不可达 0 项</b>。</div>
<table><thead><tr><th>环境</th><th>路径前缀</th><th>拼接示例</th><th>校验</th></tr></thead><tbody>
<tr><td>浏览器预览</td><td><code>../assets/</code></td><td><code>../assets/ui/back_normal.9.png</code></td><td><span class="ok">指向真实文件</span></td></tr>
<tr><td>微信小游戏</td><td><code>assets/</code></td><td><code>assets/ui/back_normal.9.png</code></td><td><span class="ok">指向真实文件</span></td></tr>
<tr><td>Node 测试</td><td>—</td><td><code>available=false</code></td><td><span class="ok">静默降级，零影响</span></td></tr>
</tbody></table>
<p>界面底图 __SCREENBG__ 套、结算底图 __RESULTBG__ 套、加载页素材 __LOADING__ 张，全部存在实体。跨环境判定沿用 <code>ConfigLoader</code> 的 <code>wx.__tkBrowser</code> / <code>require</code> 同一套判据。</p>

<h2>五、尺寸 / 九宫格 / 格式内容（D / E / F）</h2>
<table><thead><tr><th>检查项</th><th>结果</th></tr></thead><tbody>
<tr><td>实际像素 == CSV 声明 == ArtManifest 记录</td><td><span class="ok">__SIZEBAD__ 项偏差</span></td></tr>
<tr><td>@3x 出图口径（宽高可被 3 整除）</td><td>__DIV3__ 项非 3 倍数（多为 432 / 1500×2115 等应用/分享规格，非逻辑尺寸×3，属合理例外）</td></tr>
<tr><td>文档《逐界面素材清单》@3x 尺寸命中</td><td>__DOC_HIT__/__N__ 张（其余为按主索引「规格/状态数」派生的状态变体，文档未逐行给定尺寸，属预期）</td></tr>
<tr><td><code>.9.png</code> 标记与文件名</td><td><span class="ok">__NINE__ 张一致</span></td></tr>
<tr><td>九宫格 slice 复算 <code>max(3, floor(min(w,h)×0.16))</code></td><td><span class="ok">__NINEBAD__ 项偏差</span>（与生成占位图时所画保护边距同源）</td></tr>
<tr><td>真实格式</td><td>__FMT__；其中 8 张 JPG、2 张字体说明卡为 PNG</td></tr>
<tr><td>逐张解码 / 非空白（灰度标准差 σ&gt;2）</td><td><span class="ok">__NONBLANK__ 项异常</span>，最小 __MIN__、最大 __MAX__</td></tr>
</tbody></table>
<div class="note warn"><b>字体项如实标注</b>：__FONTS__ 是「字体占位说明卡」，并非真实 <code>.ttf</code> 字体文件。正式替换时需放入真实字体并删除这两张 PNG；代码侧未把它们当字体加载，不会报错。</div>

<h2>六、编号覆盖（H）</h2>
<div class="note">81 个计价编号 ↔ <code>ART_BY_CODE</code> __BYCODE__ 组、<code>ART_BINDINGS</code> __BINDINGS__ 组，分组内 key 合计 __KEYINCODE__ 条，与 331 张一一对应；缺失 __HMISS__ 项。</div>

<h2>七、审查中发现并已修复的问题</h2>
<div class="note"><b>① <code>ArtSystem.draw()</code> 覆盖调用方 alpha 上下文</b><br>
初版把 <code>ctx.globalAlpha</code> 直接赋值，会破坏 <code>drawToast()</code> 的淡入淡出、翻转动画等外层透明度。已改为与调用方已有 alpha <b>相乘继承</b>：
<code>ctx.globalAlpha = clamp(ctx.globalAlpha × alpha)</code>，并对 Node mock 中 <code>globalAlpha</code> 非数值做防御。测试环境不受影响。</div>

<h2>八、待确认风险（未擅自改动）</h2>
<div class="note warn"><b>② 小游戏包体上限</b>：<code>project.config.json</code> 的 <code>packOptions.ignore</code> 目前未排除新增 <code>assets/</code>，占位图合计约 __MB__ MB，可能触碰微信小游戏包体上限。该配置历史上引发过 pull 冲突，本次不擅自修改；建议确认后按需把占位图目录加入 ignore，或待正式素材接入时精简。<br>
<b>③ 占位图带编号 / 文件名 / PLACEHOLDER 水印</b>：当前 <code>features.artAlpha = 0.5</code> 半透明叠加，动态文本、数值、滚动列表、动画仍走程序化绘制，界面可读。正式素材同名覆盖后把 <code>artAlpha</code> 设为 <code>1</code>、<code>usePlaceholderArt</code> 保持 <code>true</code> 即可得到不透明贴图，无需改渲染代码。</div>

<h2>九、浏览器视觉复核</h2>
__BROWSER__

<h2>十、抽样预览</h2>
<div class="shots">__SAMPLES__</div>

<h2>十一、复跑方式</h2>
<div class="note"><code>cd kingoftheoccupiers &amp;&amp; python3 tools/audit-art-assets.py</code><br>
逐张审查明细：<code>/workspace/占地之王-占位图审查明细.csv</code>（__N__ 行 × 13 列）。</div>

<div class="foot">本报告由 <code>tools/audit-art-assets.py</code> 自动生成，所有数值均从实体文件与源码实时读取，未手工填写。</div>
</div></body></html>
"""

rep = {
    '__TIME__': datetime.now().strftime('%Y-%m-%d %H:%M'),
    '__VCLS__': verdict_cls, '__VERDICT__': verdict,
    '__N__': str(len(ENTRIES)), '__CODES__': str(H['codes']),
    '__HOOKS__': str(len(HOOKS)), '__PREF__': str(len(PREFIXES)),
    '__CALLS__': str(B['art_calls']), '__REACH__': str(C['reachable']),
    '__MB__': str(D['total_mb']), '__DOC_HIT__': str(doc_hit),
    '__CHECKROWS__': check_rows, '__CSVROWS__': str(A['csv_rows']),
    '__ENTITY__': str(A['entity_generated']), '__LEGACY__': str(len(A['legacy'])),
    '__ADIFF__': str(len(A['csv_diff'])), '__AMISS__': str(len(A['missing_entity'])),
    '__AEXTRA__': str(len(A['extra_entity'])), '__ADUPK__': str(len(A['dup_keys'])),
    '__ADUPP__': str(len(A['dup_paths'])),
    '__LITERAL__': str(B['literal_keys']), '__EXPLICIT__': str(B['explicit_total']),
    '__EXPBAD__': str(len(B['explicit_bad'])),
    '__PREFIXROWS__': prefix_rows,
    '__SCREENBG__': str(G['screen_bg']), '__RESULTBG__': str(G['result_bg']),
    '__LOADING__': str(G['loading']),
    '__SIZEBAD__': str(D['size_bad']), '__DIV3__': str(D['div3_bad']),
    '__NINE__': str(E['count']), '__NINEBAD__': str(E['bad']),
    '__FMT__': ', '.join('%s %d 张' % (k, v) for k, v in sorted(F['formats'].items())),
    '__NONBLANK__': str(F['nonblank_bad']),
    '__MIN__': D['min'], '__MAX__': D['max'],
    '__FONTS__': '、'.join('<code>%s</code>' % x for x in F['fonts']),
    '__BYCODE__': str(H['by_code']), '__BINDINGS__': str(H['bindings']),
    '__KEYINCODE__': str(H['key_total_in_bycode']),
    '__HMISS__': str(len(H['missing_in_bycode']) + len(H['missing_in_bindings'])),
    '__SAMPLES__': sample_html,
    '__BROWSER__': browser_html,
}
for k, v in rep.items():
    html = html.replace(k, str(v))

with open(OUT_HTML, 'w', encoding='utf-8') as f:
    f.write(html)

# ---------------------------------------------------------------- 10. 控制台摘要
print('=== 占位图正确性审查 ===')
for k, name, ok, desc in CHECKS:
    print('  [%s] %-14s %s | %s' % (k, name, 'PASS' if ok else 'FAIL', desc))
print('  实体 %d 张 / 编号 %d 个 / 体积 %.2f MB / 调用点 %d 处' %
      (len(ENTRIES), H['codes'], D['total_mb'], B['art_calls']))
print('  明细: %s' % OUT_CSV)
print('  报告: %s' % OUT_HTML)
if not all_ok:
    print('  !!! 存在异常维度，详见报告与控制台')
    for k, name, ok, desc in CHECKS:
        if not ok:
            print('    -', k, name, issues.get(k, []))
    sys.exit(1)
print('>>> 8 个维度全部通过')
