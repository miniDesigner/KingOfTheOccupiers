// 多账号系统测试（登录 / 切换 / 注销）
//
// 验证 AccountManager 的完整账号生命周期 + ProfileManager/SessionManager 的命名空间改造：
//   1. AccountManager 登录/切换/注销（浏览器 + 微信双环境）
//   2. 旧单账号数据迁移（territory_king_profile/session → 默认账号 acc_default）
//   3. ProfileManager 多账号 key 隔离（不同账号读到自己独立的存档）
//   4. SessionManager 从 AccountManager 拿 uid
//   5. Game 集成：start 后 uid 来自账号元数据；登录新账号 / 切换 / 注销后 profile 隔离
//
// 用法: node tests/test-account-switch.mjs

const noop = () => {};

// ========== 轻量存储 mock（Section 1-4 用） ==========
function makeWxStore() {
  const store = {};
  return {
    store,
    wx: {
      setStorageSync(k, v) { store[k] = JSON.parse(JSON.stringify(v)); },
      getStorageSync(k) { return (k in store) ? JSON.parse(JSON.stringify(store[k])) : null; },
      removeStorageSync(k) { delete store[k]; },
    },
  };
}
function makeLocalStorage() {
  const d = {};
  return {
    getItem(k) { return (k in d) ? d[k] : null; },
    setItem(k, v) { d[k] = String(v); },
    removeItem(k) { delete d[k]; },
  };
}
function setWxEnv(extra = {}) {
  const { store, wx } = makeWxStore();
  global.wx = { ...wx, ...extra };
  delete global.localStorage;
  return store;
}
function setBrowserEnv() {
  delete global.wx;
  global.localStorage = makeLocalStorage();
  return global.localStorage;
}

// ========== 断言工具 ==========
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

const { AccountManager } = await import('../src/meta/AccountManager.js');
const PM = (await import('../src/meta/ProfileManager.js')).default;
const { SessionManager } = await import('../src/net/SessionManager.js');

// ========== 1. 登录 / 切换 / 注销（浏览器分支） ==========
console.log('\n=== AccountManager 登录/切换/注销（浏览器） ===');
{
  const ls = setBrowserEnv();
  const def = AccountManager.init();
  ok(!!def, 'init 建立默认账号');
  ok(def.id === 'acc_default', `默认账号 id 为 acc_default（got ${def.id}）`);
  ok(/^u_/.test(def.uid), `默认账号 uid 格式（${def.uid}）`);
  ok(/^领主_[0-9a-f]{4}$/.test(def.nickname), `默认账号昵称格式（${def.nickname}）`);
  eq(AccountManager.list().length, 1, '初始 1 个账号');
  eq(AccountManager.getCurrentId(), 'acc_default', '当前账号 = default');
  eq(AccountManager.getUID(), def.uid, 'getUID() 返回当前 uid');

  // 登录新账号
  const b = AccountManager.login('账号B');
  eq(AccountManager.list().length, 2, '登录后 2 个账号');
  eq(AccountManager.getCurrentId(), b.id, '登录后切到新账号');
  eq(AccountManager.getCurrent().nickname, '账号B', '登录指定昵称生效');
  ok(b.uid !== def.uid, '新账号 uid 与默认不同');

  // 切换回默认账号
  const sw = AccountManager.switchTo('acc_default');
  eq(sw.id, 'acc_default', 'switchTo 返回默认账号');
  eq(AccountManager.getCurrentId(), 'acc_default', '切换后当前 = default');
  eq(AccountManager.getUID(), def.uid, '切换后 uid 恢复 default');

  // 切换不存在的账号 → null
  eq(AccountManager.switchTo('acc_nonexist'), null, '切换不存在账号返回 null');

  // 登录第三个账号 C，然后注销 C
  const c = AccountManager.login('账号C');
  eq(AccountManager.list().length, 3, '登录 C 后 3 个账号');
  const removedC = AccountManager.logout(c.id);
  eq(removedC.id, c.id, '注销 C 返回被注销账号');
  eq(AccountManager.list().length, 2, '注销 C 后 2 个账号');
  ok(ls.getItem(AccountManager._profileKey(c.id)) === null, '注销 C 删除其 profile 数据');

  // 注销当前账号（default）→ 切到剩余账号 B
  AccountManager.switchTo('acc_default');
  const removedDef = AccountManager.logout(); // 注销当前
  eq(removedDef.id, 'acc_default', '注销当前账号返回 default');
  eq(AccountManager.getCurrentId(), b.id, '注销当前后切到剩余账号 B');
  ok(ls.getItem(AccountManager._profileKey('acc_default')) === null, '注销 default 删除其 profile');

  // 注销最后一个账号 → 自动新建游客兜底
  AccountManager.switchTo(b.id);
  AccountManager.logout(); // 注销 B（最后一个）
  eq(AccountManager.list().length, 1, '注销最后一个后自动新建游客兜底');
  ok(AccountManager.getCurrent().uid, '兜底游客账号 uid 可用');
}

// ========== 2. 旧单账号数据迁移 ==========
console.log('\n=== 旧单账号数据迁移 ===');
{
  const ls = setBrowserEnv();
  // 预置旧单账号数据
  ls.setItem('territory_king_profile', JSON.stringify({ gold: 666, nickname: '老玩家甲' }));
  ls.setItem('territory_king_session', JSON.stringify({ uid: 'u_legacy_01', token: 'tk_legacy' }));

  const def = AccountManager.init();
  eq(def.id, 'acc_default', '迁移后建立默认账号');
  eq(def.uid, 'u_legacy_01', '迁移保留旧 uid');
  eq(def.nickname, '老玩家甲', '迁移保留旧昵称');

  // 旧 key 被清理
  eq(ls.getItem('territory_king_profile'), null, '旧 profile key 已清理');
  eq(ls.getItem('territory_king_session'), null, '旧 session key 已清理');

  // 旧 profile 数据迁到新命名空间 key
  const migrated = JSON.parse(ls.getItem('territory_king_profile_acc_default'));
  ok(!!migrated && migrated.gold === 666, '旧 profile 数据迁到账号命名空间 key');
}

// ========== 3. ProfileManager 多账号 key 隔离 ==========
console.log('\n=== ProfileManager 多账号隔离 ===');
{
  setBrowserEnv();
  AccountManager.init(); // default
  PM.reset();
  PM.get().gold = 111;
  PM.get().nickname = '账号一';
  PM.save();

  AccountManager.login('账号二'); // 切到账号二
  PM.reset(); // 新空档写账号二 key
  PM.get().gold = 222;
  PM.save();

  // 切回账号一 → gold 111
  AccountManager.switchTo('acc_default');
  PM.load();
  eq(PM.get().gold, 111, '切回账号一读回 gold=111');
  eq(PM.get().nickname, '账号一', '切回账号一读回昵称');

  // 切到账号二 → gold 222
  const acc2 = AccountManager.list().find(a => a.id !== 'acc_default');
  AccountManager.switchTo(acc2.id);
  PM.load();
  eq(PM.get().gold, 222, '切到账号二读回 gold=222');
}

// ========== 4. SessionManager 从 AccountManager 拿 uid ==========
console.log('\n=== SessionManager 与 AccountManager 集成 ===');
{
  setBrowserEnv();
  AccountManager.init();
  const sm = new SessionManager();
  const id = await sm.init();
  eq(id.uid, AccountManager.getUID(), 'SessionManager uid 来自 AccountManager');
  eq(sm.getUID(), AccountManager.getUID(), 'getUID() 一致');

  // 切换账号后，新 SessionManager 实例拿到新 uid
  const b = AccountManager.login('会话B');
  const sm2 = new SessionManager();
  const id2 = await sm2.init();
  eq(id2.uid, b.uid, '切换后新会话拿新账号 uid');
}

// ========== 5. 微信分支（AccountManager 存 wx storage） ==========
console.log('\n=== AccountManager 微信分支 ===');
{
  const wxStore = setWxEnv();
  const def = AccountManager.init();
  ok('territory_king_accounts' in wxStore, '微信分支写入 wx storage');
  const stored = wxStore['territory_king_accounts'];
  ok(stored && Array.isArray(stored.list), '账号列表存为对象');
  eq(stored.current, 'acc_default', '当前账号指针正确');

  const b = AccountManager.login('微信账号B');
  ok(wxStore['territory_king_accounts'].list.length === 2, '微信分支登录后 2 账号');
  AccountManager.logout(b.id);
  ok(wxStore['territory_king_accounts'].list.length === 1, '微信分支注销后 1 账号');
}

// ========== 5b. bindCloudIdentity 云端权威身份绑定 ==========
console.log('\n=== bindCloudIdentity 云端权威身份 ===');
{
  setBrowserEnv();
  AccountManager.init(); // default
  const def = AccountManager.getCurrent();

  // 绑定云端身份：accountId 作为稳定 uid，nickname 以云端为准
  const bound = AccountManager.bindCloudIdentity({
    accountId: 'acc_oZIsFxv18lE7eSCsBkzWfKVYMWOk',
    uid: 'u_stale_dirty_value',
    nickname: '领主_484d',
  });
  eq(bound.uid, 'acc_oZIsFxv18lE7eSCsBkzWfKVYMWOk', '绑定后 uid 规范化为 accountId（忽略脏 uid）');
  eq(bound.nickname, '领主_484d', '绑定后 nickname 以云端为准');
  eq(AccountManager.getUID(), 'acc_oZIsFxv18lE7eSCsBkzWfKVYMWOk', 'getUID 返回稳定 accountId');

  // 幂等：重复绑定不产生脏变化
  AccountManager.bindCloudIdentity({ accountId: 'acc_oZIsFxv18lE7eSCsBkzWfKVYMWOk', nickname: '领主_484d' });
  eq(AccountManager.getUID(), 'acc_oZIsFxv18lE7eSCsBkzWfKVYMWOk', '重复绑定 uid 不变');

  // 无 accountId 时用 identity.uid 兜底
  const b = AccountManager.login('本地B');
  AccountManager.bindCloudIdentity({ accountId: null, uid: 'u_fallback_99', nickname: '云端B' });
  eq(AccountManager.getUID(), 'u_fallback_99', '无 accountId 时回退 identity.uid');

  // 绑定持久化：重新 init 后仍保持
  AccountManager._store = null; AccountManager._current = null; // 强制重读
  AccountManager.init();
  eq(AccountManager.getUID(), 'u_fallback_99', '绑定结果持久化（重新 init 保留）');
  eq(AccountManager.getCurrent().nickname, '云端B', '绑定昵称持久化');

  // 恢复 default 账号 uid 也被持久化为 accountId
  AccountManager.switchTo('acc_default');
  eq(AccountManager.getUID(), 'acc_oZIsFxv18lE7eSCsBkzWfKVYMWOk', 'default 账号 uid 持久化为 accountId');
}

// ========== 6. Game 集成（需完整 mock） ==========
console.log('\n=== Game 集成 ===');
// 完整浏览器 mock（复用 test-account 模式）
{
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
    set: (t, p, v) => { t[p] = v; return true; },
  });
  const canvasStub = {
    width: 400, height: 700, style: {},
    getContext: () => ctxProxy,
    addEventListener: noop, removeEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }),
  };
  global.document = {
    getElementById: () => canvasStub, addEventListener: noop, removeEventListener: noop,
    createElement: () => canvasStub, body: { appendChild: noop, removeChild: noop }, hidden: false,
  };
  global.window = {
    innerWidth: 400, innerHeight: 700, devicePixelRatio: 1,
    addEventListener: noop, removeEventListener: noop,
    requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    AudioContext: class {}, location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
  };
  global.requestAnimationFrame = () => 0;
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
  global.localStorage = makeLocalStorage();

  const { readFileSync: rf, existsSync } = await import('node:fs');
  const { fileURLToPath: fURL } = await import('node:url');
  const ROOT = fURL(new URL('..', import.meta.url));
  global.fetch = async (path) => {
    const file = ROOT + path.replace('../', '');
    if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
    return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
  };

  const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
  const { syncConfigToStatics } = await import('../src/config.js');
  await ConfigLoader.init();
  syncConfigToStatics();
  try { await import('../src/data/races.js').then(m => m.syncRaces && m.syncRaces()); } catch (e) {}
  try { await import('../src/data/levels.js').then(m => m.syncLevels && m.syncLevels()); } catch (e) {}

  const { Game } = await import('../src/game/Game.js');

  const game = new Game(canvasStub, ctxProxy, 400, 700);
  await game.start();

  // start 后 uid 来自账号元数据
  eq(game.sessionManager.getUID(), AccountManager.getUID(), 'Game.sessionManager uid = AccountManager uid');

  // 登录新账号 → 新空档
  const oldUid = AccountManager.getUID();
  game._loginNewAccount();
  const newUid = AccountManager.getUID();
  ok(newUid !== oldUid, '登录新账号后 uid 变化');
  eq(game.sessionManager.uid, newUid, '登录新账号后 session uid 同步');
  eq(PM.get().gold, 500, '新账号空档初始金币 500');
  eq(AccountManager.list().length, 2, '登录后 2 账号');

  // 切回默认账号 → 独立存档
  game._applyAccountSwitch(AccountManager.list().find(a => a.id === 'acc_default'));
  eq(AccountManager.getCurrentId(), 'acc_default', '切换回 default');
  eq(game.sessionManager.uid, AccountManager.getUID(), '切换后 session uid 同步');

  // 注销当前账号（default）→ 切到剩余
  game._logoutAccount(null);
  ok(AccountManager.getCurrentId() !== 'acc_default', '注销 default 后切到剩余账号');
  eq(AccountManager.list().length, 1, '注销后剩 1 账号');
  eq(game.sessionManager.uid, AccountManager.getUID(), '注销切换后 session uid 同步');
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
