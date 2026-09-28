// 测试: 每周/赛季任务刷新与领取 / 一键领取 / 可领取置顶排序 / 成就独立界面
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
const { RenderSystem } = await import('../src/system/RenderSystem.js');
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
const QuestSystem = (await import('../src/meta/QuestSystem.js')).default;

console.log('=== 测试1: 每周任务首次刷新（周一键 + 数量） ===');
const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();
{
  const weekly = QuestSystem.getWeeklyQuests();
  const cfg = ConfigLoader.get('quests');
  assert(weekly.length === cfg.weeklyQuestCount, `每周任务数量=${weekly.length} (配置 ${cfg.weeklyQuestCount})`);
  assert(weekly.every(q => q.progress === 0 && !q.claimed), '每周任务初始未完成未领取');
  assert(ProfileManager.get().weeklyTasks && ProfileManager.get().weeklyTasks._lastRefresh, 'weeklyTasks._lastRefresh 已写入');
  // 二次调用不重复刷新
  const first = ProfileManager.get().weeklyTasks._lastRefresh;
  QuestSystem.getWeeklyQuests();
  assert(ProfileManager.get().weeklyTasks._lastRefresh === first, '同周内不重复刷新');
}

console.log('=== 测试2: 赛季任务首次刷新（跟随 seasonNumber） ===');
{
  const profile = ProfileManager.get();
  profile.seasonNumber = 5; // 模拟第5赛季
  ProfileManager.save();
  const season = QuestSystem.getSeasonQuests();
  const cfg = ConfigLoader.get('quests');
  assert(season.length === cfg.seasonQuestCount, `赛季任务数量=${season.length} (配置 ${cfg.seasonQuestCount})`);
  assert(ProfileManager.get().seasonTasks && ProfileManager.get().seasonTasks._season === 5, `seasonTasks._season=5 (实际 ${ProfileManager.get().seasonTasks?._season})`);
  // 赛季号变化 → 重置
  profile.seasonNumber = 6;
  ProfileManager.save();
  const s2 = QuestSystem.getSeasonQuests();
  assert(ProfileManager.get().seasonTasks._season === 6, '赛季号+1 后任务重置到新赛季');
  assert(s2.every(q => q.progress === 0 && !q.claimed), '新赛季任务初始未完成');
}

console.log('=== 测试3: trackEvent 同时推进每日/每周/赛季 ===');
{
  const profile = ProfileManager.get();
  // 每周/赛季任务是随机抽取的，直接用实际存在的任务（不假设特定类型）
  const weekly = QuestSystem.getWeeklyQuests();
  const wTarget = weekly.find(q => q.type === 'games_played') || weekly[0];
  const season = QuestSystem.getSeasonQuests();
  const sTarget = season.find(q => q.type === 'games_played') || season[0];

  // 把每周/赛季目标任务进度推到 target-1
  const wStore = (profile.weeklyTasks.quests || []).find(q => q.id === wTarget.id);
  const sStore = (profile.seasonTasks.quests || []).find(q => q.id === sTarget.id);
  wStore.progress = wTarget.target - 1;
  sStore.progress = sTarget.target - 1;
  ProfileManager.save();

  // 触发目标类型（类型相同则一次触发两者，不同则分别触发）
  const types = new Set([wTarget.type, sTarget.type]);
  for (const t of types) QuestSystem.trackEvent(t);

  const wAfter = QuestSystem.getWeeklyQuests().find(q => q.id === wTarget.id);
  const sAfter = QuestSystem.getSeasonQuests().find(q => q.id === sTarget.id);
  assert(wAfter.complete, `每周任务完成 (进度 ${wAfter.progress}/${wTarget.target})`);
  assert(sAfter.complete, `赛季任务完成 (进度 ${sAfter.progress}/${sTarget.target})`);
}

console.log('=== 测试4: 可领取置顶排序 ===');
{
  const profile = ProfileManager.get();
  // 先领掉每周的完成项，避免干扰
  const weeklyAll = QuestSystem.getWeeklyQuests();
  for (const q of weeklyAll) {
    if (q.complete && !q.claimed) QuestSystem.claimWeeklyReward(q.id);
  }
  const seasonAll = QuestSystem.getSeasonQuests();
  for (const q of seasonAll) {
    if (q.complete && !q.claimed) QuestSystem.claimSeasonReward(q.id);
  }
  const dailies = QuestSystem.getDailyQuests();
  // 模拟: 第一个每日任务已领、第二个未完成、第三个完成未领取
  const sqList = profile.dailyTasks.quests || [];
  const d1 = dailies.find(q => !q.complete && !q.claimed);
  const d2 = dailies.find(q => q.complete && !q.claimed) || d1;
  // 构造：把所有任务置为未完成，再把一个标记为完成未领取
  for (const sq of sqList) sq.progress = 0;
  const targetSq = sqList[0];
  const targetCfg = ConfigLoader.get('quests').dailyQuests.find(q => q.id === targetSq.id);
  targetSq.progress = targetCfg.target;
  ProfileManager.save();

  const sorted = QuestSystem.getDailyQuests();
  assert(sorted.length > 1, '每日任务多于1个');
  assert(sorted[0].id === targetSq.id && sorted[0].complete && !sorted[0].claimed, `可领取项置顶 (首位 ${sorted[0].id})`);
  // 领取后该任务应从顶部消失
  QuestSystem.claimDailyReward(targetSq.id);
  const sorted2 = QuestSystem.getDailyQuests();
  assert(!sorted2.some(q => q.id === targetSq.id && q.claimed === false), '领取后不再占据首位（已领）');
}

console.log('=== 测试5: 任务界面一键领取 ===');
{
  const profile = ProfileManager.get();
  // 让一个每日 + 一个每周完成未领取
  const dList = QuestSystem.getDailyQuests();
  const dUnclaimed = dList.find(q => !q.claimed);
  if (dUnclaimed) {
    const sq = (profile.dailyTasks.quests || []).find(q => q.id === dUnclaimed.id);
    const cfg = ConfigLoader.get('quests').dailyQuests.find(q => q.id === dUnclaimed.id);
    sq.progress = cfg.target;
    ProfileManager.save();
  }
  const wList = QuestSystem.getWeeklyQuests();
  const wUnclaimed = wList.find(q => !q.claimed);
  if (wUnclaimed) {
    const sq = (profile.weeklyTasks.quests || []).find(q => q.id === wUnclaimed.id);
    const cfg = ConfigLoader.get('quests').weeklyQuests.find(q => q.id === wUnclaimed.id);
    sq.progress = cfg.target;
    ProfileManager.save();
  }
  const goldBefore = profile.gold;
  const layout = RenderSystem.questLayout(
    QuestSystem.getDailyQuests(), QuestSystem.getWeeklyQuests(), QuestSystem.getSeasonQuests(),
    game.metaScrollY || 0, game.screenWidth
  );
  const ca = layout.claimAllRect;
  game.screenState = 'quest';
  game.handleQuestClick(ca.x + ca.w / 2, ca.y + ca.h / 2);
  const remaining = QuestSystem.getDailyQuests().concat(QuestSystem.getWeeklyQuests()).filter(q => q.complete && !q.claimed);
  assert(remaining.length === 0, `一键领取后无可领取任务 (剩 ${remaining.length})`);
  assert(ProfileManager.get().gold >= goldBefore, '一键领取后金币入账');
}

console.log('=== 测试6: 成就界面一键领取 ===');
{
  const profile = ProfileManager.get();
  const achs = QuestSystem.getAchievements();
  const target = achs.find(a => a.type === 'games_won' && !a.claimed);
  if (target) {
    profile.totalWins = Math.max(profile.totalWins || 0, target.target);
    ProfileManager.save();
  }
  const stardustBefore = profile.stardust;
  const layout = RenderSystem.achievementLayout(QuestSystem.getAchievements(), game.metaScrollY || 0, game.screenWidth);
  const ca = layout.claimAllRect;
  game.screenState = 'achievement';
  game.handleAchievementClick(ca.x + ca.w / 2, ca.y + ca.h / 2);
  const remaining = QuestSystem.getAchievements().filter(a => a.complete && !a.claimed);
  assert(remaining.length === 0, `成就一键领取后无可领取 (剩 ${remaining.length})`);
  assert(ProfileManager.get().stardust >= stardustBefore, '成就一键领取后星尘入账');
}

console.log('=== 测试7: 大厅成就入口 → 成就界面 → 返回 ===');
{
  // 完成新手引导（否则大厅点击被引导分支拦截）
  const profile = ProfileManager.get();
  profile.tutorialStep = 4;
  ProfileManager.save();
  // 功能行第3个按钮(i=2)=成就
  const row = Game.LOBBY_LAYOUT.row;
  const x = Game.lobbyRowX(2, 400);
  game.screenState = 'lobby';
  game.handleLobbyClick(x + row.w / 2, row.y + row.h / 2);
  assert(game.screenState === 'achievement', `点击成就入口进入成就界面 (实际 ${game.screenState})`);
  // 返回大厅
  game.handleAchievementClick(56, game.screenHeight - 33);
  assert(game.screenState === 'lobby', '成就界面返回按钮回大厅');
  // 任务入口仍正常
  const x1 = Game.lobbyRowX(1, 400);
  game.handleLobbyClick(x1 + row.w / 2, row.y + row.h / 2);
  assert(game.screenState === 'quest', `点击任务入口进入任务界面 (实际 ${game.screenState})`);
  game.handleQuestClick(56, game.screenHeight - 33);
  assert(game.screenState === 'lobby', '任务界面返回按钮回大厅');
}

console.log('=== 测试8: 成就界面单个领取（渲染布局命中一致） ===');
{
  const profile = ProfileManager.get();
  const achs = QuestSystem.getAchievements();
  const target = achs.find(a => a.type === 'total_pulls' && !a.claimed);
  if (target) {
    profile.totalPulls = target.target;
    ProfileManager.save();
    const refreshed = QuestSystem.getAchievements();
    const idx = refreshed.findIndex(a => a.id === target.id);
    const layout = RenderSystem.achievementLayout(refreshed, game.metaScrollY || 0, game.screenWidth);
    const r = layout.rects[idx];
    const btnX = r.x + r.w - 70, btnY = r.y + 10;
    game.screenState = 'achievement';
    game.handleAchievementClick(btnX + 30, btnY + 15);
    const after = QuestSystem.getAchievements().find(a => a.id === target.id);
    assert(after && after.claimed === true, `成就 ${target.id} 单个领取成功`);
  } else {
    console.log('  ⚠️ 无 total_pulls 未领取成就可测，跳过');
  }
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
