// 测试: P38 新手引导优化
// 1) 高亮圈贴合目标（不再是一个脱离按钮的大圆）+ 圆圈内部真正透明（遮罩挖洞）
// 2) 文案卡自适应上下，绝不压住高亮区
// 3) 引导遮罩点击不可穿透（含布阵界面 deploy 独立回调路径）
const noop = () => {};
const canvasStub = {
  width: 400, height: 700, style: {},
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }),
};

function makeCtx() {
  const calls = [];
  const state = { fillStyle: '', strokeStyle: '', font: '', lineWidth: 1 };
  const ctx = new Proxy({}, {
    get(t, p) {
      if (p === '__calls') return calls;
      if (p === 'canvas') return canvasStub;
      if (p in state) return state[p];
      return (...args) => {
        calls.push({ m: String(p), a: args, fillStyle: state.fillStyle, strokeStyle: state.strokeStyle });
        if (p === 'measureText') return { width: String(args[0] || '').length * 6 };
        if (p === 'createLinearGradient' || p === 'createRadialGradient') return { addColorStop: noop };
        return undefined;
      };
    },
    set(t, p, v) { state[p] = v; return true; },
  });
  canvasStub.getContext = () => ctx;
  return ctx;
}

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
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
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
const { RenderSystem } = await import('../src/system/RenderSystem.js');
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;

const ctx = makeCtx();
const game = new Game(canvasStub, ctx, 400, 700);
await game.start();
const w = game.screenWidth;
const h = game.screenHeight;
const P = () => ProfileManager.get();

function resetTutorial(step, state) {
  P().tutorialStep = step;
  ProfileManager.save();
  game.screenState = state || 'lobby';
}
function layoutFor(step) {
  resetTutorial(step, step === 1 ? 'deploy_select' : (step === 3 ? 'playing' : 'lobby'));
  return game._tutorialLayout();
}

console.log('=== 测试1: 高亮圈贴合目标（外扩 8，不再是 max(w,h)/2 的大圆）===');
{
  const L0 = layoutFor(0);
  const navW = Game.lobbyNavItemW(w);
  const navH = Game.LOBBY_LAYOUT.nav.h;
  assert(L0.kind === 'rect', 'step0 高亮类型为 rect');
  assert(Math.abs(L0.holeW - (navW + 16)) < 0.01 && Math.abs(L0.holeH - (navH + 16)) < 0.01,
    `step0 高亮尺寸 = 按钮 + 8×2（${L0.holeW.toFixed(0)}×${L0.holeH.toFixed(0)}，按钮 ${navW.toFixed(0)}×${navH}）`);
  assert(Math.abs(L0.cx - (Game.lobbyNavX(2, w) + navW / 2)) < 0.01,
    'step0 高亮中心 X = 布阵按钮中心 X');

  // 旧实现 radius = max(w,h)/2：开战按钮 220×58 → 半径 110，圈直径 220 遠大于按钮高
  const L2 = layoutFor(2);
  const blW = Game.battleBtnW(w);
  const blH = Game.LOBBY_LAYOUT.battle.h;
  assert(L2.holeH < blH + 20 && L2.holeW < blW + 20,
    `step2 高亮贴合开战按钮（${L2.holeW.toFixed(0)}×${L2.holeH.toFixed(0)}，旧实现会是 ${blW.toFixed(0)}×${blW.toFixed(0)} 的正圆）`);
}

console.log('=== 测试2: 文案卡与高亮区不相交（4 机型 × 3 步）===');
{
  const devices = [[320, 568], [375, 667], [393, 852], [412, 915]];
  let allOk = true;
  const detail = [];
  for (const [dw, dh] of devices) {
    const g2 = new Game(canvasStub, ctx, dw, dh);
    P().tutorialStep = 0;
    for (const step of [0, 1, 2]) {
      g2.screenState = step === 1 ? 'deploy_select' : 'lobby';
      P().tutorialStep = step;
      ProfileManager.save();
      const L = g2._tutorialLayout();
      if (!L) { allOk = false; detail.push(`${dw}x${dh} step${step} 无布局`); continue; }
      const overlap = !(L.cardY + L.cardH <= L.holeY || L.cardY >= L.holeY + L.holeH);
      const inScreen = L.cardY >= 58 && L.cardY + L.cardH <= dh - 12;
      // 箭头必须落在高亮区与卡片之间的空隙里
      const arrowBetween = L.placeBelow
        ? (L.arrowY > L.holeY + L.holeH && L.arrowY < L.cardY)
        : (L.arrowY < L.holeY && L.arrowY > L.cardY + L.cardH);
      if (overlap || !inScreen || !arrowBetween) {
        allOk = false;
        detail.push(`${dw}x${dh} step${step} overlap=${overlap} inScreen=${inScreen} arrowBetween=${arrowBetween}`);
      }
    }
  }
  assert(allOk, '4 机型 × 3 步：文案卡不压高亮区、不出屏、箭头夹在两者之间' + (detail.length ? ' — ' + detail.join(' | ') : ''));

  // 底部导航/返回按钮在屏幕最下方，卡片必须翻到上方
  const L1 = layoutFor(1);
  assert(L1.placeBelow === false, 'step1（返回按钮贴底）文案卡翻到上方');
  assert(L1.cardY + L1.cardH < L1.holeY, `step1 卡片底 ${(L1.cardY + L1.cardH).toFixed(0)} < 高亮顶 ${L1.holeY.toFixed(0)}（旧实现卡片固定 h-106 直接盖住返回按钮）`);
  const L0 = layoutFor(0);
  assert(L0.placeBelow === false, 'step0（底部 nav）文案卡翻到上方');
}

console.log('=== 测试3: 遮罩挖洞 —— 高亮区内部透明 ===');
{
  // 渲染 step0（rect 高亮）并录制 ctx 调用
  resetTutorial(0, 'lobby');
  let ccwCalled = 0;
  const rs = game.renderSystem;
  const origCCW = rs._roundRectPathCCW.bind(rs);
  rs._roundRectPathCCW = (...a) => { ccwCalled++; return origCCW(...a); };

  ctx.__calls.length = 0;
  rs._drawTutorialOverlay({ tutorial: game._buildTutorialState() }, game.inputSystem);
  const calls = ctx.__calls;
  const rect0 = calls.find(c => c.m === 'rect');
  assert(!!rect0 && rect0.a[0] === 0 && rect0.a[1] === 0 && rect0.a[2] === w && rect0.a[3] === h,
    '遮罩先画全屏外框 rect(0,0,w,h)');
  assert(ccwCalled === 1, '矩形高亮走逆时针圆角矩形路径（配合 nonzero 规则挖洞，圈内不填充）');
  const fillAfterRect = calls.filter(c => c.m === 'fill').length;
  assert(fillAfterRect >= 1, '外框+挖洞路径合并后一次 fill 完成');
  rs._roundRectPathCCW = origCCW;
}

console.log('=== 测试4: 战斗中 hex 高亮用圆形挖洞（arc 反向）===');
{
  resetTutorial(3, 'playing');
  // step3 依赖真实地图（相邻未翻转格），先初始化一场战斗
  game.initBattle();
  game.gameStatus = 'playing';
  P().tutorialStep = 3;
  ProfileManager.save();
  const tut = game._buildTutorialState();
  assert(tut && tut.target && tut.target.q !== undefined, 'step3 目标为 hex 坐标');
  const L = game._tutorialLayout();
  assert(L && L.kind === 'circle', 'step3 高亮类型为 circle');

  ctx.__calls.length = 0;
  game.renderSystem._drawTutorialOverlay({ tutorial: tut }, game.inputSystem);
  const arcAll = ctx.__calls.filter(c => c.m === 'arc');
  const holeArc = arcAll.filter(c => c.a.length >= 6 && c.a[5] === true);
  assert(holeArc.length === 1,
    '圆形挖洞用 arc(..., anticlockwise=true)（nonzero 规则下形成洞）');
  assert(arcAll.some(c => c.a[5] !== true), '另有顺时针 arc 用于描边光环');
}

console.log('=== 测试5: 大厅引导点击不可穿透（handleScreenClick）===');
{
  resetTutorial(0, 'lobby');
  const L = game._tutorialLayout();
  // 命中高亮 → 正常推进
  game.handleScreenClick(L.cx, L.cy);
  assert(game.screenState === 'deploy_select' && P().tutorialStep === 1,
    `点击高亮的布阵按钮 → 进入布阵（${game.screenState}/${P().tutorialStep}）`);

  // 点其它按钮（商店 nav index 0）→ 被吞，不切屏
  resetTutorial(0, 'lobby');
  const shopX = Game.lobbyNavX(0, w) + Game.lobbyNavItemW(w) / 2;
  game.handleScreenClick(shopX, Game.lobbyNavY(h) + 28);
  assert(game.screenState === 'lobby' && P().tutorialStep === 0,
    `引导中点击商店按钮被拦截（仍 ${game.screenState}）`);

  // 点右上角设置 → 被吞
  resetTutorial(0, 'lobby');
  game.handleScreenClick(w - 25, 25);
  assert(!game._settingsOpen, '引导中点击设置按钮被拦截');

  // step2 点开战 → 放行
  resetTutorial(2, 'lobby');
  const L2 = game._tutorialLayout();
  game.handleScreenClick(L2.cx, L2.cy);
  assert(game.screenState === 'playing' && P().tutorialStep === 3,
    'step2 点击高亮的开战按钮 → 进战斗');
}

console.log('=== 测试6: 布阵界面引导点击不可穿透（deploy 独立回调路径）===');
{
  resetTutorial(1, 'deploy_select');
  const L = game._tutorialLayout();
  assert(L && L.step === 1, 'step1 布局生成');

  // 点兵种卡（列表第一行）→ 不应打开兵种详情
  const dl = RenderSystem.deployLayout(w, h);
  const unitY = dl.unit.listY + 20;
  game._handleDeployDragEnd(w / 2, unitY, false);
  assert(!game._unitDetailId, '引导中点击兵种卡不打开详情（遮罩不再穿透）');

  // 长按/拖拽兵种卡 → 拿不起来
  game._handleDeployDragStart(w / 2, unitY);
  assert(!game._deployDrag.active, '引导中长按兵种卡无法进入拖拽');

  // 点羁绊卡 → 不打开羁绊详情
  const syn = RenderSystem.autoSynergyCardLayout(w);
  game._handleDeployDragEnd(syn.startX + syn.size / 2, syn.y + syn.size / 2, false);
  assert(!game._synergyDetailId, '引导中点击羁绊卡不打开详情');

  // 点返回按钮（即高亮区）→ 正常返回大厅
  resetTutorial(1, 'deploy_select');
  game._handleDeployDragEnd(L.cx, L.cy, false);
  assert(game.screenState === 'lobby' && P().tutorialStep === 2,
    '点击高亮的返回按钮 → 正常返回大厅并推进引导');
}

console.log('=== 测试7: 战斗中 step3 地图放行、设置按钮拦截 ===');
{
  resetTutorial(3, 'playing');
  game.gameStatus = 'playing';
  // 右上角设置按钮 → 拦截
  game.handleScreenClick(w - 75, 20);
  assert(!game._settingsOpen, 'step3 点击右上角设置被拦截');
  // 高亮格 → 翻格成功，引导完成
  const L = game._tutorialLayout();
  const before = P().gold;
  game.handleScreenClick(L.cx, L.cy);
  assert(P().tutorialStep === 4, 'step3 点击高亮格 → 翻格成功，引导完成');
  assert(P().gold === before + 100, `引导完成奖励 +100 金（${before} → ${P().gold}）`);
}

console.log('=== 测试8: 引导未激活时不拦截 ===');
{
  resetTutorial(4, 'lobby');
  assert(game._tutorialLayout() === null, 'step4 引导已完成，无布局');
  assert(game._interceptTutorialClick(10, 10) === false, 'step4 点击不被拦截');
  resetTutorial(-1, 'lobby');
  assert(game._interceptTutorialClick(10, 10) === false, '老玩家(-1) 点击不被拦截');
  // 老玩家点布阵正常进入
  const navW = Game.lobbyNavItemW(w);
  game.handleScreenClick(Game.lobbyNavX(2, w) + navW / 2, Game.lobbyNavY(h) + 28);
  assert(game.screenState === 'deploy_select', '老玩家点击布阵正常进入');
}

console.log('=== 测试9: safeArea 机型（top=59）高亮与点击同坐标系 ===');
{
  const dev = [[393, 852, 59, 34], [412, 915, 47, 24], [375, 667, 20, 0]];
  let ok = true;
  const info = [];
  for (const [dw, dh, top, bottom] of dev) {
    const g3 = new Game(canvasStub, ctx, dw, dh, { top, bottom, left: 0, right: 0 });
    P().tutorialStep = 1;
    ProfileManager.save();
    g3.screenState = 'deploy_select';
    const L = g3._tutorialLayout();
    // 高亮中心在 inner 坐标系；Game 点击回调反推 (screenY - top) / scaleY 后应命中
    const screenY = L.cy * g3.safeAreaScaleY + g3.safeAreaTop;
    const innerY = (screenY - g3.safeAreaTop) / g3.safeAreaScaleY;
    const hit = g3._isInTutorialHole(L.cx, innerY);
    if (!hit) { ok = false; info.push(`${dw}x${dh} top=${top} 命中失败`); }
  }
  assert(ok, '3 种安全区机型：屏幕坐标反推后仍命中高亮区（渲染/点击同坐标系）' + (info.length ? ' — ' + info.join(', ') : ''));
}

console.log('=== 测试10: 渲染冒烟（3 步各 10 帧）===');
{
  let err = null;
  try {
    for (const step of [0, 1, 2, 3]) {
      P().tutorialStep = step;
      ProfileManager.save();
      game.screenState = step === 1 ? 'deploy_select' : (step === 3 ? 'playing' : 'lobby');
      if (step === 3) game.gameStatus = 'playing';
      for (let i = 0; i < 10; i++) game.render(0.016);
    }
  } catch (e) { err = e; }
  assert(!err, '引导 4 步各渲染 10 帧无异常' + (err ? ' — ' + err.message : ''));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
