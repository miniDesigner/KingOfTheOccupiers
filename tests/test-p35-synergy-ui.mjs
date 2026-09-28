// 测试 P35: 1)招募广告按钮避让返回按钮 2)大厅上阵兵种品质外框
//        3)布阵槽位去除星星 4)羁绊栏图标+中文 5)羁绊槽点击弹详情
const noop = () => {};

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
        if (p === 'fillText' || p === 'strokeRect' || p === 'fillRect') {
          calls.push({ op: p, args, state: { ...state } });
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
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const { SynergySystem } = await import('../src/system/SynergySystem.js');
const { RenderSystem } = await import('../src/system/RenderSystem.js');

const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();
// P38：引导激活时遮罩会拦截界面点击（本次要修的行为）。
// 本测试验证布阵功能本身，必须在「引导已完成」前提下运行。
ProfileManager.get().tutorialStep = 4;
ProfileManager.save();

const cfg = ConfigLoader.getSafe('deployables');
const QUALITY_COLORS = ['#9ca3af', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ef4444'];
const SCREENS = [[320, 480], [360, 640], [390, 844], [400, 700], [480, 900]];

// ==================== 1. 招募广告按钮 vs 返回按钮 ====================
console.log('=== 测试1: 招募广告按钮不再压住左下角返回按钮 ===');
{
  const BACK = Game.BACK_BUTTON;
  for (const [sw, sh] of SCREENS) {
    const L = RenderSystem.gachaLayout(sw, sh);
    const backTop = sh - BACK.bottomOffset - BACK.h;
    const backBottom = sh - BACK.bottomOffset;
    const adBottom = L.adBtnY + L.adBtnH;
    assert(adBottom <= backTop,
      `${sw}x${sh} 广告按钮底 ${adBottom} ≤ 返回按钮顶 ${backTop}`);
    assert(backTop - adBottom >= 8,
      `${sw}x${sh} 与返回按钮留 ${backTop - adBottom}px 间隙`);
    // 水平方向也不重叠（保险）
    const overlapX = !(L.adBtnX + L.adBtnW <= BACK.x || L.adBtnX >= BACK.x + BACK.w);
    const overlapY = !(adBottom <= backTop || L.adBtnY >= backBottom);
    assert(!(overlapX && overlapY), `${sw}x${sh} 广告/返回按钮矩形无交集`);
    assert(L.adBtnY + L.adBtnH <= sh, `${sw}x${sh} 广告按钮仍在屏幕内`);
  }
}

console.log('=== 测试2: 上移后其余栏位仍保持间隙 ===');
{
  const L = RenderSystem.gachaLayout(400, 700);
  const bars = [
    ['标题', L.titleY, 18], ['已收集', L.ownedY, 11], ['收集进度条', L.progressY + 3, 6],
    ['保底文字', L.pityTextY, 10], ['保底条', L.pityBarY + 2, 4], ['概率标题', L.rateTitleY, 11],
    ['概率首行', L.rateStartY, 11], ['概率末行', L.rateStartY + 5 * L.rateStep, 11],
    ['说明1', L.noteY1, 10], ['说明2', L.noteY2, 10],
    ['抽卡按钮', L.btnY + L.btnH / 2, L.btnH], ['优惠提示', L.discountY, 10],
    ['广告按钮', L.adBtnY + L.adBtnH / 2, L.adBtnH],
  ];
  let ok = true, bad = '';
  for (let i = 0; i < bars.length - 1; i++) {
    const [, y1, h1] = bars[i];
    const [n2, y2, h2] = bars[i + 1];
    if (y1 + h1 / 2 > y2 - h2 / 2) { ok = false; bad = `${bars[i][0]} 与 ${n2} 重叠`; break; }
  }
  assert(ok, `13 栏全部无重叠${bad ? ' — ' + bad : ''}`);
}

// ==================== 2. 大厅品质外框 ====================
console.log('=== 测试3: 大厅上阵兵种卡片按品质着色外框 ===');
{
  const rs = new RenderSystem(ctxProxy, 400, 700);
  const profile = ProfileManager.get();
  const origUnits = [...(profile.deployment.units || [])];
  // 取 3 个不同品质的兵种塞进上阵槽位，确保覆盖多种颜色
  const allUnits = Object.entries(cfg.units);
  const byQ = {};
  for (const [id, u] of allUnits) {
    const q = u.quality || 1;
    if (!byQ[q]) byQ[q] = id;
  }
  const picked = Object.keys(byQ).sort((a, b) => b - a).slice(0, 3).map((q) => byQ[q]);
  profile.deployment.units = [picked[0], picked[1], picked[2], null, null, null];

  ctxProxy.__calls.length = 0;
  rs.drawLobby({ profile, accountInfo: null, powerInfo: null, lobbyBadges: {} });

  const SLOT_Y = 140 + 15; // deployY + 15
  const frames = ctxProxy.__calls.filter(
    (c) => c.op === 'strokeRect' && c.args[1] === SLOT_Y && c.args[3] === 65
  );
  assert(frames.length >= 3, `大厅绘制了 ${frames.length} 个上阵卡片外框`);
  const colored = frames.filter((f) => f.state.strokeStyle !== '#475569');
  assert(colored.length === 3, `3 个有兵种槽位用品质色（空槽位仍为灰）`);

  let allMatch = true;
  for (let i = 0; i < 3; i++) {
    const q = cfg.units[picked[i]].quality || 1;
    const expect = QUALITY_COLORS[q - 1];
    const hit = frames.some((f) => f.state.strokeStyle === expect);
    if (!hit) { allMatch = false; console.log(`      (缺少 ${picked[i]} Q${q} 期望色 ${expect})`); }
  }
  assert(allMatch, '每个上阵兵种卡片外框颜色 = 其品质色');
  assert(frames.slice(3).every((f) => f.state.strokeStyle === '#475569'), '空槽位保持灰色边框');

  // 还原上阵数据（临时兵种可能未收集，会让 bundle 为空）
  profile.deployment.units = origUnits;
  game._invalidateDeploymentBundle();
}

// ==================== 3. 布阵槽位去除星星 ====================
console.log('=== 测试4: 布阵界面不再用星星表达品质 ===');
{
  const rs = new RenderSystem(ctxProxy, 400, 700);
  ctxProxy.__calls.length = 0;

  const deployState = {
    profile: ProfileManager.get(),
    deploymentSummary: DeploymentSystem.getDeploymentSummary(),
    collectedUnits: DeploymentSystem.getCollectedUnitList(),
    autoSynergies: SynergySystem.getAutoSynergyPanelData(game._ensureDeploymentBundle()),
    deployDrag: { active: false },
    metaScrollY: 0,
    showRecruitPanel: false,
  };
  rs.drawDeploySelect(deployState);
  const stars = ctxProxy.__calls.filter((c) => c.op === 'fillText' && String(c.args[0]).includes('★'));
  assert(stars.length === 0, `布阵界面无 ★ 品质文本（找到 ${stars.length} 处）`);
}

// ==================== 4. 羁绊栏图标 + 中文 ====================
console.log('=== 测试5: 羁绊栏永远返回 4 类，带真实图标与中文名 ===');
{
  const bundle = game._ensureDeploymentBundle();
  const list = SynergySystem.getAutoSynergyPanelData(bundle);
  assert(list.length === 4, `羁绊栏返回 4 类（实际 ${list.length}）`);
  const engRe = /^[A-Za-z_\s]+$/;
  for (const s of list) {
    assert(!!s.icon && s.icon !== '?', `${s.id} 有真实图标 ${s.icon}`);
    assert(!!s.name && !engRe.test(s.name), `${s.id} 羁绊名为中文「${s.name}」`);
    assert(!!s.styleName && !engRe.test(s.styleName), `${s.id} 风格名为中文「${s.styleName}」`);
  }
  const order = list.map((s) => s.style).join(',');
  assert(order === 'melee,ranged,defense,magic', `卡片顺序固定 ${order}`);
}

console.log('=== 测试6: 布阵界面 gameState.autoSynergies 非空（不再回落英文）===');
{
  game.screenState = 'deploy_select';
  let captured = null;
  const origRender = game.renderSystem.render.bind(game.renderSystem);
  game.renderSystem.render = (gs) => { captured = gs; };
  game.render(0);
  game.renderSystem.render = origRender;
  const gs = captured || {};
  assert(!!captured, 'render 成功产出 gameState');
  assert(Array.isArray(gs.autoSynergies) && gs.autoSynergies.length === 4,
    `autoSynergies 长度 ${gs.autoSynergies?.length}`);
  assert(gs.autoSynergies.every((s) => s.icon && s.icon !== '?'), '每类羁绊都有图标');
  const eng = gs.autoSynergies.filter((s) => /^[a-z]+$/.test(s.name || ''));
  assert(eng.length === 0, '无英文羁绊名残留');
}

// ==================== 5. 羁绊详情弹窗 ====================
console.log('=== 测试7: getSynergyDetail 返回激活方式与各级效果 ===');
{
  const ids = Object.keys(cfg.synergies);
  for (const id of ids) {
    const d = SynergySystem.getSynergyDetail(id, game._ensureDeploymentBundle());
    assert(!!d, `${id} 详情非空`);
    assert(d.name === cfg.synergies[id].name, `${id} 名称 = ${d.name}`);
    assert(d.levels.length === 6, `${id} 有 6 级效果表`);
    assert(/上阵「.+」风格兵种/.test(d.activateDesc), `${id} 激活说明: ${d.activateDesc}`);
    assert(/当前上阵 \d+ 个/.test(d.currentDesc), `${id} 当前状态: ${d.currentDesc}`);
    if (d.count > 0) {
    assert(d.active && d.level >= 1, `${id} 上阵 ${d.count} 个 → 已激活 Lv.${d.level}`);
    assert(d.currentEffects.length > 0, `${id} 当前等级效果: ${d.currentEffects.join(' ')}`);
    assert(d.sourceUnits.length === d.count, `${id} 贡献兵种数 ${d.sourceUnits.length} = 上阵数 ${d.count}`);
    assert(d.levels.filter((l) => l.active).length === d.level, `${id} 已激活等级行数 = Lv.${d.level}`);
  }
  const allEffects = d.levels.flatMap((l) => l.effects);
    assert(allEffects.length > 0, `${id} 各级效果非空`);
    const rawKey = allEffects.filter((e) => /Bonus|Reduction|Strike/i.test(e));
    assert(rawKey.length === 0, `${id} 效果已中文化（无英文 key 泄漏），示例: ${allEffects[0]}`);
    assert(allEffects.some((e) => /%|先手/.test(e)), `${id} 效果含数值或标记`);
  }
}

console.log('=== 测试8: 点击羁绊卡 → 弹出详情，点击外部/关闭按钮 → 关闭 ===');
{
  const rs = new RenderSystem(ctxProxy, 400, 700);
  game.screenState = 'deploy_select';
  game._synergyDetailId = null;
  game._unitDetailId = null;
  game._buildingDetailType = null;
  game._showRecruitPanel = false;
  game._deployDrag = { active: false };

  const apc = RenderSystem.deployLayout(400, game.screenHeight).synergy;
  const cx = apc.startX + apc.size / 2;
  const cy = apc.y + apc.size / 2;

  game._handleDeployDragEnd(cx, cy, false);
  assert(!!game._synergyDetailId, `点击第 1 张羁绊卡打开详情 (${game._synergyDetailId})`);

  const bundle2 = game._ensureDeploymentBundle();
  const gs = {
    synergyDetailId: game._synergyDetailId,
    synergyDetailData: SynergySystem.getSynergyDetail(game._synergyDetailId, bundle2),
  };
  assert(!!gs.synergyDetailData, 'gameState.synergyDetailData 有数据');
  assert(gs.synergyDetailData.id === game._synergyDetailId, '详情数据与点击的羁绊一致');

  // 渲染不抛异常
  let err = null;
  try { rs._drawSynergyDetailPanel(gs); } catch (e) { err = e; }
  assert(!err, '羁绊详情面板渲染无异常' + (err ? ' — ' + err.message : ''));

  // 点击面板外 → 关闭
  game._handleSynergyDetailTap(5, 5);
  assert(game._synergyDetailId === null, '点击遮罩关闭详情');

  // 再打开 → 点关闭按钮
  const card3x = apc.startX + 2 * (apc.size + apc.gap) + apc.size / 2;
  game._handleDeployDragEnd(card3x, cy, false);
  assert(!!game._synergyDetailId, '点击第 3 张羁绊卡打开详情');
  const { panelX, panelW, panelY } = RenderSystem.synergyDetailPanelLayout(400, 700);
  game._handleSynergyDetailTap(panelX + panelW - 20, panelY + 20);
  assert(game._synergyDetailId === null, '点击关闭按钮关闭详情');
}

console.log('=== 测试9: 详情打开时点击不再穿透到兵种卡 ===');
{
  game.screenState = 'deploy_select';
  game._synergyDetailId = null;
  game._unitDetailId = null;
  const apc = RenderSystem.deployLayout(400, game.screenHeight).synergy;
  game._handleDeployDragEnd(apc.startX + apc.size / 2, apc.y + apc.size / 2, false);
  const openedId = game._synergyDetailId;
  assert(!!openedId, '先打开羁绊详情');
  // 再点在羁绊卡上（应交给详情面板处理，不会打开兵种详情）
  game._handleDeployDragEnd(apc.startX + apc.size / 2, apc.y + apc.size / 2, false);
  assert(!game._unitDetailId, '羁绊详情打开时不误开兵种详情');
  game._synergyDetailId = null;
}

console.log(`\n📊 结果: ${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
