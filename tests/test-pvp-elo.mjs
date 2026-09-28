// 测试: 真人 PvP Elo 结算（LadderSystem.settlePvp / calcEloDelta + ProfileManager.grantPvpRewards）
// 覆盖: Elo 公式方向性 / 最小流动 / 保段保护 / 晋段奖励 / 连胜加成 / 真人结算接入
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

const Ladder = await import('../src/meta/LadderSystem.js');
const { PlayerProfile } = await import('../src/meta/PlayerProfile.js');

// ============ 1. Elo 公式方向性 ============
console.log('=== 测试1: calcEloDelta 方向性 ===');
{
  // 同分：胜 +16 / 负 -16（K=32, expected=0.5）
  const w = Ladder.calcEloDelta(true, 1000, 1000);
  const l = Ladder.calcEloDelta(false, 1000, 1000);
  assert(w === 16 && l === -16, `同分胜+${w} / 负${l}（预期 ±16）`);

  // 弱胜强得更多（500 打 1500）
  const upset = Ladder.calcEloDelta(true, 500, 1500);
  const expected = Ladder.calcEloDelta(true, 1500, 500);
  assert(upset > expected, `弱胜强+${upset} > 强胜弱+${expected}`);

  // 强输弱扣更多
  const strongLoss = Ladder.calcEloDelta(false, 1500, 500);
  const weakLoss = Ladder.calcEloDelta(false, 500, 1500);
  assert(strongLoss < weakLoss, `强输弱${strongLoss} < 弱输强${weakLoss}（扣更多）`);

  // 最小流动：分差极大时胜方也至少 +10
  const blowout = Ladder.calcEloDelta(true, 2000, 100);
  assert(blowout >= 10, `分差极大胜方至少+10（实际+${blowout}）`);
}

// ============ 2. settlePvp 胜利加分 + 连胜加成 ============
console.log('=== 测试2: settlePvp 胜利 / 连胜 ===');
{
  const pf = new PlayerProfile();
  pf.trophies = 1000; pf.pvpWinStreak = 0;
  const r = Ladder.settlePvp(pf, true, 1000);
  assert(r.trophies === 1016, `同分胜 +16 → 1016（实际${r.trophies}）`);
  assert(r.tierUp === false, '同段位内不晋段');

  const pf2 = new PlayerProfile();
  pf2.trophies = 1000; pf2.pvpWinStreak = 5;
  const r2 = Ladder.settlePvp(pf2, true, 1000);
  // 16 + 连胜15 = +31
  assert(r2.trophies === 1031 && r2.streakBonus === 15, `5连胜 +16+15=+31（实际${r2.trophies}，连胜${r2.streakBonus}）`);
}

// ============ 3. settlePvp 失败扣分 + 保段保护 ============
console.log('=== 测试3: settlePvp 失败 / 保段 ===');
{
  const pf = new PlayerProfile();
  pf.trophies = 1500; pf.claimedTierRewards = [];
  const r = Ladder.settlePvp(pf, false, 1500); // 大师段内（min=1300），同分负不触发保段
  assert(r.trophies === 1484, `同分负 -16 → 1484（实际${r.trophies}）`);

  // 保段：段底失败不跌破下限
  const pf2 = new PlayerProfile();
  pf2.trophies = 200; pf2.claimedTierRewards = [];
  Ladder.settlePvp(pf2, false, 100);
  assert(pf2.trophies === 200, `白银段底(200)失败 → 保段停在200（实际${pf2.trophies}）`);
}

// ============ 4. settlePvp 晋段奖励 ============
console.log('=== 测试4: settlePvp 晋段奖励 ===');
{
  const pf = new PlayerProfile();
  pf.gold = 0; pf.stardust = 0; pf.diamond = 0;
  pf.trophies = 199; pf.pvpWinStreak = 0;
  const r = Ladder.settlePvp(pf, true, 500); // 199 胜 500（弱胜强，Elo 得更多）
  assert(r.tierUp === true, `199杯胜500 → 跨白银（tierUp=${r.tierUp}）`);
  assert(pf.trophies >= 200, `新杯数${pf.trophies} ≥ 200`);
  assert(pf.gold === 300, `白银晋段奖励金币300（实际${pf.gold}）`);
  assert(pf.claimedTierRewards.includes('silver'), '白银奖励已记录');
}

// ============ 5. grantPvpRewards 真人结算接入 ============
console.log('=== 测试5: grantPvpRewards 接入 ===');
{
  const noop = () => {};
  const ctxProxy = new Proxy({}, {
    get: (t, p) => {
      if (p === 'canvas') return canvasStub;
      return (...args) => (p === 'measureText' ? { width: 50 } : undefined);
    },
    set: () => true,
  });
  const canvasStub = {
    width: 400, height: 700, style: {},
    getContext: () => ctxProxy,
    addEventListener: noop, removeEventListener: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }),
  };
  global.document = { getElementById: () => canvasStub, addEventListener: noop, removeEventListener: noop, createElement: () => canvasStub, body: { appendChild: noop, removeChild: noop }, hidden: false };
  global.window = { innerWidth: 400, innerHeight: 700, devicePixelRatio: 1, addEventListener: noop, removeEventListener: noop, requestAnimationFrame: () => 0, cancelAnimationFrame: noop, AudioContext: class {}, location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop } };
  global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  global.wx = { createInnerAudioContext: () => ({ src: '', loop: false, volume: 1, play: noop, pause: noop, stop: noop, seek: noop, destroy: noop, onEnded: noop, onError: noop, onCanplay: noop }), vibrateShort: noop, vibrateLong: noop, showToast: noop, shareAppMessage: noop, onShareAppMessage: noop, showShareMenu: noop, setStorageSync: (k, v) => global.localStorage.setItem(k, JSON.stringify(v)), getStorageSync: (k) => { const s = global.localStorage.getItem(k); return s ? JSON.parse(s) : null; } };
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

  const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
  ProfileManager.reset();
  const pf = ProfileManager.get();
  const before = pf.trophies;
  const r = ProfileManager.grantPvpRewards(true, 1000);
  assert(r.isWin === true, 'grantPvpRewards 胜利返回 isWin');
  assert(r.gold >= 80 && r.gold <= 120, `胜利金币 80-120（实际${r.gold}）`);
  assert(typeof r.trophyDelta === 'number' && r.trophies > before, `胜利奖杯增加（${before} → ${r.trophies}）`);
  assert(typeof r.tierUpRewardText === 'string', '返回 tierUpRewardText 字段');

  // 对手奖杯未知 → 按同段位（expected=0.5）结算，等价于同分
  ProfileManager.reset();
  const pf2 = ProfileManager.get();
  pf2.trophies = 1500;
  const r2 = ProfileManager.grantPvpRewards(false, null);
  assert(r2.trophies === 1484, `对手奖杯未知时负 -16 → 1484（实际${r2.trophies}）`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
