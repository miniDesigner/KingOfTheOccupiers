/**
 * 大厅玩家账号信息展示测试（Phase 7 P0 收尾）
 *
 * 验证：
 *   1. RenderSystem.drawLobby 有 accountInfo 时绘制昵称 + 账号尾号（uid 后 6 位）
 *   2. accountInfo.uid 为空时不绘制尾号（仍绘制昵称）
 *   3. accountInfo 缺失时不绘制账号信息（无 👤 / 无「账号尾号」文本）
 *   4. uid 尾号截取语义 = slice(-6)
 *   5. Game.render 组装 accountInfo：大厅态注入昵称 + uid；非大厅态为 null
 *
 * 关键约束：昵称 / uid 属「呈现层 + 握手层」数据，绝不进入帧同步 checksum。
 *
 * 用法: node tests/test-lobby-account.mjs
 */

const noop = () => {};

// ===== Canvas / ctx Proxy（支持 set 写入 + fillText 可替换，复用 test-wechat-share 模式）=====
const canvasStub = {
  width: 400, height: 700, style: {},
  getContext: () => ctxProxy,
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }),
};
const ctxProxy = new Proxy({}, {
  get: (t, p) => {
    if (p in t && t[p] !== undefined) {
      if (p === 'canvas') return canvasStub;
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    }
    if (p === 'canvas') return canvasStub;
    return (...args) => {
      if (p === 'measureText') return { width: 50 };
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return { addColorStop: noop };
      if (p === 'getImageData') return { data: [] };
      return undefined;
    };
  },
  set: (t, p, v) => { t[p] = v; return true; },
});

// ===== 全局环境 mock =====
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
  location: { href: 'http://127.0.0.1:8890/preview/index.html', hostname: '127.0.0.1', reload: noop, search: '' },
};
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {
  createInnerAudioContext() {
    return { src: '', loop: false, volume: 1, play: noop, pause: noop, stop: noop, seek: noop, destroy: noop, onEnded: noop, onError: noop, onCanplay: noop };
  },
  vibrateShort: noop, vibrateLong: noop,
  showToast: noop,
  setStorageSync: noop, getStorageSync: () => null,
  removeStorageSync: noop,
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

// ===== 断言工具 =====
let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}

// ===== 初始化配置 + 导入 =====
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const { syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();
try { await import('../src/data/races.js').then(m => m.syncRaces && m.syncRaces()); } catch (e) {}
try { await import('../src/data/levels.js').then(m => m.syncLevels && m.syncLevels()); } catch (e) {}

const { PlayerProfile } = await import('../src/meta/PlayerProfile.js');
const PowerSystem = (await import('../src/meta/PowerSystem.js')).default;
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
const { RenderSystem } = await import('../src/system/RenderSystem.js');
const { Game } = await import('../src/game/Game.js');

const renderer = new RenderSystem(ctxProxy, 400, 700);

// 构造 drawLobby 所需的最简 gameState（字段与 test-power-system.mjs 对齐）
function makeLobbyState(profile) {
  return {
    screenState: 'lobby',
    profile,
    powerInfo: PowerSystem.getLobbyPowerInfo(profile),
    ladderTier: { icon: '🛡', label: '青铜', color: '#b45309' },
    ladderProgress: { ratio: 0.1, cur: 20, need: 200, next: { icon: '⚪', label: '白银' } },
    seasonDaysLeft: 7,
    shareRewardClaimed: true,
    tutorialStep: 4,
    lobbyBadges: null,
  };
}

// 捕获 drawLobby 的 fillText 调用
const texts = [];
ctxProxy.fillText = function (t, x, y) { texts.push(String(t)); };

// ===== Part A: RenderSystem.drawLobby 账号信息渲染 =====
console.log('=== A1: 有 accountInfo 时绘制昵称 + 账号尾号 ===');
{
  texts.length = 0;
  const gs = makeLobbyState(new PlayerProfile());
  gs.accountInfo = { nickname: '领主_ABC', uid: 'u_test_abcd1234' };
  renderer.drawLobby(gs);
  assert(texts.some(t => t.includes('领主_ABC')), `绘制昵称（texts 含"领主_ABC"）`);
  assert(texts.some(t => t.includes('账号尾号 cd1234')), `绘制账号尾号 = uid 后 6 位（含"账号尾号 cd1234"）`);
}

console.log('=== A2: uid 为空时只绘制昵称、不绘制尾号 ===');
{
  texts.length = 0;
  const gs = makeLobbyState(new PlayerProfile());
  gs.accountInfo = { nickname: '领主_X', uid: null };
  renderer.drawLobby(gs);
  assert(texts.some(t => t.includes('领主_X')), `仍绘制昵称（含"领主_X"）`);
  assert(!texts.some(t => t.includes('账号尾号')), `不含"账号尾号"文本`);
}

console.log('=== A3: 无 accountInfo 时不绘制账号信息 ===');
{
  texts.length = 0;
  const gs = makeLobbyState(new PlayerProfile());
  gs.accountInfo = undefined;
  renderer.drawLobby(gs);
  assert(!texts.some(t => t.includes('账号尾号')), `不含"账号尾号"文本`);
  assert(!texts.some(t => t.includes('👤')), `不含账号昵称行（👤）`);
}

console.log('=== A4: uid 尾号截取语义 ===');
{
  const uid = 'u_m4xk2j3x_ab12cd34';
  assert(uid.slice(-6) === '12cd34', `uid.slice(-6) = 最后 6 位（got "${uid.slice(-6)}"）`);
}

// ===== Part B: Game.render 组装 accountInfo =====
global.localStorage._d = {};
const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();

console.log('=== B1: 大厅态注入昵称 + uid ===');
{
  game.screenState = 'lobby';
  const profile = ProfileManager.get();
  profile.nickname = '领主_测试';
  const uid = game.sessionManager.getUID();

  let captured = null;
  const origRender = game.renderSystem.render.bind(game.renderSystem);
  game.renderSystem.render = (gs) => { captured = gs; };
  game.render(0);
  game.renderSystem.render = origRender;

  assert(captured && captured.accountInfo, `accountInfo 已组装（got ${captured && JSON.stringify(captured.accountInfo)}）`);
  assert(captured && captured.accountInfo.nickname === '领主_测试', `昵称正确（got "${captured && captured.accountInfo.nickname}"）`);
  assert(captured && captured.accountInfo.uid === uid, `uid 来自 sessionManager（got "${captured && captured.accountInfo.uid}"）`);
}

console.log('=== B2: 非大厅态 accountInfo 为 null ===');
{
  game.screenState = 'shop';
  let captured = null;
  const origRender = game.renderSystem.render.bind(game.renderSystem);
  game.renderSystem.render = (gs) => { captured = gs; };
  game.render(0);
  game.renderSystem.render = origRender;

  assert(captured && captured.accountInfo === null, `非大厅态 accountInfo=null（got ${captured && JSON.stringify(captured.accountInfo)}）`);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
