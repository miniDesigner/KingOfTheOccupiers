// 测试: 合规系统（适龄提示 8+ / 实名引导 / 未成年人防沉迷前端管控）
// 重点验证：默认不误伤成年玩家、受管控后时段与时长拦截生效、渲染与命中共源。
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
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
  AudioContext: class {},
  location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
};
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {
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

const ComplianceSystem = (await import('../src/system/ComplianceSystem.js')).default;
const { AGE_RATING, MINOR_DAILY_LIMIT, TEEN_MODE_DAILY_LIMIT } = await import('../src/system/ComplianceSystem.js');
const { complianceCardLayout, complianceButtonLayout } = await import('../src/system/RenderSystem.js');
const { Game } = await import('../src/game/Game.js');

ComplianceSystem.reset();

console.log('=== 测试1: 无头环境默认不弹提示（不误伤所有点击断言）===');
{
  const s = ComplianceSystem.getStatus();
  assert(s.ageRating === '8+' && AGE_RATING === '8+', '适龄提示等级为 8+');
  assert(s.noticeAccepted === true, 'Node 测试环境视为已确认适龄提示');
  assert(s.needsNotice === false, '无头环境 needsNotice=false，不遮挡点击');
  assert(s.blocked === false && s.controlled === false, '未声明未成年时不拦截任何玩家');
}

console.log('=== 测试2: 每日上限常量 ===');
{
  assert(MINOR_DAILY_LIMIT === 3600, '未成年人每日上限 1 小时');
  assert(TEEN_MODE_DAILY_LIMIT === 1800, '青少年模式每日上限 30 分钟');
  assert(ComplianceSystem.dailyLimit() === 3600, '默认上限取未成年人 1 小时');
  ComplianceSystem.toggleMinorMode();
  assert(ComplianceSystem.dailyLimit() === 1800, '开启青少年模式后上限变 30 分钟');
  ComplianceSystem.toggleMinorMode();
  assert(ComplianceSystem.dailyLimit() === 3600, '关闭后恢复 1 小时');
}

console.log('=== 测试3: 时段管控（仅周五/六/日 20:00–21:00）===');
{
  ComplianceSystem.setIdentity('minor');
  // 2026-11-18 是周三，2026-11-21 是周六
  const wednesday10 = new Date(2026, 10, 18, 10, 0, 0);
  const saturday20 = new Date(2026, 10, 21, 20, 30, 0);
  const saturday22 = new Date(2026, 10, 21, 22, 0, 0);
  assert(ComplianceSystem.isTimeBlocked(wednesday10) === true, '周三 10 点禁止未成年人游玩');
  assert(ComplianceSystem.isTimeBlocked(saturday20) === false, '周六 20:30 允许游玩');
  assert(ComplianceSystem.isTimeBlocked(saturday22) === true, '周六 22 点禁止游玩');

  ComplianceSystem.setIdentity('adult');
  assert(ComplianceSystem.isTimeBlocked(wednesday10) === false, '成人身份不受时段管控');
  ComplianceSystem.setIdentity('unknown');
}

console.log('=== 测试4: 时长累计与超限拦截 ===');
{
  ComplianceSystem.reset();
  ComplianceSystem.setIdentity('minor');
  for (let i = 0; i < 719; i++) ComplianceSystem.recordPlayTime(5);
  assert(ComplianceSystem.getStatus().limitReached === false, '3595 秒未达上限');
  ComplianceSystem.recordPlayTime(5);
  assert(ComplianceSystem.getStatus().limitReached === true, '3600 秒达到上限');
  const s = ComplianceSystem.getStatus();
  assert(s.blocked === true && s.blockReason === 'limit', '超限后进入拦截态');
  assert(s.remainingSeconds === 0, '剩余时长归零');
  ComplianceSystem.recordPlayTime(999);
  assert(ComplianceSystem.getStatus().playSecondsToday === 3600, '异常大 dt 被忽略，不污染累计');
  ComplianceSystem.reset();
}

console.log('=== 测试5: 渲染与命中共用布局函数 ===');
{
  const w = 400, h = 700;
  const card = complianceCardLayout(w, h);
  const b0 = complianceButtonLayout(w, h, 0);
  const b1 = complianceButtonLayout(w, h, 1);
  assert(card.x >= 0 && card.y >= 0 && card.x + card.w <= w && card.y + card.h <= h, '提示卡在屏内');
  assert(b0.y + b0.h <= b1.y, '实名引导按钮与主按钮不重叠');
  assert(b0.x === b1.x && b0.w === b1.w, '两按钮同宽同行居中');
  assert(b1.y + b1.h <= card.y + card.h, '主按钮不溢出卡片底部');
}

console.log('=== 测试6: 设置窗口新增合规入口 ===');
{
  const game = new Game(canvasStub, ctxProxy, 400, 700);
  await game.start();
  const S = Game.SETTINGS_LAYOUT;
  assert(S.panelH === 432, '设置面板扩展到 6 行高度 432');
  const r5 = Game.settingsRowRect(5, 400, 700);
  const p = Game.settingsPanel(400, 700);
  assert(r5.y + r5.h <= p.y + p.h, '青少年模式行在面板内');

  const before = ComplianceSystem.getStatus().minorMode;
  game._settingsOpen = true;
  game._handleSettingsTap(r5.x + 20, r5.y + 20);
  assert(ComplianceSystem.getStatus().minorMode === !before, '点击第 5 行切换青少年模式');
  game._handleSettingsTap(r5.x + 20, r5.y + 20);
  assert(ComplianceSystem.getStatus().minorMode === before, '再次点击恢复原状态');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
