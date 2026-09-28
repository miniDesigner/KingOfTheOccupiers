// 测试 P37 商店改造：
//   1) 「货币兑换」→「星尘兑换」
//   2) 新增「免费」分页并默认展示（排第 1）
//   3) 免费分页含每日免费钻石 / 免费金币栏位，按钮文案「免费」+ 蓝色
//   4) 每日上限 5 次、界面显示已领/可领、首次直领、之后需看完广告
const noop = () => {};

// ctx 录制器：记录 fillText / fillRect / strokeRect 及调用时的 fillStyle / strokeStyle
function makeRecorder(canvasStub) {
  const state = {};
  const calls = [];
  const ctx = new Proxy({}, {
    get(t, p) {
      if (p === 'canvas') return canvasStub;
      if (p === '__calls') return calls;
      if (p === 'measureText') return () => ({ width: 50 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (p in state) return state[p];
      return (...args) => {
        if (p === 'fillText' || p === 'fillRect' || p === 'strokeRect') {
          calls.push({ op: p, args, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle });
        }
        return undefined;
      };
    },
    set(t, p, v) { state[p] = v; return true; },
  });
  return ctx;
}

const canvasStub = {
  width: 400, height: 700, style: {},
  getContext: () => ctxProxy,
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }),
};
const ctxProxy = makeRecorder(canvasStub);

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
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: noop,
  AudioContext: class {},
  location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
};
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {
  shareAppMessage(cfg) { global.__lastShare = cfg; },
  createInnerAudioContext() {
    return { src: '', loop: false, volume: 1, play: noop, pause: noop, stop: noop, seek: noop, destroy: noop, onEnded: noop, onError: noop, onCanplay: noop };
  },
};
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
global.performance = { now: () => Date.now() };
global.alert = noop;
global.Audio = class { constructor() { this.volume = 1; } play() { return Promise.resolve(); } pause() {} addEventListener() {} };
const { readFileSync: rf, existsSync } = await import('node:fs');
const { fileURLToPath: fURL } = await import('node:url');
const ROOT = fURL(new URL('..', import.meta.url));
global.fetch = async (path) => {
  const file = ROOT + String(path).replace('../', '');
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
  return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

const { default: ConfigLoader, syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();

const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
const ShopSystem = (await import('../src/meta/ShopSystem.js')).default;
const { RenderSystem } = await import('../src/system/RenderSystem.js');
const AdManager = (await import('../src/system/AdManager.js')).default;

const TODAY = new Date().toISOString().slice(0, 10);

/** 重置今日免费领取计数（保证每条用例独立） */
function resetFreeClaims() {
  const p = ProfileManager.get();
  p.shopDailyClaims = {};
  p.shopDailyDate = TODAY;
  ProfileManager.save();
}

const P = () => ProfileManager.get(); // game.start() 会重建 profile，必须每次现取

console.log('=== 测试1: 分类结构 —— 免费分页第 1（默认展示）+ 货币兑换改名 ===');
{
  const items = ShopSystem.getShopItems();
  const cats = ShopSystem.getCategoryNames();
  assert(cats[0].id === 'free' && cats[0].name === '免费', `第 1 个分页 = ${cats[0].id}/${cats[0].name}`);
  const currency = cats.find(c => c.id === 'currency');
  assert(currency && currency.name === '星尘兑换', `currency 名称 = ${currency && currency.name}`);
  assert(!cats.some(c => c.name === '货币兑换'), '不再存在「货币兑换」文案');
  assert(items[0].categoryId === 'free', 'getShopItems 第 1 项 = free 分类');
}

console.log('=== 测试2: 免费栏位结构（每日 5 次，钻石 + 金币两个栏位）===');
{
  resetFreeClaims();
  const items = ShopSystem.getShopItems();
  const free = items.find(c => c.categoryId === 'free');
  assert(free.items.length === 2, `免费分页 ${free.items.length} 个栏位`);
  const d = free.items.find(i => i.id === 'free_diamond');
  const g = free.items.find(i => i.id === 'free_gold');
  assert(d && g, '含 free_diamond 与 free_gold');
  for (const it of [d, g]) {
    assert(it.isFree === true, `${it.name} isFree=true`);
    assert(it.dailyLimit === 5, `${it.name} 每日上限 = ${it.dailyLimit}`);
    assert(it.dailyClaimed === 0 && it.dailyRemaining === 5, `${it.name} 初始 0/5（可领 5）`);
    assert(it.needAd === false, `${it.name} 首次无需广告`);
    assert(it.exhausted === false, `${it.name} 未耗尽`);
    assert(!!it.adKey, `${it.name} 配置了 adKey = ${it.adKey}`);
    assert(it.canAfford === true, `${it.name} 可点击`);
  }
  assert(d.reward.diamond > 0, `免费钻石奖励 💎+${d.reward.diamond}`);
  assert(g.reward.gold > 0, `免费金币奖励 💰+${g.reward.gold}`);
}

console.log('=== 测试3: 每日首次 → 直接领取（无需 adVerified）===');
{
  resetFreeClaims();
  P().diamond = 0;
  P().gold = 0;
  ProfileManager.save();

  const r = ShopSystem.purchase('free_diamond');
  assert(r.success, '首次领取成功');
  assert(r.free === true, '返回标记 free=true');
  assert(P().diamond === 10, `钻石到账 ${P().diamond} = 10`);
  assert(r.dailyClaimed === 1 && r.dailyRemaining === 4, `进度 ${r.dailyClaimed}/5，剩余 ${r.dailyRemaining}`);
  assert(r.needAdNext === true, '下一次需要看广告（needAdNext=true）');

  const after = ShopSystem.getFreeItems().find(i => i.id === 'free_diamond');
  assert(after.needAd === true, '刷新后该栏位 needAd=true（按钮加广告图标）');
}

console.log('=== 测试4: 非首次 → 未看广告被防御层拦截（不发奖）===');
{
  const before = P().diamond;
  const r = ShopSystem.purchase('free_diamond'); // 不带 adVerified
  assert(!r.success && r.needAd === true, `被拦截：${r.reason}`);
  assert(P().diamond === before, `钻石未变（${P().diamond}）`);
  assert(r.adKey === 'shopFreeDiamond', `返回 adKey = ${r.adKey}`);
}

console.log('=== 测试5: 非首次 → adVerified=true 才发放 ===');
{
  const before = P().diamond;
  const r = ShopSystem.purchase('free_diamond', { adVerified: true });
  assert(r.success, '看完广告后领取成功');
  assert(P().diamond === before + 10, `钻石 ${before} → ${P().diamond}`);
  assert(r.dailyClaimed === 2 && r.dailyRemaining === 3, `进度 ${r.dailyClaimed}/5，剩余 ${r.dailyRemaining}`);
}

console.log('=== 测试6: 领满 5 次 → 第 6 次耗尽，界面不可点 ===');
{
  resetFreeClaims();
  P().gold = 0;
  ProfileManager.save();
  for (let i = 0; i < 5; i++) {
    const r = ShopSystem.purchase('free_gold', { adVerified: true });
    assert(r.success, `第 ${i + 1} 次领取成功（进度 ${r.dailyClaimed}/5）`);
  }
  assert(P().gold === 500 * 5, `金币累计 ${P().gold} = 2500`);
  const r6 = ShopSystem.purchase('free_gold', { adVerified: true });
  assert(!r6.success && r6.exhausted === true, `第 6 次被拒：${r6.reason}`);
  assert(P().gold === 2500, '金币未再增加');
  const it = ShopSystem.getFreeItems().find(i => i.id === 'free_gold');
  assert(it.exhausted === true && it.canAfford === false, '界面状态：exhausted=true / canAfford=false');
}

console.log('=== 测试7: 两个栏位独立计数 ===');
{
  resetFreeClaims();
  ShopSystem.purchase('free_diamond');                       // 钻石 1 次（首领免广告）
  const d = ShopSystem.getFreeItems().find(i => i.id === 'free_diamond');
  const g = ShopSystem.getFreeItems().find(i => i.id === 'free_gold');
  assert(d.dailyClaimed === 1, `钻石栏位 已领 ${d.dailyClaimed}`);
  assert(g.dailyClaimed === 0 && g.needAd === false, `金币栏位不受影响（已领 ${g.dailyClaimed}，仍首领略径）`);
  const rg = ShopSystem.purchase('free_gold');
  assert(rg.success, '金币栏位首次仍可直接领取');
}

console.log('=== 测试8: 跨天自动清零 ===');
{
  const p = ProfileManager.get();
  p.shopDailyClaims = { free_diamond: 5, free_gold: 3 };
  p.shopDailyDate = '2000-01-01'; // 伪造成昨天
  ProfileManager.save();
  assert(p.getShopDailyClaimed('free_diamond') === 0, '跨天后已领次数归零');
  assert(p.shopDailyDate === TODAY, `shopDailyDate 刷新为今天 (${p.shopDailyDate})`);
  const it = ShopSystem.getFreeItems().find(i => i.id === 'free_diamond');
  assert(it.dailyRemaining === 5 && it.needAd === false, '跨天后恢复 5 次且首领略径');
}

console.log('=== 测试9: 分页布局自适应（5 个分页窄屏不溢出）===');
{
  for (const w of [320, 360, 375, 393, 412, 430]) {
    const L5 = RenderSystem.shopLayout(w, 5);
    const right5 = L5.tabStartX + 5 * (L5.tabW + L5.tabGap) - L5.tabGap;
    assert(right5 <= w, `w=${w} 5 分页右边界 ${right5} ≤ ${w}`);
    const L4 = RenderSystem.shopLayout(w, 4);
    const right4 = L4.tabStartX + 4 * (L4.tabW + L4.tabGap) - L4.tabGap;
    assert(right4 <= w, `w=${w} 4 分页右边界 ${right4} ≤ ${w}`);
    assert(L5.tabW >= 38, `w=${w} 5 分页 tabW=${L5.tabW} 不小于最小可读宽 38`);
    assert(L5.cardX + L5.itemW <= w, `w=${w} 卡片右边界 ${L5.cardX + L5.itemW} ≤ ${w}`);
  }
}

console.log('=== 测试10: 免费卡片渲染 —— 蓝色「免费」按钮 + 广告图标 + 次数文案 ===');
{
  resetFreeClaims();
  const items = ShopSystem.getShopItems();
  const L = RenderSystem.shopLayout(400, items.length);

  const drawAndCapture = () => {
    ctxProxy.__calls.length = 0;
    const rs = new RenderSystem(ctxProxy, 400, 700);
    rs.drawShop({ shopItems: ShopSystem.getShopItems(), shopTab: 0, metaScrollY: 0 });
    return ctxProxy.__calls;
  };
  const texts = (calls) => calls.filter(c => c.op === 'fillText').map(c => String(c.args[0]));

  // 10a 首次：按钮文案「免费」，蓝色，无广告图标
  let calls = drawAndCapture();
  let ts = texts(calls);
  assert(ts.includes('免费'), '首次：按钮文案含「免费」');
  assert(!ts.some(t => t.includes('\u{1F4FA}')), '首次：按钮无广告播放图标');
  const blueBtn = calls.some(c => c.op === 'strokeRect' && c.strokeStyle === '#3b82f6');
  assert(blueBtn, '按钮描边为蓝色 #3b82f6');
  const blueText = calls.some(c => c.op === 'fillText' && c.fillStyle === '#3b82f6' && String(c.args[0]) === '免费');
  assert(blueText, '「免费」文字为蓝色 #3b82f6');
  assert(ts.some(t => t === '已领 0/5'), '显示「已领 0/5」');
  assert(ts.some(t => t.includes('还可领 5 次')), '显示「还可领 5 次」');
  assert(ts.some(t => t.includes('首次直接领取')), '提示首次无需广告');

  // 10b 领过 1 次：按钮加广告图标，文案变化
  ShopSystem.purchase('free_diamond');
  calls = drawAndCapture();
  ts = texts(calls);
  assert(ts.some(t => t.includes('\u{1F4FA}') && t.includes('免费')), '非首次：按钮含广告播放图标 📺');
  assert(ts.some(t => t === '已领 1/5'), '显示「已领 1/5」');
  assert(ts.some(t => t.includes('还可领 4 次')), '显示「还可领 4 次」');
  assert(ts.some(t => t.includes('观看广告后领取')), '提示需观看广告');

  // 10c 两个栏位都领满 5 次：不再画任何免费按钮
  resetFreeClaims();
  for (let i = 0; i < 5; i++) ShopSystem.purchase('free_gold', { adVerified: true });
  for (let i = 0; i < 5; i++) ShopSystem.purchase('free_diamond', { adVerified: true });
  calls = drawAndCapture();
  ts = texts(calls);
  assert(ts.some(t => t.includes('今日已领完')), '耗尽：提示今日已领完');
  // 只数「按钮文案」：'免费' 或 '📺免费'（排除分页标签「免费」与卡片名「免费钻石/免费金币」）
  const btnTexts = ts.filter(t => t === '免费' || t === '\u{1F4FA}免费');
  // 只剩 1 个 = 顶部「免费」分页标签本身（两张卡都没有按钮了）
  assert(btnTexts.length === 1, `耗尽后不再绘制任何免费按钮（含「免费」文案 ${btnTexts.length} 处 = 仅分页标签）`);
  const blueBtns = calls.filter(c => c.op === 'strokeRect' && c.strokeStyle === '#3b82f6');
  assert(blueBtns.length === 0, `耗尽后无蓝色按钮描边（实际 ${blueBtns.length} 个）`);
  assert(L.itemH === 70 && L.btnW === 60, '卡片/按钮尺寸与 Game 命中区一致（itemH=70, btnW=60）');
}

console.log('=== 测试11: Game 默认进商店停在「免费」分页 + 分页切换 ===');
{
  const { Game } = await import('../src/game/Game.js');
  const game = new Game(canvasStub, ctxProxy, 400, 700);
  await game.start();
  ProfileManager.get().tutorialStep = 4;
  ProfileManager.save();

  assert(game.shopTab === 0, `构造后 shopTab = ${game.shopTab}（默认免费分页）`);
  game.screenState = 'shop';
  const cats = ShopSystem.getCategoryNames();
  const L = RenderSystem.shopLayout(400, cats.length);
  game.handleShopClick(L.tabStartX + L.tabW / 2, L.tabY + L.tabH / 2);
  assert(game.shopTab === 0, '点击第 1 个分页 → shopTab=0（免费）');
  game.handleShopClick(L.tabStartX + (L.tabW + L.tabGap) + L.tabW / 2, L.tabY + L.tabH / 2);
  assert(game.shopTab === 1, '点击第 2 个分页 → shopTab=1（星尘兑换）');
  assert(cats[1].id === 'currency' && cats[1].name === '星尘兑换', `第 2 个分页 = ${cats[1].name}`);
  global.__game = game;
}

console.log('=== 测试12: 点击免费卡 → 首次直接领取（浏览器预览降级路径）===');
{
  const game = global.__game;
  game.screenState = 'shop';
  game.shopTab = 0;
  resetFreeClaims();
  P().diamond = 0;
  ProfileManager.save();

  const L = RenderSystem.shopLayout(400, ShopSystem.getCategoryNames().length);
  const iy = RenderSystem.shopItemTop(0, 0, L);
  const bx = L.cardX + L.itemW - L.btnW - 10 + L.btnW / 2;
  const by = iy + 10 + L.btnH / 2;

  game.handleShopClick(bx, by);
  await new Promise(r => setTimeout(r, 30)); // 等异步领取流程
  assert(P().diamond === 10, `点击免费按钮 → 钻石到账 ${P().diamond} = 10`);
  const it = ShopSystem.getFreeItems().find(i => i.id === 'free_diamond');
  assert(it.dailyClaimed === 1, `已领 ${it.dailyClaimed}/5`);
}

console.log('=== 测试13: 非首次点击 → 看完广告才发放（mock 真机 AdManager）===');
{
  const game = global.__game;
  const orig = {
    isAvailable: AdManager.isAvailable,
    canShowRewarded: AdManager.canShowRewarded,
    showRewarded: AdManager.showRewarded,
  };
  AdManager.isAvailable = () => true;
  AdManager.canShowRewarded = () => true;

  const L = RenderSystem.shopLayout(400, ShopSystem.getCategoryNames().length);
  const iy = RenderSystem.shopItemTop(0, 0, L);
  const bx = L.cardX + L.itemW - L.btnW - 10 + L.btnW / 2;
  const by = iy + 10 + L.btnH / 2;

  // 13a 中途关闭广告 → 不发奖
  AdManager.showRewarded = async () => ({ isEnded: false, reason: 'closed' });
  const before = P().diamond;
  await game._handleShopFreeClaim(ShopSystem.getFreeItems().find(i => i.id === 'free_diamond'));
  assert(P().diamond === before, `未看完广告 → 钻石未变（${P().diamond}）`);

  // 13b 看完广告 → 发奖 + 记广告配额
  AdManager.showRewarded = async () => ({ isEnded: true });
  await game._handleShopFreeClaim(ShopSystem.getFreeItems().find(i => i.id === 'free_diamond'));
  assert(P().diamond === before + 10, `看完广告 → 钻石 ${before} → ${P().diamond}`);
  const it = ShopSystem.getFreeItems().find(i => i.id === 'free_diamond');
  assert(it.dailyClaimed === 2, `已领 ${it.dailyClaimed}/5`);
  assert((P().dailyAdWatched.shopFreeDiamond || 0) === 1, `广告配额已记录 shopFreeDiamond = ${P().dailyAdWatched.shopFreeDiamond}`);

  // 13c 广告不可用 → 不发奖
  AdManager.canShowRewarded = () => false;
  const before2 = P().diamond;
  await game._handleShopFreeClaim(ShopSystem.getFreeItems().find(i => i.id === 'free_diamond'));
  assert(P().diamond === before2, '广告不可用 → 不发放');

  // 13d 次数耗尽 → 提示用完
  AdManager.canShowRewarded = () => true;
  resetFreeClaims();
  for (let i = 0; i < 5; i++) ShopSystem.purchase('free_gold', { adVerified: true });
  const before3 = P().gold;
  await game._handleShopFreeClaim(ShopSystem.getFreeItems().find(i => i.id === 'free_gold'));
  assert(P().gold === before3, '次数耗尽 → 不再发放');

  AdManager.isAvailable = orig.isAvailable;
  AdManager.canShowRewarded = orig.canShowRewarded;
  AdManager.showRewarded = orig.showRewarded;
}

console.log('=== 测试14: 普通商品不受影响（星尘兑换购买链路）===');
{
  const game = global.__game;
  game.shopTab = 1; // 星尘兑换
  P().diamond = 1000;
  P().stardust = 0;
  delete P().shopPurchases;
  ProfileManager.save();

  const L = RenderSystem.shopLayout(400, ShopSystem.getCategoryNames().length);
  const iy = RenderSystem.shopItemTop(0, 0, L);
  game.handleShopClick(L.cardX + L.itemW - L.btnW - 10 + L.btnW / 2, iy + 10 + L.btnH / 2);
  assert(P().diamond === 950, `钻石扣除 ${P().diamond} = 950`);
  assert(P().stardust === 20, `星尘到账 ${P().stardust} = 20`);
  const free = ShopSystem.getFreeItems();
  assert(free.every(i => i.isFree), '普通商品不误判为免费栏位');
}

console.log('=== 测试15: 渲染冒烟（商店 4 个分页各 3 帧无异常）===');
{
  const game = global.__game;
  game.screenState = 'shop';
  let err = null;
  try {
    const origRender = game.renderSystem.render;
    game.renderSystem.render = () => {};
    for (let t = 0; t < 4; t++) {
      game.shopTab = t;
      for (let i = 0; i < 3; i++) game.render(0.016);
    }
    game.renderSystem.render = origRender;
  } catch (e) { err = e; }
  assert(!err, '商店各分页渲染无异常' + (err ? ' — ' + err.message : ''));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
