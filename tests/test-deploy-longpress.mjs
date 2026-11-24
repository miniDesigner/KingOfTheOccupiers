// 测试: 兵种长按拖拽 + 羁绊无拖拽（上阵/卸下全部走详情面板）
// (交互规则: 轻点=查看详情；原地按住 DEPLOY_LONG_PRESS_MS(500ms)=拿起拖拽；
//  按下即滑动=滚动列表且取消长按候选，绝不与上下滑动冲突；拿起后松手=放回，不弹详情)
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
// 2026-11-24 图鉴改为「拥有 > 品质 > 序号」排序：坐标取样必须走渲染层实际消费的
// getAllUnitCardList()，不能再按 getCollectedUnitList() 的收集顺序取第一张。
const collected = DeploymentSystem.getAllUnitCardList();
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
  const scrollBefore = game.metaScrollY || 0;
  game._handleDeployDragMove(slotX, L.slot.y + L.slot.h / 2);
  assert((game.metaScrollY || 0) === scrollBefore, '拿起后拖动不滚动图鉴列表');
  game._handleDeployDragEnd(slotX, L.slot.y + L.slot.h / 2, true);
  assert(ProfileManager.get().deployment.units[emptySlotIdx] === unit0.id, `拖拽放置成功上阵到 #${emptySlotIdx + 1}`);
  assert(game._deployDrag.active === false, '松开后拖拽复位');
}

console.log('=== 测试3: 按住未满1秒即滑动 → 取消长按候选、滚动列表、绝不拿起 ===');
{
  // 测试2把 unit0 留在了槽位上，先腾空（已上阵的卡不产生拖拽候选）
  const pre = ProfileManager.get();
  const preSlot = pre.deployment.units.indexOf(unit0.id);
  if (preSlot >= 0) pre.deployment.units[preSlot] = null;
  game._unitDetailId = null;
  game._deployDrag.active = false;
  game.metaScrollY = 0;
  game._handleDeployDragStart(c0x + 10, c0y + 10);
  assert(game._deployPress !== null && game._deployPressTimer !== null, '按下产生长按候选与计时器');
  game._handleDeployDragMove(c0x + 10, c0y - 5); // 向上滑15px（超过 8px slop）
  assert(game._deployPress === null && game._deployPressTimer === null, '滑动后候选与计时器被取消');
  assert(game._deployDrag.active === false, '滑动不激活拖拽');
  assert((game.metaScrollY || 0) > 0, `从卡片上起手滑动即滚列表(scrollY=${game.metaScrollY})`);
  // 关键回归：即使继续按住超过 1 秒，也不能在滑动之后突然拿起卡片
  await sleep(Game.DEPLOY_LONG_PRESS_MS + 60);
  assert(game._deployDrag.active === false, '滑动取消后继续按住超过1秒也不会突然拿起');
  game._handleDeployDragEnd(c0x + 10, c0y - 5, true);
  assert(game._deployDrag.active === false, '松手后拖拽保持复位');
  assert(game._unitDetailId === null, '滚动手势不误开兵种详情');
  game.metaScrollY = 0;
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

console.log('=== 测试11b: 图鉴立绘使用主立绘并按原图比例等比铺满 ===');
{
  const origArtUnit = RenderSystem.prototype._artUnit;
  const calls = [];
  RenderSystem.prototype._artUnit = function (n, x, y, cw, ch, small, opts) {
    calls.push({ n, x, y, cw, ch, small, opts });
    return origArtUnit.call(this, n, x, y, cw, ch, small, opts);
  };
  let err = null;
  try {
    game.screenState = 'deploy_select';
    game._deployDrag.active = false;
    game.metaScrollY = 0;
    game.render();
  } catch (e) { err = e; }
  finally { RenderSystem.prototype._artUnit = origArtUnit; }
  assert(!err, `图鉴立绘比例渲染无异常${err ? ': ' + err.message : ''}`);
  const galleryCalls = calls.filter(c =>
    Math.abs(c.cw - card.h * 174 / 216) < 0.6 && Math.abs(c.ch - card.h) < 0.6);
  assert(galleryCalls.length >= 4, `图鉴卡按原图比例取景框绘制（命中${galleryCalls.length}张）`);
  assert(galleryCalls.every(c => c.small === false), '图鉴卡改回主立绘 unit_XX，不再用 96×96 裁切小图');
  assert(galleryCalls.every(c => Math.abs(c.cw / c.ch - 174 / 216) < 0.01), '取景框固定 174:216，不随屏宽变化');
  assert(galleryCalls.every(c => c.opts && c.opts.fit === 'cover'), '图鉴卡使用 cover 等比裁切，保持 174×216 原图比例');
}

console.log('\n=== 测试: 拖动跟随卡立绘序号可从两种导出通道取得 ===');
{
  const mod = await import('../src/meta/DeploymentSystem.js');
  const unitId = collected[0].id;
  assert(typeof mod.getUnitArtIndex === 'function', '命名导出 getUnitArtIndex 可用（拖动跟随卡依赖）');
  assert(typeof DeploymentSystem.getUnitArtIndex === 'function', '默认导出 getUnitArtIndex 可用');
  const idx = mod.getUnitArtIndex(unitId);
  assert(idx >= 1 && idx <= 40, `${unitId} 立绘序号 ${idx} 落在 1~40`);
  assert(DeploymentSystem.getUnitArtIndex(unitId) === idx, '两种导出通道结果一致');
  // 真实拖动状态下渲染一帧，防止拖动渲染路径回归（此前 default 缺方法导致整屏渲染抛错）
  let err = null;
  try {
    game.screenState = 'deploy_select';
    game._deployDrag = { active: true, type: 'unit', id: unitId, fromSlot: 0, x: 80, y: 120 };
    game.render();
    game._deployDrag.active = false;
  } catch (e) { err = e; }
  assert(!err, `拖动状态下渲染无异常${err ? ': ' + err.message : ''}`);
}

console.log('\n=== 测试: 图鉴排序 = 拥有优先 > 品质降序 > 序号升序 ===');
{
  const p = ProfileManager.get();
  const savedCollected = JSON.parse(JSON.stringify(p.collectedUnits));
  try {
    // 故意以「低品质先收集、高品质后收集」的乱序注入，验证排序不依赖收集顺序
    p.collectedUnits = {
      archer: { level: 1 },          // q1 / 02
      swordsman: { level: 1 },       // q1 / 01
      dragonling: { level: 1 },      // q6 / 38
      paladin: { level: 1 },         // q4 / 26
    };
    const list = DeploymentSystem.getAllUnitCardList();
    assert(list.length === 40, `图鉴仍是全量 40 张卡（实际 ${list.length}）`);
    assert(list.slice(0, 4).map(u => u.id).join(',') === 'dragonling,paladin,swordsman,archer',
      '已拥有区按品质降序、同品质按序号升序（与前40序号对应）');
    assert(list.slice(0, 4).every(u => u.owned) && list.slice(4).every(u => !u.owned),
      '全部已拥有卡排在全部未拥有卡之前');
    assert(list.slice(4, 6).map(u => u.id).join(',') === 'war_titan,archdragon',
      '未拥有区同样按品质降序、同品质按序号升序');
    // 全量不变量检查：任意相邻两张都满足三级排序
    let ordered = true;
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (a.owned !== b.owned) { if (!a.owned) ordered = false; continue; }
      if (a.quality !== b.quality) { if (a.quality < b.quality) ordered = false; continue; }
      if (a.artIndex > b.artIndex) ordered = false;
    }
    assert(ordered, '全量 40 张卡满足三级排序不变量');
  } finally {
    p.collectedUnits = savedCollected;
  }
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
