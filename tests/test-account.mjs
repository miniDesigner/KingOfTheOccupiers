// 账号系统 + 昵称交换测试
//
// 验证「对战知道谁是谁」的完整链路：
//   1. PlayerProfile.nickname：新档默认游客名「领主_XXXX」、旧档迁移补默认、序列化往返
//   2. SessionManager：本地持久化 uid（跨实例稳定可识别）、wx/localStorage 双环境
//   3. AsyncMatchSystem：generateOpponent 产出名字/奖杯分（异步对战身份源）
//   4. Game 接线：本地玩家名 = profile.nickname；异步快照 PvP 对手名 = snapshot.name
//
// 实时联机（LanConnector.hello bundle 的 name/uid 透传）已移除：
// 异步对战下身份信息在生成对手时一次性固化，无需双向握手交换。
//
// 用法: node tests/test-account.mjs

const noop = () => {};
const ctxProxy = new Proxy({}, {
  get: (t, p) => {
    if (p === 'canvas') return canvasStub;
    return (...args) => {
      if (p === 'measureText') return { width: 50 };
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return { addColorStop: noop };
      if (p === 'getImageData') return { data: [] };
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
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: noop,
  AudioContext: class {},
  location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
};
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {
  createInnerAudioContext() {
    return { src: '', loop: false, volume: 1, play: noop, pause: noop, stop: noop, seek: noop, destroy: noop, onEnded: noop, onError: noop, onCanplay: noop };
  },
  vibrateShort: noop, vibrateLong: noop,
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

// ========== 断言工具 ==========
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ========== 1. PlayerProfile.nickname ==========
console.log('\n=== PlayerProfile 昵称 ===');
const { PlayerProfile } = await import('../src/meta/PlayerProfile.js');

{
  const n = PlayerProfile.generateDefaultNickname();
  ok(/^领主_[0-9a-f]{4}$/.test(n), `默认游客名格式「领主_XXXX」(${n})`);

  const p = new PlayerProfile();
  ok(!!p.nickname && /^领主_[0-9a-f]{4}$/.test(p.nickname), '新档自动生成默认昵称');
  ok(p.serialize().nickname === p.nickname, 'serialize 包含 nickname');

  // 旧档迁移：无 nickname → 补默认
  const legacy = PlayerProfile.fromJSON({ gold: 999 });
  ok(/^领主_[0-9a-f]{4}$/.test(legacy.nickname), '旧档（无 nickname）迁移补默认昵称');

  // 已有昵称保留
  const kept = PlayerProfile.fromJSON({ gold: 1, nickname: '霸王龙' });
  eq(kept.nickname, '霸王龙', '已有昵称保留不覆盖');

  // 空串/非字符串 → 补默认
  const blank = PlayerProfile.fromJSON({ nickname: '' });
  ok(/^领主_[0-9a-f]{4}$/.test(blank.nickname), '空昵称 → 补默认');
}

// ========== 2. SessionManager 本地持久化 ==========
console.log('\n=== SessionManager 持久化 uid ===');
global.localStorage._d = {};
const { SessionManager } = await import('../src/net/SessionManager.js');

{
  const sm1 = new SessionManager();
  const id1 = await sm1.init();
  ok(!!id1.uid && id1.uid.startsWith('u_'), `首次 init 生成本地 uid（${id1.uid}）`);
  ok(!!id1.token && id1.token.startsWith('tk_'), '本地 token 已生成');

  // 第二实例（模拟再次进入游戏）应恢复同一 uid
  const sm2 = new SessionManager();
  const id2 = await sm2.init();
  eq(id2.uid, id1.uid, '再次进入恢复同一 uid（身份稳定）');

  // getUID / getToken / getOpenid
  eq(sm2.getUID(), id1.uid, 'getUID() 返回持久化 uid');
  eq(sm2.getToken(), id1.token, 'getToken() 返回持久化 token');

  // 注入 authProvider 走服务端登录（openid 来自服务端）
  global.localStorage._d = {};
  const sm3 = new SessionManager({
    async code2Session() { return { openid: 'wx-openid-abc', uid: 'srv_uid_1', token: 'srv_tk' }; },
  });
  const id3 = await sm3.init();
  eq(id3.uid, 'srv_uid_1', 'authProvider 返回 uid 被采用');
  eq(id3.openid, 'wx-openid-abc', 'authProvider 返回 openid 被采用');
}

// ========== 3. AsyncMatchSystem 对手身份生成 ==========
console.log('\n=== AsyncMatchSystem 对手身份 ===');
const { generateOpponent } = await import('../src/meta/AsyncMatchSystem.js');

{
  // 无 profile：默认 0 奖杯分段，名字/奖杯仍合法
  const opp0 = generateOpponent(null);
  ok(typeof opp0.name === 'string' && opp0.name.length > 0, 'name 是非空字符串');
  eq(typeof opp0.trophies, 'number', 'trophies 是数字');
  ok(opp0.trophies >= 0, 'trophies ≥ 0');
  ok(/(领主)_[0-9A-F]{4}/u.test(opp0.name), 'name 形如 "XXX领主_XXXX"（十六进制后缀）');

  // 有 profile：trophies 跟着玩家奖杯分段
  const profile = { trophies: 1500 };
  const opp1 = generateOpponent(profile);
  eq(typeof opp1.difficulty, 'string', 'difficulty 是字符串');
  eq(opp1.skillTier, undefined, 'skillTier 已移除（AI 一致化）');
  eq(opp1.powerRatio, undefined, 'powerRatio 已移除（AI 一致化）');
  // 对手奖杯 = 玩家 ± 浮动范围（[-40, +60]）
  ok(opp1.trophies >= Math.max(0, 1500 - 40), 'opponent.trophies 在玩家奖杯分下限上方');
  ok(opp1.trophies <= 1500 + 60, 'opponent.trophies 在玩家奖杯分上限下方');
}

// ========== 4. Game 接线：本地/对手昵称 ==========
console.log('\n=== Game 昵称接线 ===');
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const { syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();
try { await import('../src/data/races.js').then(m => m.syncRaces && m.syncRaces()); } catch (e) {}
try { await import('../src/data/levels.js').then(m => m.syncLevels && m.syncLevels()); } catch (e) {}

const { Game } = await import('../src/game/Game.js');
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;

global.localStorage._d = {};

{
  const gameA = new Game(canvasStub, ctxProxy, 400, 700);
  await gameA.start();

  // 固定昵称以便断言（模拟用户改名 / 默认游客名）
  ProfileManager.get().nickname = '测试领主A';
  const SEED = 20260902;
  // 异步快照 PvP 路径：对手名 = AsyncMatchSystem.generateOpponent 产出
  const oppA = generateOpponent(ProfileManager.get());
  gameA.initBattle(SEED, { mode: 'snapshot', snapshot: oppA });

  // 本地玩家名 = profile.nickname
  eq(gameA.players.find(p => p.id === 1).name, '测试领主A', '本地玩家名 = profile.nickname');
  // 对手名 = snapshot.name（异步快照由 AsyncMatchSystem 本地生成，无需双向握手）
  eq(gameA.players.find(p => p.id !== 1).name, oppA.name, '对手名 = snapshot.name');
  // 结算输入：_opponentTrophies 来自 snapshot.trophies（Elo 输入，不参与战斗演算）
  eq(gameA._opponentTrophies, oppA.trophies, '_opponentTrophies = snapshot.trophies');

  // sessionManager 已初始化
  ok(!!gameA.sessionManager && !!gameA.sessionManager.getUID(), 'Game.sessionManager 已初始化且 uid 可用');
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
