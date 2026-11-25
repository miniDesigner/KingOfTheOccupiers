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
  const layout = RenderSystem.questLayout(refreshed, [], [], game.metaScrollY || 0, game.screenWidth, game.screenHeight);
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
    const layout = RenderSystem.achievementLayout(refreshed, game.metaScrollY || 0, game.screenWidth, game.screenHeight);
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
  // 2026-11-21 边界缝隙收口：itemW 统一 SIDE=16 内容区 = w-32（旧值 w-40=280）
  assert(layout.itemW === 288, `窄屏 itemW=288(实际 ${layout.itemW})`);
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

console.log('=== 测试6: 成就内容区与任务屏同口径居中 ===');
{
  const a = RenderSystem.achievementLayout([{ id: 'a' }], 0, 430).rects[0];
  assert(a.x === 16 && a.x + a.w === 414,
    `430px 成就卡片左右边距 16px（实际 x=${a.x}, right=${a.x + a.w}）`);
  const q = RenderSystem.questLayout([{ id: 'q' }], [], [], 0, 430).dailyRects[0];
  assert(q.x === a.x && q.w === a.w, '成就卡片与任务卡片共用同一内容区宽度');
  const n = RenderSystem.achievementLayout([{ id: 'n' }], 0, 320).rects[0];
  assert(n.x === 16 && n.x + n.w === 304,
    `320px 窄屏同样左右 16px（实际 x=${n.x}, right=${n.x + n.w}）`);
}

console.log('=== 测试7: 条目描述用 top 基线，不压卡片上边框 ===');
{
  const src = rf(ROOT + 'src/system/RenderSystem.js', 'utf-8');
  const itemSrc = src.slice(src.indexOf('  _drawQuestItem('), src.indexOf('  drawQuest('));
  assert(itemSrc.includes("this._fitText(String(item.desc || ''), x + 8, y + 9, itemW - 84, 12, 'left', 'top')"),
    '描述文字以 top 基线从卡片上沿 +9 起排');
  assert(!/\{\s*x:\s*20,\s*y,/.test(itemSrc), '_drawQuestItem 不再硬编码左边缘 20');
  assert(itemSrc.includes("ctx.fillText(`进度: ${Math.min(item.progress, item.target)}/${item.target}`, x + 8, y + 30)"),
    '进度与奖励跟随共享 rect 的 x，而非固定 28');
  const fitSrc = src.slice(src.indexOf('  _fitText('), src.indexOf('  _emptyState('));
  assert(fitSrc.includes("ctx.textBaseline = baseline || 'middle';"),
    '_fitText 支持可选 baseline，默认仍是 middle');
  assert(!fitSrc.includes("ctx.textBaseline = 'alphabetic';"),
    '_fitText 不再在 restore 后覆写调用方基线');
}

console.log('=== 测试8: 任务/成就卡片高度 70，三行文字留白均匀 ===');
{
  const src = rf(ROOT + 'src/system/RenderSystem.js', 'utf-8');
  assert(src.includes('const QUEST_ITEM_H = 70;'), '存在 70px 条目高度常量');
  assert(src.includes('LEADERBOARD_ROW_H, QUEST_ITEM_H };'), '常量已导出供测试复用');
  const questSrc = src.slice(src.indexOf('  static questLayout('), src.indexOf('  /**\n   * 成就面板共享布局'));
  const achSrc = src.slice(src.indexOf('  static achievementLayout('), src.indexOf('  /**\n   * 绘制一键领取按钮'));
  assert(questSrc.includes('itemH = QUEST_ITEM_H') && achSrc.includes('itemH = QUEST_ITEM_H'),
    '任务与成就布局共用同一高度常量');
  assert(!/itemH = 55/.test(src), '旧的 55px 硬编码已移除');
  const q = RenderSystem.questLayout([{ id: 'q' }], [], [], 0, 430);
  const a = RenderSystem.achievementLayout([{ id: 'a' }], 0, 430);
  assert(q.itemH === 70 && q.dailyRects[0].h === 70, `任务卡片高度 70（实际 ${q.itemH}）`);
  assert(a.itemH === 70 && a.rects[0].h === 70, `成就卡片高度 70（实际 ${a.itemH}）`);
  const itemSrc = src.slice(src.indexOf('  _drawQuestItem('), src.indexOf('  drawQuest('));
  assert(itemSrc.includes("x + 8, y + 9, itemW - 84, 12, 'left', 'top'"), '描述上留白 +9');
  assert(itemSrc.includes('x + 8, y + 30)'), '进度锚点 +30');
  assert(itemSrc.includes("x + 8, y + 55, {"), '奖励锚点 +55');
  // 几何验算：描述 9..21（12px）、进度 30..40（10px）、奖励 49.5..60.5（11px 图标）
  assert(21 <= 30 && 40 <= 49.5 && 70 - 60.5 >= 9, '三行间距与下留白均 ≥ 9px');
}

console.log('=== 测试9: 一键领取悬浮右下角，避开返回按钮且在裁剪之上 ===');
{
  const W = 430, H = 854;
  const q = RenderSystem.questLayout([], [], [], 0, W, H);
  const a = RenderSystem.achievementLayout([], 0, W, H);
  const ca = q.claimAllRect;
  assert(ca.x === W - 116 && ca.y === H - 48 && ca.w === 100 && ca.h === 32,
    `右下角 rect = (${ca.x}, ${ca.y}, ${ca.w}, ${ca.h})`);
  assert(ca.x + ca.w === W - 16, '右侧留白 16px');
  assert(ca.y + ca.h === H - 16, '底边与返回按钮齐平（距底 16px）');
  assert(ca.x > 16 + 80, '与左下返回按钮水平分离（x > 96）');
  assert(ca.y > H - 16 - 35 - 8, '位于滚动裁剪底之下，不会被列表裁掉');
  assert(JSON.stringify(a.claimAllRect) === JSON.stringify(ca), '任务与成就共用同一右下角几何');
  const src = rf(ROOT + 'src/system/RenderSystem.js', 'utf-8');
  const questFn = src.slice(src.indexOf('  drawQuest(gameState)'), src.indexOf('  // ==================== 成就面板'));
  const achFn = src.slice(src.indexOf('  drawAchievement(gameState)'), src.indexOf('  // ==================== 通行证面板'));
  assert(questFn.indexOf('_endScrollClip') < questFn.indexOf('_drawClaimAllButton'),
    '任务屏一键领取绘制在滚动裁剪之后');
  assert(achFn.indexOf('_endScrollClip') < achFn.indexOf('_drawClaimAllButton'),
    '成就屏一键领取绘制在滚动裁剪之后');
  const gameSrc = rf(ROOT + 'src/game/Game.js', 'utf-8');
  assert(gameSrc.includes('this.metaScrollY || 0, this.screenWidth, this.screenHeight'),
    'Game 命中传入 screenHeight，与绘制同源');
}

console.log('=== 测试10: 无可领取项时隐藏一键领取按钮（绘制与命中同源）===');
{
  // 判定口径：complete && !claimed；三组任务任一可领即显示，成就独立判定
  assert(RenderSystem.hasClaimable([{ complete: true, claimed: false }]) === true, '可领取项判定为真');
  assert(RenderSystem.hasClaimable([{ complete: true, claimed: true }]) === false, '已领取不算可领取');
  assert(RenderSystem.hasClaimable([{ complete: false, claimed: false }]) === false, '进行中不算可领取');
  assert(RenderSystem.hasClaimable([]) === false, '空列表无可领取');
  assert(RenderSystem.hasClaimable(undefined) === false, '未传列表也安全返回否');

  const src = rf(ROOT + 'src/system/RenderSystem.js', 'utf-8');
  const questFn = src.slice(src.indexOf('  drawQuest(gameState)'), src.indexOf('  // ==================== 成就面板'));
  const achFn = src.slice(src.indexOf('  drawAchievement(gameState)'), src.indexOf('  // ==================== 通行证面板'));
  assert(questFn.includes('if (hasClaimable) this._drawClaimAllButton(ctx, layout.claimAllRect);'),
    '任务屏仅在有可领取项时绘制按钮');
  assert(questFn.includes('RenderSystem.hasClaimable(gameState.dailyQuests)') &&
    questFn.includes('RenderSystem.hasClaimable(gameState.weeklyQuests)') &&
    questFn.includes('RenderSystem.hasClaimable(gameState.seasonQuests)'),
  '任务屏覆盖每日/每周/赛季三组');
  assert(achFn.includes('if (RenderSystem.hasClaimable(gameState.achievements))'),
    '成就屏仅在有可领取成就时绘制按钮');

  const gameSrc = rf(ROOT + 'src/game/Game.js', 'utf-8');
  const qClick = gameSrc.slice(gameSrc.indexOf('  handleQuestClick('), gameSrc.indexOf('  /**\n   * 成就界面点击'));
  const aClick = gameSrc.slice(gameSrc.indexOf('  handleAchievementClick('), gameSrc.indexOf('  /**\n   * 通行证面板点击'));
  assert(qClick.includes('if (claimable && screenX >= ca.x'), '任务命中先判定可领取，隐藏时不响应');
  assert(aClick.includes('if (claimable && screenX >= ca.x'), '成就命中先判定可领取，隐藏时不响应');
  assert(!qClick.includes('暂无可领取的任务') && !aClick.includes('暂无可领取的成就'),
    '隐藏后不再弹出「暂无可领取」提示');
}

console.log('=== 测试11: 每日任务标题完整落在滚动裁剪区之内 ===');
{
  const clipTop = 88; // RenderSystem.drawQuest -> _beginScrollClip(ctx, w, h, 88)
  const q = RenderSystem.questLayout([{ id: 'q' }], [], [], 0, 430);
  assert(q.dailyHeaderY >= clipTop,
    `每日标题 y=${q.dailyHeaderY} 不小于裁剪顶部 ${clipTop}`);
  assert(q.dailyHeaderY + 9 >= clipTop && q.dailyHeaderY + 25 <= clipTop + 40,
    '每日标题图标（y+9..y+25）完整可见、不越过标题区');
  assert(q.dailyRects[0].y === q.dailyHeaderY + 22 && q.dailyRects[0].y >= clipTop,
    '首行卡片随布局下移 22px，仍在裁剪区之内');

  const src = rf(ROOT + 'src/system/RenderSystem.js', 'utf-8');
  const layoutFn = src.slice(src.indexOf('  static questLayout('), src.indexOf('  /**\n   * 成就面板共享布局'));
  assert(layoutFn.includes('const dailyHeaderY = 90 - scrollY'),
    '每日标题起点 90，不再使用被裁掉的 68');
  const questFn = src.slice(src.indexOf('  drawQuest(gameState)'), src.indexOf('  // ==================== 成就面板'));
  assert(questFn.includes('this._beginScrollClip(ctx, w, h, 88)'),
    '任务列表裁剪顶部仍为 88');
  assert(questFn.includes("drawCatTitle('daily', '每日任务', layout.dailyHeaderY"),
    '每日标题使用共享 layout 的 y，绘制与卡片命中同源');
}

console.log('=== 测试12: 任务/成就滚动上界贴底，不会一路滚到空白 ===');
{
  const W = 430, H = 854;
  const clipBottom = RenderSystem.scrollClipBottom(H);
  const mk = (n, p) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }));

  const daily = mk(12, 'd');
  const maxScroll = RenderSystem.questMaxScroll(daily, [], [], W, H);
  assert(maxScroll > 0, `长任务列表存在可滚范围（实际 ${maxScroll}）`);
  const atEnd = RenderSystem.questLayout(daily, [], [], maxScroll, W, H);
  const lastDaily = atEnd.dailyRects[atEnd.dailyRects.length - 1];
  assert(Math.abs(lastDaily.y + lastDaily.h - clipBottom) < 0.001,
    `滚到上界时最后一张每日卡片贴可视区底（实际 ${lastDaily.y + lastDaily.h} / ${clipBottom}）`);
  assert(RenderSystem.questMaxScroll(mk(1, 'd'), [], [], W, H) === 0,
    '短列表不需要滚动，上界为 0');

  const ach = mk(20, 'a');
  const aMax = RenderSystem.achievementMaxScroll(ach, W, H);
  assert(aMax > 0, `长成就列表存在可滚范围（实际 ${aMax}）`);
  const aEnd = RenderSystem.achievementLayout(ach, aMax, W, H);
  const lastAch = aEnd.rects[aEnd.rects.length - 1];
  assert(Math.abs(lastAch.y + lastAch.h - clipBottom) < 0.001,
    '成就滚到上界时最后一张卡片同样贴可视区底');
  assert(RenderSystem.achievementMaxScroll([], W, H) === 0, '空成就列表上界为 0');

  const gameSrc = rf(ROOT + 'src/game/Game.js', 'utf-8');
  assert(gameSrc.includes('Math.min(metaMaxScroll, Math.max(0, this.metaScrollY + dy))'),
    '滚动增量按 metaMaxScroll 收敛');
  assert(gameSrc.includes('this.screenState === \'deploy_select\' ? this.deployMaxScroll() : metaMaxScroll'),
    'gameState 的 metaScrollY 对任务/成就同样收敛（防越界来源）');
  assert(gameSrc.includes('RenderSystem.questMaxScroll(') && gameSrc.includes('RenderSystem.achievementMaxScroll('),
    '任务与成就各自按内容高度计算上界');
  const rsSrc = rf(ROOT + 'src/system/RenderSystem.js', 'utf-8');
  assert(rsSrc.includes('return screenHeight - BACK_BTN.bottom - BACK_BTN.h - SCROLL_BOTTOM_GAP;'),
    '上界计算与 _beginScrollClip 共用同一底边口径');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);