#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
占地之王 · 浏览器美术接入复核（可复跑）

用 Playwright 驱动真实浏览器打开 preview/index.html，逐界面 / 子状态切换，
读取 ArtSystem 单例的运行时统计，验证「贴图真的画到 Canvas」而非静态推断。

前置：python3 preview-server.py （端口 8890）
用法：python3 tools/audit-art-browser.py

产物：
  /workspace/占地之王-浏览器复核-v2.json
  /workspace/占地之王-预览-v2-*.png（逐界面截图）
"""
import json
import os
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8890/preview/index.html'
WS = '/workspace'
OUT_JSON = os.path.join(WS, '占地之王-浏览器复核-v2.json')
OUT_PNG = os.path.join(WS, '占地之王-预览-v2-{:02d}-{}.png')

SCREENS = [
    ('大厅', 'lobby'), ('布阵', 'deploy_select'), ('商店', 'shop'),
    ('科技', 'tech_panel'), ('任务', 'quest'), ('成就', 'achievement'),
    ('战令', 'battle_pass'), ('抽卡', 'gacha'), ('排行榜', 'leaderboard'),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True,
                                args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 500, 'height': 705})
    js_errors = []
    asset_reqs = []
    page.on('pageerror', lambda e: js_errors.append(str(e)))
    page.on('request', lambda r: asset_reqs.append(r.url)
            if '/assets/' in r.url else None)
    page.goto(URL, wait_until='load', timeout=30000)
    page.wait_for_function("document.getElementById('loading').style.display === 'none'",
                           timeout=25000)
    page.wait_for_timeout(2200)

    seen = set()
    steps = []

    def collect(tag, shot=None):
        keys = page.evaluate("""async () => {
          const m = await import('/src/system/ArtSystem.js');
          return Array.from(m.ArtSystem._cache.keys());
        }""")
        before = len(seen)
        seen.update(keys)
        steps.append({'tag': tag, 'cache': len(keys), 'new': len(seen) - before})
        if shot:
            page.screenshot(path=OUT_PNG.format(shot[0], shot[1]))

    collect('启动/大厅', (1, '大厅'))
    for idx, (label, state) in enumerate(SCREENS[1:], start=2):
        page.evaluate("(s) => { window.__game.screenState = s; }", state)
        page.wait_for_timeout(420)
        collect(label, (idx, label))

    # 覆盖层：Game 内部真实字段带下划线前缀（gameState.*Open 由它们映射）
    overlays = [
        ('设置面板', "() => { const g=window.__game; g.screenState='lobby'; g._settingsOpen=true; }"),
        ('账号面板', "() => { const g=window.__game; g._settingsOpen=false; g._accountOpen=true; }"),
        ('公告面板', "() => { const g=window.__game; g._accountOpen=false; g._announceOpen=true; }"),
        ('Toast-成功', "() => { const g=window.__game; g._announceOpen=false; g._toastText='领取成功'; g._toastTimer=2; }"),
        ('Toast-警告', "() => { const g=window.__game; g._toastText='金币不足'; g._toastTimer=2; }"),
        ('Toast-信息', "() => { const g=window.__game; g._toastText='提示信息'; g._toastTimer=2; }"),
    ]
    for tag, js in overlays:
        try:
            page.evaluate(js)
            page.wait_for_timeout(320)
            collect(tag)
        except Exception as ex:
            steps.append({'tag': tag + ' ERROR', 'cache': 0, 'new': str(ex)})

    # 战斗 + 结算胜负（先 initBattle 再切状态，避免 isAlive 报错）
    try:
        page.evaluate("() => { const g=window.__game; g._toastTimer=0; "
                      "g.initBattle(); g.screenState='playing'; g.gameStatus='playing'; }")
        page.wait_for_timeout(650)
        collect('战斗', (10, '战斗'))
        page.evaluate("() => { window.__game.gameStatus='won'; }")
        page.wait_for_timeout(420)
        collect('结算-胜', (11, '结算'))
        page.evaluate("() => { window.__game.gameStatus='lost'; }")
        page.wait_for_timeout(420)
        collect('结算-负')
    except Exception as ex:
        steps.append({'tag': '战斗 ERROR', 'cache': 0, 'new': str(ex)})

    st = page.evaluate("""async () => {
      const m = await import('/src/system/ArtSystem.js');
      const f = await import('/src/system/FontSystem.js');
      return { art: m.ArtSystem.stats(), font: f.FontSystem.stats(),
               layerOn: window.__game.renderSystem._artLayerEnabled,
               layerAlpha: window.__game.renderSystem._artLayerAlpha };
    }""")
    browser.close()

art = st['art']
print('=== 逐界面累计请求 ===')
for s in steps:
    print('  %-14s cache=%-4s 新增=%s' % (s['tag'], s['cache'], s['new']))
print('\n累计实际请求 key: %d / %d' % (len(seen), art['total']))
print('ArtSystem:', json.dumps(art, ensure_ascii=False))
print('FontSystem:', json.dumps(st['font'], ensure_ascii=False))
print('装饰层开关:', st['layerOn'], '系数:', st['layerAlpha'])
print('assets 请求数:', len(asset_reqs))
print('JS 错误:', js_errors[:3] if js_errors else '无')

payload = {
    'seen': sorted(seen), 'count': len(seen), 'steps': steps,
    'stats': art, 'font': st['font'], 'layerOn': st['layerOn'],
    'layerAlpha': st['layerAlpha'], 'asset_requests': len(asset_reqs),
    'js_errors': js_errors,
    'passed': (art['failed'] == 0 and art['missing'] == 0
               and art['ready'] > 0 and not js_errors),
}
with open(OUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)
print('写出:', OUT_JSON, '| 通过:', payload['passed'])
