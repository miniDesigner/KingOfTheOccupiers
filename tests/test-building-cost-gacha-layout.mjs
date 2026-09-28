// 测试 P34-1: 建筑升级消耗（面板展示花费 === 实际扣费）
//        P34-2: 招募界面垂直布局各栏不重叠 + 概率一览整块居中 + 说明在按钮上方
const noop = () => {};
const ctxProxy = new Proxy({}, {
  get: (t, p) => {
    if (p === 'canvas') return canvasStub;
    return (...args) => {
      if (p === 'measureText') return { width: 50 };
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return { addColorStop: noop };
      return undefined;
    };
  },
  set: () => true,
});
const canvasStub = {
  width: 400, height: 700, style: {},
  getContext: () => ctxProxy,
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }),
};
global.document = {
  getElementById: () => canvasStub,
  addEventListener: noop, removeEventListener: noop,
  createElement: () => canvasStub,
  body: { appendChild: noop, removeChild: noop },
  hidden: false,
};
global.window = {
  innerWidth: 400, innerHeight: 700, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: (cb) => 0,
  cancelAnimationFrame: noop,
  AudioContext: class {},
  location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
};
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
global.performance = { now: () => Date.now() };
global.alert = noop;
global.Audio = class { constructor() { this.volume = 1; } play() { return Promise.resolve(); } pause() {} addEventListener() {} };
const { readFileSync: rf, existsSync } = await import('node:fs');
const { fileURLToPath: fURL } = await import('node:url');
const ROOT = fURL(new URL('..', import.meta.url));
global.fetch = async (path) => {
  const file = ROOT + path.replace('../', '');
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
  return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

const { Game } = await import('../src/game/Game.js');
const DeploymentSystem = (await import('../src/meta/DeploymentSystem.js')).default;
 const { UPGRADE_COST_GROWTH } = await import('../src/meta/DeploymentSystem.js');
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const { RenderSystem } = await import('../src/system/RenderSystem.js');

const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();

const cfg = ConfigLoader.getSafe('deployables');
const BLD_TYPES = ['barracks', 'arrow_tower', 'gold_mine'];

// ==================== 建筑升级消耗 ====================
console.log('=== 测试1: getBuildingUpgradeCost 与配置一致（不再硬编码 100/500）===');
for (const t of BLD_TYPES) {
  const bldCfg = cfg.buildingUpgrades[t];
  const base = bldCfg.upgradeCost;
  for (let lv = 1; lv < bldCfg.maxLevel; lv++) {
    const c = DeploymentSystem.getBuildingUpgradeCost(t, lv);
    const expStar = Math.floor(base.starDust * Math.pow(UPGRADE_COST_GROWTH, lv - 1));
    const expGold = Math.floor(base.gold * Math.pow(UPGRADE_COST_GROWTH, lv - 1));
    assert(c && !c.maxed && c.starDust === expStar && c.gold === expGold,
      `${t} Lv${lv} 花费 = ⭐${c.starDust}/💰${c.gold}（配置推导 ⭐${expStar}/💰${expGold}）`);
  }
  const maxed = DeploymentSystem.getBuildingUpgradeCost(t, bldCfg.maxLevel);
  assert(maxed && maxed.maxed === true, `${t} 满级(Lv${bldCfg.maxLevel}) 返回 maxed=true`);
}
{
  const barracksBase = cfg.buildingUpgrades.barracks.upgradeCost;
  assert(!(barracksBase.starDust === 100 && barracksBase.gold === 500),
    `兵营基础花费来自配置(⭐${barracksBase.starDust}/💰${barracksBase.gold})，非硬编码 100/500`);
}

console.log('=== 测试2: getBuildingDetail 含效果/下级预览/花费/可负担 ===');
for (const t of BLD_TYPES) {
  const d = DeploymentSystem.getBuildingDetail(t);
  assert(!!d, `${t} 详情非空`);
  assert(d.level === 1 && d.maxLevel === cfg.buildingUpgrades[t].maxLevel,
    `${t} 等级 Lv${d.level}/${d.maxLevel}`);
  assert(!!d.stats && typeof d.stats.hp === 'number', `${t} 当前效果 stats.hp=${d.stats?.hp}`);
  assert(!!d.nextStats, `${t} 有下一级预览 nextStats`);
  assert(!!d.upgradeCost && !d.upgradeCost.maxed, `${t} upgradeCost 存在`);
  assert(typeof d.canAfford === 'boolean', `${t} canAfford=${d.canAfford}`);
  assert(d.currency && typeof d.currency.gold === 'number', `${t} 附带玩家货币快照`);
}

console.log('=== 测试3: 面板显示花费 === 实际扣费（同源铁律）===');
{
  const profile = ProfileManager.get();
  profile.gold = 100000;
  profile.stardust = 100000;
  profile.buildingUpgrades = { barracks: 1, arrow_tower: 1, gold_mine: 1 };

  const t = 'barracks';
  const before = DeploymentSystem.getBuildingDetail(t);
  const goldBefore = profile.gold;
  const starBefore = profile.stardust;

  const res = DeploymentSystem.upgradeBuilding(t);
  const goldSpent = goldBefore - profile.gold;
  const starSpent = starBefore - profile.stardust;

  assert(res.success === true, `升级成功 → Lv.${res.newLevel}`);
  assert(goldSpent === before.upgradeCost.gold,
    `实扣金币 ${goldSpent} === 面板显示 ${before.upgradeCost.gold}`);
  assert(starSpent === before.upgradeCost.starDust,
    `实扣星尘 ${starSpent} === 面板显示 ${before.upgradeCost.starDust}`);

  const after = DeploymentSystem.getBuildingDetail(t);
  assert(after.level === 2, `升级后等级 Lv.${after.level}`);
  assert(after.upgradeCost.starDust === Math.floor(cfg.buildingUpgrades.barracks.upgradeCost.starDust * UPGRADE_COST_GROWTH),
    `Lv2→3 花费按 1.35 成长 = ⭐${after.upgradeCost.starDust}`);
}

console.log('=== 测试4: 资源不足时不扣费且给出原因 ===');
{
  const profile = ProfileManager.get();
  profile.gold = 0;
  profile.stardust = 0;
  const d = DeploymentSystem.getBuildingDetail('barracks');
  assert(d.canAfford === false, 'canAfford=false（资源不足）');
  const res = DeploymentSystem.upgradeBuilding('barracks');
  assert(res.success === false && /不足/.test(res.reason), `拒绝升级: ${res.reason}`);
  assert(profile.gold === 0 && profile.stardust === 0, '金币/星尘未被扣成负数');
}

console.log('=== 测试5: 满级建筑不产生花费、不可再升 ===');
{
  const profile = ProfileManager.get();
  profile.gold = 100000; profile.stardust = 100000;
  const maxLv = cfg.buildingUpgrades.gold_mine.maxLevel;
  profile.buildingUpgrades.gold_mine = maxLv;
  const d = DeploymentSystem.getBuildingDetail('gold_mine');
  assert(d.upgradeCost.maxed === true && d.nextStats === null, `Lv${maxLv} 已满级，无下级预览`);
  const res = DeploymentSystem.upgradeBuilding('gold_mine');
  assert(res.success === false && res.reason === '已达最高等级', `拒绝: ${res.reason}`);
  profile.buildingUpgrades.gold_mine = 1;
}

console.log('=== 测试6: getDeploymentSummary 建筑项带 upgradeCost（面板数据源）===');
{
  const summary = DeploymentSystem.getDeploymentSummary();
  for (const t of BLD_TYPES) {
    const b = summary.buildings[t];
    assert(!!b && !!b.upgradeCost, `${t} 摘要含 upgradeCost`);
    assert(!!b.stats, `${t} 摘要含 stats`);
    assert(typeof b.canAfford === 'boolean', `${t} 摘要含 canAfford`);
  }
}

console.log('=== 测试7: 建筑详情面板效果文案非空（修 config?.buildings 错误 key）===');
for (const t of BLD_TYPES) {
  const d = DeploymentSystem.getBuildingDetail(t);
  const lines = RenderSystem.buildingEffectLines(t, d.stats);
  assert(lines.length > 0 && !lines[0].includes('undefined'),
    `${t} 效果文案: ${lines.join(' | ')}`);
  const nums = lines.join(' ').match(/(\d+)/g) || [];
  assert(nums.length >= 3, `${t} 效果数值来自真实配置(${nums.join(',')})`);
  if (d.nextStats) {
    const dl = RenderSystem.buildingDiffLines(t, d.stats, d.nextStats);
    assert(dl.length > 0 && dl.join('').includes('→'), `${t} 对比文案: ${dl.join(' | ')}`);
  }
}

console.log('=== 测试8: 升级按钮命中区与绘制同源 ===');
{
  const L = RenderSystem.buildingDetailPanelLayout(400, 700);
  assert(L.btnW > 0 && L.btnH > 0 && L.btnX >= L.panelX && L.btnY >= L.panelY,
    `按钮命中区 x=${L.btnX} y=${L.btnY} w=${L.btnW} h=${L.btnH} 在面板内`);
  assert(L.btnY + L.btnH <= L.panelY + L.panelH, '按钮不溢出面板底部');
  // 面板高度足够容纳 标题+效果+对比+双花费+按钮
  assert(L.panelH >= 250, `面板高度 ${L.panelH} 足够容纳全部内容`);
}

// ==================== 招募界面布局 ====================
console.log('=== 测试9: 招募界面各栏垂直不重叠 ===');
const SCREENS = [[360, 640], [400, 700], [390, 844], [320, 480], [480, 900]];
for (const [sw, sh] of SCREENS) {
  const L = RenderSystem.gachaLayout(sw, sh);
  // 栏位（中心 y，字号高度估算）按顺序两两比较
  const bars = [
    ['标题', L.titleY, 18],
    ['已收集', L.ownedY, 11],
    ['收集进度条', L.progressY + 3, 6],
    ['保底文字', L.pityTextY, 10],
    ['保底进度条', L.pityBarY + 2, 4],
    ['概率标题', L.rateTitleY, 11],
    ['概率行1', L.rateStartY, 11],
    ['概率行6', L.rateStartY + 5 * L.rateStep, 11],
    ['说明1', L.noteY1, 10],
    ['说明2', L.noteY2, 10],
    ['抽卡按钮', L.btnY + L.btnH / 2, L.btnH],
    ['优惠提示', L.discountY, 10],
    ['广告按钮', L.adBtnY + L.adBtnH / 2, L.adBtnH],
  ];
  let ok = true, bad = '';
  for (let i = 0; i < bars.length - 1; i++) {
    const [, y1, h1] = bars[i];
    const [n2, y2, h2] = bars[i + 1];
    if (y1 + h1 / 2 > y2 - h2 / 2) { ok = false; bad = `${bars[i][0]} 与 ${n2} 重叠`; break; }
  }
  assert(ok, `${sw}x${sh} 全部 ${bars.length} 栏无重叠${bad ? ' — ' + bad : ''}`);
  assert(L.adBtnY + L.adBtnH <= sh - 8, `${sw}x${sh} 广告按钮不触底(y=${L.adBtnY}, 底=${L.adBtnY + L.adBtnH}, 屏高=${sh})`);
}

console.log('=== 测试10: 底部说明位于单抽/十连按钮上方且居中 ===');
{
  const L = RenderSystem.gachaLayout(400, 700);
  assert(L.noteY1 < L.noteY2 && L.noteY2 < L.btnY, `说明(${L.noteY1},${L.noteY2}) 在按钮(${L.btnY})上方`);
  assert(L.btnY - L.noteY2 >= 8, `说明与按钮留 ${L.btnY - L.noteY2}px 间隙`);
}

console.log('=== 测试11: 概率一览整块居中 ===');
for (const [sw, sh] of SCREENS) {
  const L = RenderSystem.gachaLayout(sw, sh);
  const left = L.rateBlockX;      // 块左边界（名称列起点）
  const right = L.rateBlockX + L.rateBlockW; // 块右边界（百分比列终点）
  const center = (left + right) / 2;
  assert(Math.abs(center - sw / 2) < 1.5,
    `${sw}x${sh} 概率块中心 ${center.toFixed(1)} ≈ 屏中心 ${sw / 2}（左${left} 右${right}）`);
  assert(left >= 8 && right <= sw - 8, `${sw}x${sh} 概率块不溢出屏幕`);
}

console.log('=== 测试12: 概率行之间不重叠 ===');
for (const [sw, sh] of SCREENS) {
  const L = RenderSystem.gachaLayout(sw, sh);
  assert(L.rateStep >= 16, `${sw}x${sh} 行距 ${L.rateStep}px ≥ 16`);
  const lastY = L.rateStartY + 5 * L.rateStep;
  assert(lastY + 5 <= L.noteY1 - 5, `${sw}x${sh} 末行(${lastY}) 不压到底部说明(${L.noteY1})`);
}

console.log('=== 测试13: 抽卡按钮仍左右对称、不溢出 ===');
for (const [sw, sh] of SCREENS) {
  const L = RenderSystem.gachaLayout(sw, sh);
  assert(L.singleX >= 0 && L.multiX + L.btnW <= sw, `${sw}x${sh} 按钮不溢出(左${L.singleX} 右${L.multiX + L.btnW})`);
  assert(Math.abs((L.singleX + L.multiX + L.btnW) / 2 - sw / 2) < 1.5, `${sw}x${sh} 按钮组居中`);
}

console.log('=== 测试14: 渲染冒烟（drawGacha / _drawBuildingDetailPanel 不抛异常）===');
{
  const rs = new RenderSystem(ctxProxy, 400, 700);
  const profile = ProfileManager.get();
  profile.gold = 99999; profile.stardust = 99999;
  profile.buildingUpgrades = { barracks: 1, arrow_tower: 1, gold_mine: 1 };
  let err = null;
  try { rs.drawGacha({ gachaInfo: DeploymentSystem.getGachaInfo(), gachaResults: null, gachaRevealIdx: 0, profile }); } catch (e) { err = e; }
  assert(!err, 'drawGacha 主界面渲染无异常' + (err ? ' — ' + err.message : ''));

  err = null;
  try { rs.drawGacha({ gachaInfo: null, gachaResults: null, gachaRevealIdx: 0, profile }); } catch (e) { err = e; }
  assert(!err, 'drawGacha 无 info 时降级渲染无异常' + (err ? ' — ' + err.message : ''));

  for (const t of BLD_TYPES) {
    const d = DeploymentSystem.getBuildingDetail(t);
    err = null;
    try { rs._drawBuildingDetailPanel({ buildingDetailType: t, buildingDetailData: d, profile }); } catch (e) { err = e; }
    assert(!err, `建筑详情面板渲染无异常 (${t})` + (err ? ' — ' + err.message : ''));
  }

  const maxLv = cfg.buildingUpgrades.gold_mine.maxLevel;
  profile.buildingUpgrades.gold_mine = maxLv;
  err = null;
  try { rs._drawBuildingDetailPanel({ buildingDetailType: 'gold_mine', buildingDetailData: DeploymentSystem.getBuildingDetail('gold_mine'), profile }); } catch (e) { err = e; }
  assert(!err, '满级建筑面板渲染无异常' + (err ? ' — ' + err.message : ''));
  profile.buildingUpgrades.gold_mine = 1;
}

console.log(`\n📊 结果: ${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
