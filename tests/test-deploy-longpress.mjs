// 测试: 兵种长按拖拽 + 羁绊无拖拽（上阵/卸下全部走详情面板）
// (交互规则: 轻点=查看详情；按住 DEPLOY_LONG_PRESS_MS 或按住拖动>10px=拿起拖拽；拿起后松手=放回，不弹详情；列表滚动从卡片间隙/空白起手)
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

const { Game } = await import('../src/game/Game.js');
const { RenderSystem } = await import('../src/system/RenderSystem.js');
const DeploymentSystem = (await import('../src/meta/DeploymentSystem.js')).default;
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;

const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();
// P38：引导激活时遮罩会拦截界面点击（本次要修的行为）。
// 本测试验证布阵功能本身，必须在「引导已完成」前提下运行。
ProfileManager.get().tutorialStep = 4;
ProfileManager.save();

const L = RenderSystem.deployLayout(game.screenWidth, game.screenHeight);
const w = game.screenWidth;

// 2026-09-09 改造：getCollectedSynergyList 已移除，unitListY 不再依赖羁绊
const collected = DeploymentSystem.getCollectedUnitList();
const unitListY = L.unit.listY;
const card = L.unit;
const cardStartX = (w - (card.perRow * card.w + (card.perRow - 1) * card.gap)) / 2;
const c0x = cardStartX + 0;
const c0y = unitListY + 0;
const unit0 = collected[0];

// 测试前置：确保 unit0 未上阵（若已上阵则腾空其槽位），并记录该空槽
{
  const p = ProfileManager.get();
  const idx = p.deployment.units.indexOf(unit0.id);
  if (idx >= 0) p.deployment.units[idx] = null;
}
const emptySlotIdx = ProfileManager.get().deployment.units.findIndex(u => !u);
const deployedUnitId = ProfileManager.get().deployment.units.find(Boolean);

console.log('=== 测试1: 轻点兵种卡（立即松开）→ 打开详情，不激活拖拽 ===');
{
  game._handleDeployDragStart(c0x + 10, c0y + 10);
  assert(game._deployDrag.active === false, '按下瞬间不激活拖拽');
  assert(game._deployPress !== null && game._deployPress.id === unit0.id, '记录长按候选');
  game._handleDeployDragEnd(c0x + 10, c0y + 10, false);
  assert(game._unitDetailId === unit0.id, '轻点打开兵种详情');
  assert(game._deployPressTimer === null && game._deployPress === null, '松手清理长按候选');
  game._unitDetailId = null;
}

console.log('=== 测试2: 按住未上阵兵种卡超过阈值 → 激活拖拽并可放置 ===');
{
  const LP = Game.DEPLOY_LONG_PRESS_MS;
  game._handleDeployDragStart(c0x + 10, c0y + 10);
  await sleep(Math.max(80, LP - 60)); // 不足阈值
  assert(game._deployDrag.active === false, `不足${LP}ms不激活拖拽`);
  await sleep(LP); // 累计超过阈值
  assert(game._deployDrag.active === true, `长按${LP}ms后拖拽激活`);
  assert(game._deployDrag.type === 'unit' && game._deployDrag.id === unit0.id, '拖拽对象正确');
  assert(game._deployDrag.fromSlot === -1, '来源为卡片列表');
  // 拖到空槽位松开 → 上阵
  const uStartX = (w - (L.slot.count * L.slot.w + (L.slot.count - 1) * L.slot.gap)) / 2;
  const slotX = uStartX + emptySlotIdx * (L.slot.w + L.slot.gap) + L.slot.w / 2;
  game._handleDeployDragMove(slotX, L.slot.y + L.slot.h / 2);
  game._handleDeployDragEnd(slotX, L.slot.y + L.slot.h / 2, true);
  assert(ProfileManager.get().deployment.units[emptySlotIdx] === unit0.id, `拖拽放置成功上阵到 #${emptySlotIdx + 1}`);
  assert(game._deployDrag.active === false, '松开后拖拽复位');
}

console.log('=== 测试3: 按住未满阈值时拖动 15px → 立即拿起拖拽 ===');
{
  // 测试2把 unit0 留在了槽位上，先腾空（已上阵的卡不产生拖拽候选）
  const pre = ProfileManager.get();
  const preSlot = pre.deployment.units.indexOf(unit0.id);
  if (preSlot >= 0) pre.deployment.units[preSlot] = null;
  game._unitDetailId = null;
  game._deployDrag.active = false;
  game._handleDeployDragStart(c0x + 10, c0y + 10);
  game._handleDeployDragMove(c0x + 25, c0y + 10); // 移动15px（超过10px阈值，未满长按时间）
  assert(game._deployDrag.active === true, '按住拖动超阈值立即激活拖拽');
  assert(game._deployDrag.type === 'unit' && game._deployDrag.id === unit0.id, '拖拽对象正确');
  assert(game._deployPress === null && game._deployPressTimer === null, '候选与计时器已清理');
  // 拖到空槽位松开 → 上阵成功（按住拖拽路径完整可用）
  const uStartX = (w - (L.slot.count * L.slot.w + (L.slot.count - 1) * L.slot.gap)) / 2;
  const slotX = uStartX + emptySlotIdx * (L.slot.w + L.slot.gap) + L.slot.w / 2;
  game._handleDeployDragMove(slotX, L.slot.y + L.slot.h / 2);
  game._handleDeployDragEnd(slotX, L.slot.y + L.slot.h / 2, true);
  assert(ProfileManager.get().deployment.units[emptySlotIdx] === unit0.id, '按住拖动放置成功上阵');
  // 腾空恢复现场，供后续测试使用
  const p = ProfileManager.get();
  const slot = p.deployment.units.indexOf(unit0.id);
  if (slot >= 0) p.deployment.units[slot] = null;
}

console.log('=== 测试3b: 从卡片间隙起手拖动 → 正常滚动列表，不误拿起 ===');
{
  game.metaScrollY = 0;
  // 卡片列间隙（gap=5）的中心点，不在任何卡内
  const gapX = cardStartX + card.w + card.gap / 2;
  game._handleDeployDragStart(gapX, c0y + card.h / 2);
  assert(game._deployPress === null, '间隙处不产生拖拽候选');
  game._handleDeployDragMove(gapX, c0y + card.h / 2 - 40); // 向上滑 40px → 内容上移(scrollY 增)
  assert(game._deployDrag.active === false, '间隙拖动不激活拖拽');
  assert((game.metaScrollY || 0) > 0, `列表滚动生效(scrollY=${game.metaScrollY})`);
  game._handleDeployDragEnd(gapX, c0y + card.h / 2 - 40, true);
  game.metaScrollY = 0;
}

console.log('=== 测试4: 兵种槽位长按 → 不可拖拽，轻点开详情 ===');
{
  const uStartX = (w - (L.slot.count * L.slot.w + (L.slot.count - 1) * L.slot.gap)) / 2;
  const slot0Unit = ProfileManager.get().deployment.units[0];
  if (slot0Unit) {
    game._handleDeployDragStart(uStartX + L.slot.w / 2, L.slot.y + L.slot.h / 2);
    await sleep(Game.DEPLOY_LONG_PRESS_MS + 60);
    assert(game._deployDrag.active === false, '槽位长按不激活拖拽');
    assert(game._deployPress === null, '槽位不产生长按候选');
    game._handleDeployDragEnd(uStartX + L.slot.w / 2, L.slot.y + L.slot.h / 2, false);
    assert(game._unitDetailId === slot0Unit, '槽位轻点打开该兵种详情');
    game._unitDetailId = null;
  } else {
    console.log('  ⚠️ 槽位0为空，跳过槽位测试');
  }
}

console.log('=== 测试5: 已上阵兵种卡长按 → 不可拖拽，轻点仍开详情 ===');
{
  assert(deployedUnitId, '存在已上阵兵种');
  const idx = collected.findIndex(u => u.id === deployedUnitId);
  const col = idx % card.perRow;
  const row = Math.floor(idx / card.perRow);
  const cx = cardStartX + col * (card.w + card.gap);
  const cy = unitListY + row * (card.h + card.gap);
  game._handleDeployDragStart(cx + 10, cy + 10);
  assert(game._deployPress === null, '已上阵兵种不产生长按候选');
  await sleep(Game.DEPLOY_LONG_PRESS_MS + 60);
  assert(game._deployDrag.active === false, '已上阵兵种长按不激活拖拽');
  game._handleDeployDragEnd(cx + 10, cy + 10, false);
  assert(game._unitDetailId === deployedUnitId, '已上阵兵种轻点仍可打开详情');
  game._unitDetailId = null;
}

console.log('=== 测试9: 长按拿起后原位放回 → 不弹出详情 ===');
{
  game._unitDetailId = null;
  game._synergyDetailId = null;
  game.metaScrollY = 0;
  // unit0 已在测试2上阵，先腾空再测
  const p = ProfileManager.get();
  const slot = p.deployment.units.indexOf(unit0.id);
  if (slot >= 0) p.deployment.units[slot] = null;
  game._handleDeployDragStart(c0x + 10, c0y + 10);
  await sleep(Game.DEPLOY_LONG_PRESS_MS + 60);
  assert(game._deployDrag.active === true, '长按拿起成功');
  game._handleDeployDragEnd(c0x + 10, c0y + 10, false);
  assert(game._deployDrag.active === false, '松开后拖拽复位');
  assert(game._unitDetailId === null, '原位放回不弹出兵种详情');
  // 2026-09-09 改造：羁绊详情面板已移除，此处不再断言 _synergyDetailId
}

console.log('=== 测试10: 长按拿起后拖到空白处松开 → 也不弹详情 ===');
{
  game._handleDeployDragStart(c0x + 10, c0y + 10);
  await sleep(Game.DEPLOY_LONG_PRESS_MS + 60);
  assert(game._deployDrag.active === true, '长按拿起成功');
  game._handleDeployDragMove(200, 690);
  game._handleDeployDragEnd(200, 690, true);
  assert(game._deployDrag.active === false, '松开后拖拽复位');
  assert(game._unitDetailId === null, '空白处放回不弹出兵种详情');
}

console.log('=== 测试11: 渲染冒烟（deploy_select 十帧无异常）===');
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
  assert(!err, `渲染无异常${err ? ': ' + err.message : ''}`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
