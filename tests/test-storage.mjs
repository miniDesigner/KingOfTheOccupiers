// 存储层双环境适配测试（Phase 7 P0.2）
//
// 验证 ProfileManager / SessionManager 的存储读写：
//   - 微信分支：wx.setStorageSync / wx.getStorageSync（存对象，内部 JSON 序列化）
//   - 浏览器分支：localStorage（存 JSON 字符串）
//   - 数据往返一致性：serialize → 存储 → fromJSON 字段不丢失
//   - SessionManager uid 跨实例稳定（双环境）
//
// 关键：isWxEnv() 是运行时检测（typeof wx.setStorageSync === 'function'），
// 因此可在同一进程内动态切换 global.wx / global.localStorage 验证两分支。
//
// 用法: node tests/test-storage.mjs

// ========== 全局 mock 骨架（供各 section 复用） ==========
const noop = () => {};

// 微信存储 mock：模拟真实 wx 的「对象存 / 对象取 + 深拷贝」语义
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

// 浏览器 localStorage mock
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

// ========== 1. ProfileManager 微信分支 ==========
console.log('\n=== ProfileManager 微信分支 ===');
setWxEnv();
const PM = await import('../src/meta/ProfileManager.js');

{
  const wxStore = setWxEnv();
  PM.reset(); // 新 profile 并触发 save() → 写入 wx storage

  ok('territory_king_profile' in wxStore, 'reset() 后写入 wx.setStorageSync');
  ok(!(typeof localStorage !== 'undefined' && localStorage.getItem), '微信分支不依赖 localStorage');

  // 修改数据 → save → 重新 load 验证往返一致
  PM.get().gold = 45678;
  PM.get().stardust = 321;
  PM.get().nickname = '存储测试领主';
  PM.save();

  const saved = wxStore['territory_king_profile'];
  ok(saved && typeof saved === 'object', 'wx storage 存的是对象（非 JSON 字符串）');
  eq(saved.gold, 45678, 'wx storage 中 gold 正确');

  // 清空单例并重新 load，验证从 wx storage 读回
  PM.get().gold = -1; // 脏改内存，随后 load 应被 storage 覆盖
  const loaded = PM.load();
  eq(loaded.gold, 45678, 'load() 从 wx storage 读回 gold');
  eq(loaded.stardust, 321, 'load() 读回 stardust');
  eq(loaded.nickname, '存储测试领主', 'load() 读回 nickname');
}

// ========== 2. ProfileManager 浏览器分支 ==========
console.log('\n=== ProfileManager 浏览器分支 ===');
{
  const ls = setBrowserEnv();
  PM.reset();
  PM.get().gold = 777;
  PM.get().nickname = '浏览器领主';
  PM.save();

  const raw = ls.getItem('territory_king_profile');
  ok(typeof raw === 'string', '浏览器分支存 JSON 字符串');
  const parsed = JSON.parse(raw);
  eq(parsed.gold, 777, 'localStorage 中 gold 正确');

  PM.get().gold = -2;
  const loaded = PM.load();
  eq(loaded.gold, 777, '浏览器 load() 读回 gold');
  eq(loaded.nickname, '浏览器领主', '浏览器 load() 读回 nickname');
}

// ========== 3. ProfileManager 序列化往返完整性 ==========
console.log('\n=== ProfileManager 序列化往返 ===');
{
  setBrowserEnv();
  PM.reset();
  const p = PM.get();
  p.gold = 100;
  p.diamond = 200;
  p.stardust = 300;
  p.trophies = 1500;
  p.pvpWins = 12;
  p.unlockedRaces = ['human', 'beast', 'undead'];
  p.collectedUnits = { swordsman: { level: 3, recruitCount: 5 }, archer: { level: 1, recruitCount: 0 } };
  PM.save();

  // 重新 load 后关键字段应完整保留
  PM.get().gold = -999;
  const loaded = PM.load();
  eq(loaded.gold, 100, 'gold 往返');
  eq(loaded.diamond, 200, 'diamond 往返');
  eq(loaded.stardust, 300, 'stardust 往返');
  eq(loaded.trophies, 1500, 'trophies 往返');
  eq(loaded.pvpWins, 12, 'pvpWins 往返');
  ok(loaded.unlockedRaces.includes('undead'), 'unlockedRaces 往返');
  eq(loaded.collectedUnits.swordsman.level, 3, 'collectedUnits 往返（level）');
  eq(loaded.collectedUnits.swordsman.recruitCount, 5, 'collectedUnits 往返（recruitCount）');
}

// ========== 4. SessionManager 微信分支 ==========
console.log('\n=== SessionManager 微信分支 ===');
{
  const wxStore = setWxEnv();
  const { SessionManager } = await import('../src/net/SessionManager.js');
  const sm1 = new SessionManager();
  const id1 = await sm1.init();
  ok(!!id1.uid && id1.uid.startsWith('u_'), `微信分支首次 init 生成 uid（${id1.uid}）`);
  ok('territory_king_session' in wxStore, '微信分支写入 wx storage');

  const saved = wxStore['territory_king_session'];
  ok(saved && typeof saved === 'object', 'session 存对象');
  eq(saved.uid, id1.uid, 'session 存储 uid 正确');

  const sm2 = new SessionManager();
  const id2 = await sm2.init();
  eq(id2.uid, id1.uid, '微信分支再次进入恢复同一 uid');
}

// ========== 5. SessionManager 浏览器分支 ==========
console.log('\n=== SessionManager 浏览器分支 ===');
{
  const ls = setBrowserEnv();
  const { SessionManager } = await import('../src/net/SessionManager.js');
  const sm1 = new SessionManager();
  const id1 = await sm1.init();
  ok(!!id1.uid, `浏览器分支首次 init 生成 uid（${id1.uid}）`);

  const raw = ls.getItem('territory_king_session');
  ok(typeof raw === 'string', '浏览器 session 存 JSON 字符串');
  eq(JSON.parse(raw).uid, id1.uid, '浏览器 session uid 正确');

  const sm2 = new SessionManager();
  const id2 = await sm2.init();
  eq(id2.uid, id1.uid, '浏览器分支再次进入恢复同一 uid');
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
