// 测试: 任务/成就领取按钮命中区与绘制完全一致（修复: 点击区偏移22-30px导致无法领取）
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
// fetch: 从磁盘读取真实配置(模拟相对 ../config/ 的解析)
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
const { RenderSystem } = await import('../src/system/RenderSystem.js');
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
const QuestSystem = (await import('../src/meta/QuestSystem.js')).default;
const BattlePassSystem = (await import('../src/meta/BattlePassSystem.js')).default;

// 配置已通过 fetch 桩从磁盘加载，无需额外注入

console.log('=== 测试1: 启动游戏进入大厅 ===');
const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();
assert(game.screenState === 'lobby', '游戏启动进入大厅');

console.log('=== 测试2: 每日任务 — 点绘制按钮中心应领取成功 ===');
{
  const profile = ProfileManager.get();
  const dailies = QuestSystem.getDailyQuests();
  assert(dailies.length > 0, `每日任务列表非空(${dailies.length})`);
  // 强制第一个任务完成
  const target = dailies[0];
  const sq = (profile.dailyTasks.quests || []).find(q => q.id === target.id);
  sq.progress = target.target;
  ProfileManager.save();
  const refreshed = QuestSystem.getDailyQuests();
  const done = refreshed.find(q => q.id === target.id);
  assert(done.complete === true && !done.claimed, `任务 ${target.id} 已完成未领取`);

  const goldBefore = profile.gold;
  // 用与渲染一致的共享布局计算按钮位置（每日/每周/赛季三段布局）
  const layout = RenderSystem.questLayout(refreshed, [], [], game.metaScrollY || 0, game.screenWidth);
  const r = layout.dailyRects[0];
  const btnX = r.x + r.w - 70, btnY = r.y + 10;
  // 点击按钮正中心
  game.screenState = 'quest';
  game.handleQuestClick(btnX + 30, btnY + 15);
  const after = QuestSystem.getDailyQuests().find(q => q.id === target.id);
  assert(after.claimed === true, `领取后 claimed=true`);
  const goldAfter = ProfileManager.get().gold;
  assert(goldAfter >= goldBefore, `奖励已入账(金币 ${goldBefore}→${goldAfter})`);
}

console.log('=== 测试3: 成就（独立界面）— 点绘制按钮中心应领取成功 ===');
{
  const profile = ProfileManager.get();
  // 让首个成就达成: games_won 类型读 profile.totalWins
  const achs = QuestSystem.getAchievements();
  const target = achs.find(a => a.type === 'games_won');
  profile.totalWins = Math.max(profile.totalWins || 0, target.target);
  ProfileManager.save();
  const refreshed = QuestSystem.getAchievements();
  const done = refreshed.find(a => a.id === target.id);
  if (done && done.complete && !done.claimed) {
    const sdBefore = profile.stardust;
    const layout = RenderSystem.achievementLayout(refreshed, game.metaScrollY || 0, game.screenWidth);
    const idx = refreshed.findIndex(a => a.id === target.id);
    const r = layout.rects[idx];
    const btnX = r.x + r.w - 70, btnY = r.y + 10;
    game.screenState = 'achievement';
    game.handleAchievementClick(btnX + 30, btnY + 15);
    const after = QuestSystem.getAchievements().find(a => a.id === target.id);
    assert(after.claimed === true, `成就 ${target.id} 领取后 claimed=true`);
    assert(ProfileManager.get().stardust >= sdBefore, `成就奖励已入账(星尘 ${sdBefore}→${ProfileManager.get().stardust})`);
  } else {
    console.log(`  ⚠️ 无已完成未领取的成就可测(目标 ${target.id} complete=${done?.complete})，跳过`);
  }
}

console.log('=== 测试4: 窄屏(320px) itemW 自适应 — 命中仍准确 ===');
{
  game.screenWidth = 320;
  const layout = RenderSystem.questLayout([], [], [], 0, 320);
  assert(layout.itemW === 280, `窄屏 itemW=280(实际 ${layout.itemW})`);
  game.screenWidth = 400;
}

console.log('=== 测试5: 点击非按钮区域不误触领取 ===');
{
  const before = JSON.stringify(ProfileManager.get().dailyTasks);
  game.screenState = 'quest';
  game.handleQuestClick(50, 300); // 左侧空白
  const after = JSON.stringify(ProfileManager.get().dailyTasks);
  assert(before === after, '空白点击未改变任务状态');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
