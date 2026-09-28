// 测试: 上阵界面品质外框 + 点击卡片打开详情 + 详情面板上阵按钮
// (修复: 长按查看详情改为点击；上阵槽位/卡片显示品质外框)
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
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
const { RenderSystem } = await import('../src/system/RenderSystem.js');

console.log('=== 测试1: getDeploymentSummary 槽位数据包含品质 ===');
const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();
// P38：引导激活时遮罩会拦截界面点击（本次要修的行为）。
// 本测试验证布阵功能本身，必须在「引导已完成」前提下运行。
ProfileManager.get().tutorialStep = 4;
ProfileManager.save();

{
  const profile = ProfileManager.get();
  // 给玩家一个非默认兵种，确保至少一个已上阵槽位
  const collected = DeploymentSystem.getCollectedUnitList();
  assert(collected.length > 0, `已拥有兵种非空(${collected.length})`);
  const summary = DeploymentSystem.getDeploymentSummary();
  const occupied = summary.units.filter(u => !u.empty);
  assert(occupied.length > 0, `已上阵槽位非空(${occupied.length})`);
  assert(occupied.every(u => u.quality >= 1 && u.quality <= 6), '每个已上阵槽位都带 1-6 的 quality 字段');
  // quality 与 config 一致
  const deployables = (await import('../src/data/ConfigLoader.js')).default.getSafe('deployables');
  const mismatch = occupied.find(u => (deployables.units[u.unitId]?.quality || 1) !== u.quality);
  assert(!mismatch, '槽位 quality 与配置一致');
}

console.log('=== 测试2: 点击兵种卡 → 打开详情（不再自动上阵）===');
{
  const profile = ProfileManager.get();
  const collected = DeploymentSystem.getCollectedUnitList();
  // 选一个未上阵的兵种
  const deployed = profile.deployment.units;
  const target = collected.find(u => !deployed.includes(u.id)) || collected[0];
  const L = RenderSystem.deployLayout(game.screenWidth, game.screenHeight);
  const w = game.screenWidth;
  const idx = collected.findIndex(u => u.id === target.id);
  const unitListY = L.unit.listY;
  const cardStartX = (w - (L.unit.perRow * L.unit.w + (L.unit.perRow - 1) * L.unit.gap)) / 2;
  const col = idx % L.unit.perRow;
  const row = Math.floor(idx / L.unit.perRow);
  const cx = cardStartX + col * (L.unit.w + L.unit.gap);
  const cy = unitListY + row * (L.unit.h + L.unit.gap) - (game.metaScrollY || 0);

  game.screenState = 'deploy_select';
  const before = JSON.stringify(ProfileManager.get().deployment.units);
  game._handleDeployDragStart(cx + 10, cy + 10);
  game._handleDeployDragEnd(cx + 10, cy + 10, false); // 模拟点击
  assert(game._unitDetailId === target.id, `点击卡片打开详情(${target.id})`);
  assert(JSON.stringify(ProfileManager.get().deployment.units) === before, '点击卡片不再自动上阵');
  assert(game._deployDrag.active === false, '点击后拖拽状态已复位(无虚影残留)');
}

console.log('=== 测试3: 详情面板「上阵」按钮 → 上阵到第一个空槽 ===');
{
  // 新档默认6槽全满，直接腾出槽位5模拟可上阵场景（测试专用）
  const profile = ProfileManager.get();
  profile.deployment.units[5] = null;
  ProfileManager.save();
  const collected = DeploymentSystem.getCollectedUnitList();
  const notDeployed = collected.find(u => !ProfileManager.get().deployment.units.includes(u.id));
  if (notDeployed) {
    game._unitDetailId = notDeployed.id;
    const w = game.screenWidth, h = game.screenHeight;
    const { panelW, panelH, panelX, panelY } = RenderSystem.unitDetailPanelLayout(w, h);
    const btnH = 38, btnY = panelY + panelH - 50, btnGap = 10;
    const btnW = (panelW - 40 - btnGap) / 2;
    const deployBtnX = panelX + 20;

    const emptySlot = 5;
    game._handleUnitDetailTap(deployBtnX + btnW / 2, btnY + btnH / 2);
    const after = ProfileManager.get().deployment.units;
    assert(after[emptySlot] === notDeployed.id, `上阵成功到 #${emptySlot + 1} 槽位`);
    // 再点一次 → 提示已在阵上，不重复上阵
    const countBefore = after.filter(Boolean).length;
    game._handleUnitDetailTap(deployBtnX + btnW / 2, btnY + btnH / 2);
    assert(ProfileManager.get().deployment.units.filter(Boolean).length === countBefore, '已上阵时重复点击不重复上阵');
  } else {
    console.log('  ⚠️ 收集的兵种不足7个，跳过上阵按钮测试');
  }
}

console.log('=== 测试4: 点击已上阵槽位 → 打开详情 ===');
{
  const profile = ProfileManager.get();
  const slotIdx = profile.deployment.units.findIndex(u => !!u);
  if (slotIdx >= 0) {
    const L = RenderSystem.deployLayout(game.screenWidth, game.screenHeight);
    const w = game.screenWidth;
    const uStartX = (w - (L.slot.count * L.slot.w + (L.slot.count - 1) * L.slot.gap)) / 2;
    const sx = uStartX + slotIdx * (L.slot.w + L.slot.gap);
    game._unitDetailId = null;
    game.screenState = 'deploy_select';
    game._handleDeployDragEnd(sx + L.slot.w / 2, L.slot.y + L.slot.h / 2, false);
    assert(game._unitDetailId === profile.deployment.units[slotIdx], `点击槽位 #${slotIdx + 1} 打开对应详情`);
  } else {
    console.log('  ⚠️ 无已上阵槽位，跳过');
  }
}

console.log('=== 测试5: 详情面板渲染含上阵按钮（升级按钮位置同步迁移）===');
{
  const profile = ProfileManager.get();
  const collected = DeploymentSystem.getCollectedUnitList();
  game._unitDetailId = collected[0].id;
  game.screenState = 'deploy_select';
  let err = null;
  try { game.render(0.016); } catch (e) { err = e; }
  assert(!err, `渲染详情面板无异常${err ? '(' + err.message + ')' : ''}`);
  game._unitDetailId = null;
}

console.log('=== 测试6: 上阵界面整屏渲染无异常（品质外框路径）===');
{
  game.screenState = 'deploy_select';
  let err = null;
  try { game.render(0.016); } catch (e) { err = e; }
  assert(!err, `渲染上阵界面无异常${err ? '(' + err.message + ')' : ''}`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
