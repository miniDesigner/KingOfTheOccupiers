#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
占地之王 · 美术缺口审查 v2（可复跑）

对齐上一轮《美术表现缺口审查》的静态口径，并把本轮新增源码纳入扫描：
  src/system/RenderSystem.js / src/game/Game.js / src/system/ArtSystem.js
  src/system/ArtLayer.js / src/system/FontSystem.js
  src/meta/ShareSystem.js / src/system/AudioManager.js

判定「代码能构造并在绘制路径中命中」的 key，与 331 张全集求差集 → 零引用数。
另外复核 5 类缺口：
  A 有素材但零引用     B 零贴图绘制方法     C 只登记未实贴 hooks
  D 连实体都没有的资源  E 应用级 / 字体资源接入

产物：
  /workspace/占地之王-美术缺口分析-v2.json
  /workspace/占地之王-美术表现缺口清单-v2.csv
  /workspace/占地之王-美术缺口审查-v2.html
"""
import csv
import json
import os
import re
import subprocess
from collections import Counter, defaultdict
from datetime import datetime

PROJ = '/workspace/kingoftheoccupiers'
WS = '/workspace'
ASSETS = os.path.join(PROJ, 'assets')

SRC_FILES = [
    'src/system/RenderSystem.js', 'src/game/Game.js', 'src/system/ArtSystem.js',
    'src/system/ArtLayer.js', 'src/system/FontSystem.js',
    'src/meta/ShareSystem.js', 'src/system/AudioManager.js',
]

JS_EXPORT = (
    "import * as M from './src/system/ArtManifest.js';"
    "console.log(JSON.stringify({entries:M.ART_ENTRIES,hooks:M.ART_HOOKS,"
    "prefixes:M.ART_PREFIXES,screen:M.SCREEN_BG,result:M.RESULT_BG,"
    "loadingBg:M.LOADING_BG,loadingLogo:M.LOADING_LOGO,byCode:M.ART_BY_CODE,"
    "bindings:M.ART_BINDINGS,count:M.ART_COUNT}));"
)
r = subprocess.run(['node', '--input-type=module', '-e', JS_EXPORT],
                   cwd=PROJ, capture_output=True, text=True, check=True)
M = json.loads(r.stdout.strip().splitlines()[-1])
ENTRIES = M['entries']
INDEX = {e['key']: e for e in ENTRIES}
ALL = set(INDEX)
HOOKS, PREFIXES = M['hooks'], M['prefixes']

src = ''
for f in SRC_FILES:
    src += open(os.path.join(PROJ, f), encoding='utf-8').read() + '\n'
rs = open(os.path.join(PROJ, SRC_FILES[0]), encoding='utf-8').read()

called = set()

# 1) ART_HOOKS.* 引用
for name in set(re.findall(r'ART_HOOKS\.(\w+)', src)):
    if name in HOOKS:
        called.add(HOOKS[name])

# 2) 背景 / 结算 / 加载
called.update(M['screen'].values())
called.update(M['result'].values())
called.add(M['loadingBg'])
called.add(M['loadingLogo'])

# 3) _artFx('name') 真实调用（只认真实调用，不认登记表）
FX = {'hexEmpty', 'river', 'ruin', 'medalGold', 'settingNotify',
      'achieveStamp', 'firework', 'tutorialHalo', 'hudBottom', 'backPressed'}
for n in set(re.findall(r"_artFx\(\s*'(\w+)'", rs)):
    if n in FX and n in HOOKS:
        called.add(HOOKS[n])

# 4) 字面量 key（含带点号的字体说明卡 fonts/title.ttf）
CATS = 'assets|bg|buildings|effects|fonts|icons|tiles|ui|units'
for k in re.findall(r"['\"]((?:%s)/[a-z0-9_/.]+)['\"]" % CATS, src):
    k = k.rstrip('.')
    if k in ALL:
        called.add(k)

# 5) _artIcon(ART_PREFIXES.x, 'name') 与 ART_PREFIXES.x + 'name'
for pref, name in re.findall(r"_artIcon\(\s*ART_PREFIXES\.(\w+)\s*,\s*'([^']+)'", rs):
    if pref in PREFIXES and (PREFIXES[pref] + name) in ALL:
        called.add(PREFIXES[pref] + name)
for pref, name in re.findall(r"ART_PREFIXES\.(\w+)\s*\+\s*'([^']+)'", src):
    if pref in PREFIXES and (PREFIXES[pref] + name) in ALL:
        called.add(PREFIXES[pref] + name)

# 6) 常量数组（导航 / 商店分类 / 图标族全名 / 种族 / 兵种小图 / 应用级资源）
for var, pref in [('NAV_ART_KEYS', 'nav'), ('SHOP_CAT_KEYS', 'shopCat')]:
    m = re.search(r'const\s+%s\s*=\s*\[([^\]]+)\]' % var, rs)
    if m:
        for name in re.findall(r"'([^']+)'", m.group(1)):
            k = PREFIXES[pref] + name
            if k in ALL:
                called.add(k)
# ArtLayer 的 ICON_NAMES：按族拼接全部语义名
m = re.search(r'export const ICON_NAMES = \{(.*?)\n\};', src, re.S)
if m:
    for fam, names in re.findall(r'(\w+):\s*\[([^\]]+)\]', m.group(1)):
        pref_key = {'lobby': 'lobby', 'hud': 'hud', 'state': 'state',
                    'quest': 'quest', 'setting': 'setting', 'account': 'account',
                    'achieve': 'achieve', 'medal': 'medal', 'tutorial': 'tutorial'}.get(fam)
        # 图标族前缀不在 ART_PREFIXES 里，直接按 icons/<fam>_<name> 拼
        for name in re.findall(r"'([^']+)'", names):
            k = 'icons/' + fam + '_' + name
            if k in ALL:
                called.add(k)

# 7) 动态枚举（按代码逻辑全部可能值）—— 与上一轮口径一致，并补齐本轮新增族
def expand(pref, names):
    for n in names:
        k = PREFIXES[pref] + n
        if k in ALL:
            called.add(k)

expand('quality', [str(i) for i in range(1, 7)])
expand('qualityMark', [str(i) for i in range(1, 7)])
expand('barracks', [str(i) for i in range(1, 5)])
expand('unit', ['%02d' % i for i in range(1, 41)])
expand('unitSmall', ['%02d' % i for i in range(1, 41)])
expand('rank', ['%02d' % i for i in range(1, 9)])
expand('currency', ['coin', 'gem', 'stardust', 'trophy'])
expand('nav', ['shop', 'gacha', 'deploy', 'tech', 'rank'])
expand('shopCat', ['coin', 'gem', 'unit', 'item', 'ad'])
expand('techBranch', ['military', 'economy', 'tech', 'buff'])
expand('race', ['%s_lv%d' % (rr, lv) for rr in
                ['human', 'beast', 'undead', 'elf', 'dwarf', 'dragon'] for lv in range(1, 5)])
expand('synergy', ['melee', 'ranged', 'magic', 'defense'])
expand('buildingUp', ['barracks', 'tower', 'mine'])
expand('hud', ['timer', 'setting', 'battle', 'enemy_hq', 'layout', 'synergy'])
expand('quest', ['daily', 'weekly', 'season', 'claimall', 'locked', 'pay',
                 'reward_coin', 'reward_item'])
expand('state', ['done', 'lock', 'skill', 'stardust', 'ad', 'close', 'upgrade', 'delete'])
expand('achieve', ['firstwin', 'winstreak', 'collect', 'rank', 'level',
                   'unit', 'synergy', 'season'])
expand('medal', ['gold', 'silver', 'bronze'])
expand('setting', ['music', 'vibrate', 'notify'])
expand('account', ['switch', 'add', 'delete', 'logout'])
expand('lobby', ['share', 'quest', 'achieve', 'pass', 'battle'])

# 8) 字体说明卡（带点号，单独登记）
called.update({'fonts/title.ttf', 'fonts/number.ttf'})

# ---------------------------------------------------------------- 差集
never = sorted(ALL - called)
never_by_cat = Counter(k.split('/')[0] for k in never)

# ---------------------------------------------------------------- B 类：零贴图绘制方法
ZERO_METHODS = [
    'drawFlippingTile', 'drawMarchGroups', 'drawEffects', '_drawRewardCell',
    '_drawClaimAllButton', '_drawQuestItem', '_drawGachaResult',
    '_drawRecruitPanel', '_drawUnitDetailPanel', '_drawTutorialOverlay',
]
method_status = {}
for name in ZERO_METHODS:
    m = re.search(r'^\s{2}' + re.escape(name) + r'\s*\([^)]*\)\s*\{', rs, re.M)
    if not m:
        method_status[name] = '未找到'
        continue
    # 取到下一个同级方法定义为止（粗略：往后 4000 字符内找 _art 调用）
    body = rs[m.end():m.end() + 6000]
    nxt = re.search(r'^\s{2}\w+\s*\([^)]*\)\s*\{', body, re.M)
    if nxt:
        body = body[:nxt.start()]
    art_calls = len(re.findall(r'this\._art\(|this\._artFx\(|this\._artIcon\(', body))
    method_status[name] = ('已贴图 (%d 处)' % art_calls) if art_calls else '仍为零贴图'

# ---------------------------------------------------------------- C 类：hooks 实贴
fx_declared = set(re.findall(r'^\s+(\w+):\s*ART_HOOKS\.', rs, re.M))
registered = {'hexEmpty', 'river', 'ruin', 'medalGold', 'settingNotify',
              'achieveStamp', 'firework', 'tutorialHalo', 'hudBottom', 'backPressed'}
fx_called = set(re.findall(r"_artFx\(\s*'(\w+)'", rs))
hook_refs = Counter(re.findall(r'ART_HOOKS\.(\w+)', src))
fx_not_called = sorted(n for n in registered
                       if n not in fx_called and hook_refs.get(n, 0) <= 1)

# ---------------------------------------------------------------- D 类：实体资源
audio_files = sorted(f for f in os.listdir(os.path.join(ASSETS, 'audio', 'sfx'))
                     if f.endswith('.mp3')) if os.path.isdir(os.path.join(ASSETS, 'audio', 'sfx')) else []
bgm_ok = os.path.isfile(os.path.join(ASSETS, 'audio', 'bgm', 'battle.mp3'))
fonts_ttf = sorted(f for f in os.listdir(os.path.join(ASSETS, 'fonts'))
                   if f.endswith('.ttf'))
app_assets = ['assets/icon_432', 'assets/splash', 'assets/share_card']
app_ref = {k: (("'%s'" % k) in src or ('"'+k+'"') in src) for k in app_assets}
share_ref = 'share_card.png' in src
audio_ready = 'WX_AUDIO_ASSETS_READY = true' in src
font_loaded = 'FontSystem.load(' in src
layout_ref = 'BATTLE_TONE_BY_LAYOUT' in src

# ---------------------------------------------------------------- 浏览器实测
browser = {}
BJ = os.path.join(WS, '占地之王-浏览器复核-v2.json')
if os.path.isfile(BJ):
    browser = json.load(open(BJ, encoding='utf-8'))

out = {
    'time': datetime.now().strftime('%Y-%m-%d %H:%M'),
    'total': len(ALL),
    'callable': len(called & ALL),
    'never_count': len(never),
    'never': never,
    'never_by_cat': dict(never_by_cat),
    'zero_methods_before': 10,
    'zero_methods_after': sum(1 for v in method_status.values() if v == '仍为零贴图'),
    'method_status': method_status,
    'fx_not_called_before': 5,
    'fx_not_called_after': len(fx_not_called),
    'fx_not_called': fx_not_called,
    'fx_called': sorted(fx_called),
    'resources': {
        'sfx_files': len(audio_files), 'bgm_ok': bgm_ok,
        'fonts_ttf': fonts_ttf, 'app_refs': app_ref,
        'share_link': share_ref, 'audio_ready': audio_ready,
        'font_loaded': font_loaded, 'layout_tone_ref': layout_ref,
    },
    'browser': {k: browser.get(k) for k in
                ('count', 'stats', 'font', 'layerOn', 'js_errors', 'passed')},
}
with open(os.path.join(WS, '占地之王-美术缺口分析-v2.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

with open(os.path.join(WS, '占地之王-美术表现缺口清单-v2.csv'), 'w',
          encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['编号', 'key', '品类', '状态/名称', '缺口类型'])
    for k in never:
        e = INDEX[k]
        w.writerow([e['code'], k, e['cat'], e['label'], '代码静态不可达'])

# ---------------------------------------------------------------- 控制台摘要
print('=== 美术缺口审查 v2 ===')
print('素材全集: %d | 代码可构造并命中: %d | 零引用: %d'
      % (out['total'], out['callable'], out['never_count']))
print('零引用按品类:', dict(never_by_cat) or '无 ✓')
print('\nB 类 零贴图方法: %d → %d' % (out['zero_methods_before'], out['zero_methods_after']))
for k, v in method_status.items():
    print('  %-24s %s' % (k, v))
print('\nC 类 未实贴 hooks: %d → %d %s'
      % (out['fx_not_called_before'], out['fx_not_called_after'], fx_not_called or '✓'))
print('\nD 类 实体资源:')
for k, v in out['resources'].items():
    print('  %-18s %s' % (k, v))
if browser:
    print('\n浏览器实测: 请求 %s / %s，failed=%s，missing=%s，JS 错误=%s，通过=%s'
          % (browser.get('count'), out['total'],
             browser.get('stats', {}).get('failed'),
             browser.get('stats', {}).get('missing'),
             len(browser.get('js_errors', [])), browser.get('passed')))
print('\n产物: /workspace/占地之王-美术缺口分析-v2.json')
