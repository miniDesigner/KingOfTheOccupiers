// 测试 P36: 1)布阵界面垂直间距拉开且不重叠 2)战斗 HUD 战士数整型
//        3)双指缩放以双指中心为锚点（含安全区换算）
const noop = () => {};

function makeCtx(canvasStub) {
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
        if (p === 'fillText') calls.push({ op: p, args, state: { ...state } });
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
const ctxProxy = makeCtx(canvasStub);

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
const { InputSystem } = await import('../src/system/InputSystem.js');

const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();

// 机型矩阵（屏宽 × 屏高）
const DEVICES = [
  { name: 'iPhone SE(1st) 320x568', w: 320, h: 568 },
  { name: 'iPhone 8      375x667', w: 375, h: 667 },
  { name: 'Android 中端  393x786', w: 393, h: 786 },
  { name: 'iPhone 14Pro 393x852', w: 393, h: 852 },
  { name: 'Android 大屏  412x915', w: 412, h: 915 },
];

console.log('=== 测试1: 布阵界面各区块垂直不重叠且间距拉开 ===');
{
  for (const d of DEVICES) {
    const L = RenderSystem.deployLayout(d.w, d.h);
    // 区块占位：[label 顶(以 12px 字号估 ±6), 内容底]
    const blocks = [
      { name: '兵种槽位', top: L.slot.labelY - 6, bottom: L.slot.y + L.slot.h },
      { name: '羁绊', top: L.synergy.labelY - 6, bottom: L.synergy.y + L.synergy.size },
      { name: '建筑强化', top: L.building.labelY - 6, bottom: L.building.y + L.building.h },
      { name: '已拥有兵种', top: L.unit.labelY - 6, bottom: L.scrollAreaBottom },
    ];
    for (let i = 1; i < blocks.length; i++) {
      const gap = blocks[i].top - blocks[i - 1].bottom;
      assert(gap >= 10, `${d.name}: ${blocks[i - 1].name} → ${blocks[i].name} 间距 ${gap}px ≥ 10`);
    }
    // 列表可视高度仍然可用（≥ 1 行卡片 72 + gap）
    const listH = L.scrollAreaBottom - L.unit.listY;
    assert(listH >= 80, `${d.name}: 兵种列表可视高度 ${listH}px ≥ 80`);
    // 底部提示不被列表区吃掉
    assert(L.scrollAreaBottom <= L.tipY1 - 10, `${d.name}: 滚动区底边在提示上方 (${L.scrollAreaBottom} ≤ ${L.tipY1 - 10})`);
  }
}

console.log('=== 测试2: 间距较 P35 基线确实拉开（旧值 unitListY=328 / 区块间距 7~10px）===');
{
  // 旧布局：slot.y=70,h=85 → 155；synergy.y=170,size=65 → 235；buildY=250,h=50 → 300
  const oldGaps = [170 - 8 - 155, 250 - 8 - 235]; // 7, 7
  for (const d of DEVICES) {
    const L = RenderSystem.deployLayout(d.w, d.h);
    const g1 = L.synergy.labelY - 6 - (L.slot.y + L.slot.h);
    const g2 = L.building.labelY - 6 - (L.synergy.y + L.synergy.size);
    assert(g1 > oldGaps[0] && g2 > oldGaps[1],
      `${d.name}: 区块间距 ${g1}/${g2}px > 旧的 ${oldGaps[0]}/${oldGaps[1]}px`);
    assert(L.unit.listY > 328, `${d.name}: unitListY ${L.unit.listY} > 旧 328`);
  }
}

console.log('=== 测试3: 建筑强化卡「升级」提示不再溢出卡外（不与下方标题重叠）===');
{
  const L = RenderSystem.deployLayout(400, 700);
  const rs = new RenderSystem(ctxProxy, 400, 700);
  game.screenState = 'deploy_select';
  game.metaScrollY = 0;
  ctxProxy.__calls.length = 0;
  let err = null;
  try { rs.drawDeploySelect({ deploymentSummary: game.deploymentSummary ? null : null, collectedUnits: [], autoSynergies: [], metaScrollY: 0 }); } catch (e) { err = e; }
  assert(!err, '布阵界面渲染无异常' + (err ? ' — ' + err.message : ''));
  // 建筑卡底 = building.y + building.h；「已拥有兵种」标题 labelY 必须在其下方
  assert(L.unit.labelY - 6 >= L.building.y + L.building.h,
    `建筑卡底 ${L.building.y + L.building.h} ≤ 「已拥有兵种」标题顶 ${L.unit.labelY - 6}`);
}

console.log('=== 测试4: 战斗 HUD 战士数为整型（无小数）===');
{
  const rs = new RenderSystem(ctxProxy, 400, 700);
  const mkPlayer = (marching, buffered) => ({
    id: 1, isAlive: () => true, gold: 12.7, name: '我',
    base: { building: { currentHp: 80, maxHp: 100 } },
    getTotalMarchingWarriors: () => marching,
    getBufferedWarriors: () => buffered,
  });
  const gs = {
    players: [mkPlayer(10, 4.37), (() => { const p = mkPlayer(7.25, 2.9); p.id = 2; return p; })()],
    localPlayerId: 1, marchGroups: [], elapsedTime: 65,
    enemyName: 'AI', layoutName: '标准', screenState: 'playing',
  };
  ctxProxy.__calls.length = 0;
  let err = null;
  try { rs.drawHUD(gs); } catch (e) { err = e; }
  assert(!err, 'HUD 渲染无异常' + (err ? ' — ' + err.message : ''));
  const warriorTexts = ctxProxy.__calls
    .filter(c => typeof c.args[0] === 'string' && c.args[0].startsWith('⚔'))
    .map(c => c.args[0]);
  assert(warriorTexts.length >= 2, `HUD 输出了 ${warriorTexts.length} 条战士数文本`);
  assert(warriorTexts.every(t => /^⚔\d+$/.test(t)),
    `战士数全为整型：${warriorTexts.join(' / ')}`);
  assert(warriorTexts.some(t => t === '⚔14'), `我方 10 + 4.37 → ⚔14（实际 ${warriorTexts.join('/')}）`);
  assert(warriorTexts.some(t => t === '⚔10'), `敌方 7.25 + 2.9 → ⚔10（实际 ${warriorTexts.join('/')}）`);
}

console.log('=== 测试5: 双指缩放以双指中心为锚点 ===');
{
  const inp = new InputSystem(canvasStub, 400, 800);
  inp.cameraEnabled = true;
  // 相机（即世界原点在屏幕上的位置）故意不放在双指中心上，
  // 否则「以中心为锚点」退化成「以原点为锚点」，测不出差异
  inp.cameraX = 200; inp.cameraY = 400; inp.scale = 1;

  // 双指落在 (250,250) 与 (350,350)，中心 = (300,300)
  inp._onTouchStart({ touches: [{ clientX: 250, clientY: 250 }, { clientX: 350, clientY: 350 }] });

  // 缩放前：中心下方的世界点
  const before = inp.screenToWorld(300, 300);

  // 拉开一倍：距离 141.4 → 282.8
  inp._onTouchMove({ touches: [{ clientX: 200, clientY: 200 }, { clientX: 400, clientY: 400 }] });

  assert(Math.abs(inp.scale - 2) < 1e-6, `双指拉开一倍 → scale = ${inp.scale.toFixed(3)}`);
  const after = inp.screenToWorld(300, 300);
  assert(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6,
    `中心点下的世界坐标不变 (${before.x.toFixed(2)},${before.y.toFixed(2)}) → (${after.x.toFixed(2)},${after.y.toFixed(2)})`);
}

console.log('=== 测试6: 锚点不是左上角（世界原点在缩放后应移动）===');
{
  const inp = new InputSystem(canvasStub, 400, 800);
  inp.cameraEnabled = true;
  inp.cameraX = 200; inp.cameraY = 400; inp.scale = 1;
  inp._onTouchStart({ touches: [{ clientX: 250, clientY: 250 }, { clientX: 350, clientY: 350 }] });
  inp._onTouchMove({ touches: [{ clientX: 200, clientY: 200 }, { clientX: 400, clientY: 400 }] });
  // 若仍以左上角（世界原点）为锚点：cameraX/Y 保持 200,400 不变。
  assert(Math.abs(inp.cameraX - 200) > 1e-6 && Math.abs(inp.cameraY - 400) > 1e-6,
    `相机已随锚点补偿（camera = ${inp.cameraX.toFixed(1)}, ${inp.cameraY.toFixed(1)}，不再是 200,400）`);
  // 精确值：camera' = center - k*(center - camera) → (300-2*100, 300-2*(-100)) = (100, 500)
  assert(Math.abs(inp.cameraX - 100) < 1e-6 && Math.abs(inp.cameraY - 500) < 1e-6,
    `相机补偿结果 = (${inp.cameraX.toFixed(1)}, ${inp.cameraY.toFixed(1)})，期望 (100, 500)`);
}

console.log('=== 测试7: 双指中心偏移时锚点跟随（安全区换算）===');
{
  const inp = new InputSystem(canvasStub, 393, 852);
  // 模拟 iPhone 14 Pro：safeAreaTop=59, bottom=34 → scaleY = (852-59-34)/852
  const top = 59, bottom = 34, scaleY = (852 - top - bottom) / 852;
  inp.touchTop = top;
  inp.touchScaleY = scaleY;
  inp.cameraEnabled = true;
  inp.cameraX = 196; inp.cameraY = 400; inp.scale = 1;

  // 屏幕双指中心 (196, 500) → inner 中心 (196, (500-59)/0.8908)
  const innerY = (500 - top) / scaleY;
  const t0 = [{ clientX: 146, clientY: 450 }, { clientX: 246, clientY: 550 }];
  inp._onTouchStart({ touches: t0 });
  const before = inp.screenToWorld(196, innerY);

  inp._onTouchMove({ touches: [{ clientX: 96, clientY: 400 }, { clientX: 296, clientY: 600 }] });
  const after = inp.screenToWorld(196, innerY);
  assert(inp.scale > 1.2, `双指拉开 → scale = ${inp.scale.toFixed(3)}`);
  assert(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6,
    `安全区机型的双指中心锚点保持不动（Δ=${Math.abs(after.y - before.y).toExponential(1)}）`);
}

console.log('=== 测试8: 双指整体平移（距离不变时地图跟手）===');
{
  const inp = new InputSystem(canvasStub, 400, 800);
  inp.cameraEnabled = true;
  inp.cameraX = 200; inp.cameraY = 400; inp.scale = 1;
  const c0x = inp.cameraX, c0y = inp.cameraY;
  inp._onTouchStart({ touches: [{ clientX: 150, clientY: 300 }, { clientX: 250, clientY: 500 }] });
  // 整体右移 40 / 下移 20，指间距不变
  inp._onTouchMove({ touches: [{ clientX: 190, clientY: 320 }, { clientX: 290, clientY: 520 }] });
  assert(Math.abs(inp.cameraX - (c0x + 40)) < 1e-6 && Math.abs(inp.cameraY - (c0y + 20)) < 1e-6,
    `双指平移 40/20 → camera 移动 ${(inp.cameraX - c0x).toFixed(1)}/${(inp.cameraY - c0y).toFixed(1)}`);
  assert(Math.abs(inp.scale - 1) < 1e-6, `指距不变 → scale 不变 (${inp.scale})`);
}

console.log('=== 测试9: 抬起一指后不产生跳变（续拖基准更新）===');
{
  const inp = new InputSystem(canvasStub, 400, 800);
  inp.cameraEnabled = true;
  inp.cameraX = 200; inp.cameraY = 400; inp.scale = 1;
  inp._onTouchStart({ touches: [{ clientX: 150, clientY: 300 }] });
  inp._onTouchStart({ touches: [{ clientX: 150, clientY: 300 }, { clientX: 250, clientY: 500 }] });
  inp._onTouchMove({ touches: [{ clientX: 50, clientY: 200 }, { clientX: 350, clientY: 600 }] });
  // 抬起第二指，剩下第一指在 (50,200)
  const cBefore = { x: inp.cameraX, y: inp.cameraY };
  inp._onTouchEnd({ touches: [{ clientX: 50, clientY: 200 }], changedTouches: [{ clientX: 350, clientY: 600 }] });
  assert(inp.isDragging === true, '抬起一指后 isDragging 保持 true（不会被判成点击）');
  // 剩余手指微动 5px，相机应只走 5px（而不是回到最初 (150,300) 造成的跳变）
  inp._onTouchMove({ touches: [{ clientX: 55, clientY: 205 }] });
  assert(Math.abs((inp.cameraX - cBefore.x) - 5) < 1e-6 && Math.abs((inp.cameraY - cBefore.y) - 5) < 1e-6,
    `续拖位移 = ${(inp.cameraX - cBefore.x).toFixed(1)}/${(inp.cameraY - cBefore.y).toFixed(1)}（应为 5/5）`);
}

console.log('=== 测试10: 渲染冒烟（布阵界面十帧无异常）===');
{
  let err = null;
  try {
    game.screenState = 'deploy_select';
    game._deployDrag.active = false;
    game.metaScrollY = 40; // 带滚动偏移渲染
    for (let i = 0; i < 10; i++) game.update(16);
    game.render();
    game.metaScrollY = 0;
  } catch (e) { err = e; }
  assert(!err, '布阵界面渲染无异常' + (err ? ' — ' + err.message : ''));
}

console.log(`\n📊 结果: ${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
