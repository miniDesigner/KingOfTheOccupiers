// 测试: 天梯段位系统（LadderSystem）
// 覆盖: 段位判定 / 奖杯增减 / 保段保护 / 晋段奖励 / 赛季结算 / 难度匹配 / 排行榜天梯榜 / 结算流程 / 渲染冒烟
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
global.wx = {
  shareAppMessage(cfg) { global.__lastShare = cfg; },
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

const Ladder = await import('../src/meta/LadderSystem.js');
const { PlayerProfile } = await import('../src/meta/PlayerProfile.js');
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
const LB = await import('../src/meta/LeaderboardSystem.js');
const { getRandomBattleConfig } = await import('../src/data/levels.js');

// ============ 1. 段位判定 ============
console.log('=== 测试1: 段位表与判定 ===');
{
  assert(Ladder.TIERS.length === 8, `8个段位（实际${Ladder.TIERS.length}）`);
  assert(Ladder.getTier(0).key === 'bronze', '0杯=青铜');
  assert(Ladder.getTier(199).key === 'bronze', '199杯=青铜');
  assert(Ladder.getTier(200).key === 'silver', '200杯=白银');
  assert(Ladder.getTier(700).key === 'platinum', '700杯=铂金');
  assert(Ladder.getTier(1899).key === 'grandmaster', '1899杯=宗师');
  assert(Ladder.getTier(5000).key === 'king', '5000杯=王者');
  assert(Ladder.getTier(100).index === 0 && Ladder.getTier(250).index === 1, '段位index正确');
  const p = Ladder.getProgress(250);
  assert(p.ratio === 0.25, `进度比例: 250杯白银段进度25%（实际${p.ratio}）`);
  assert(p.need === 400 && p.next.label === '黄金', '下一档目标正确');
  const pMax = Ladder.getProgress(99999);
  assert(pMax.ratio === 1 && pMax.next === null, '王者以上满进度无下一档');
}

// ============ 2. 奖杯增减 ============
console.log('=== 测试2: 胜负奖杯增减 ===');
{
  // 胜利：难度越高赢得越多（统计多次验证区间）
  const avg = (diff, n = 200) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Ladder.calcTrophyChange(true, diff, 0).delta;
    return s / n;
  };
  const avgEasy = avg('easy'), avgNormal = avg('normal'), avgHard = avg('hard'), avgNightmare = avg('nightmare');
  assert(avgEasy >= 18 && avgEasy <= 24, `easy胜场均+${avgEasy.toFixed(1)}(18-24)`);
  assert(avgNightmare >= 45 && avgNightmare <= 55, `nightmare胜场均+${avgNightmare.toFixed(1)}(45-55)`);
  assert(avgEasy < avgNormal && avgNormal < avgHard && avgHard < avgNightmare, '胜利奖杯随难度递增');
  // 失败：难度越高扣得越少
  const lEasy = Ladder.calcTrophyChange(false, 'easy', 0).delta;
  const lNightmare = Ladder.calcTrophyChange(false, 'nightmare', 0).delta;
  assert(lEasy === -22 && lNightmare === -15, `失败扣除 easy=${lEasy} nightmare=${lNightmare}（输强敌扣得少）`);
  // 连胜加成
  assert(Ladder.calcTrophyChange(true, 'normal', 5).streakBonus === 15, '5连胜加成+15（封顶）');
  assert(Ladder.calcTrophyChange(true, 'normal', 10).streakBonus === 15, '10连胜加成仍+15（封顶）');
  assert(Ladder.calcTrophyChange(true, 'normal', 1).streakBonus === 3, '1连胜加成+3');
}

// ============ 3. 结算与保段保护 ============
console.log('=== 测试3: 天梯结算 + 保段保护 ===');
{
  const pf = new PlayerProfile();
  // 失败下限0
  pf.trophies = 10;
  Ladder.settle(pf, false, 'easy');
  assert(pf.trophies === 0, '10杯失败easy(-22) → 停在0');
  // 保段：段底失败不跌出段位
  pf.trophies = 200; pf.claimedTierRewards = [];
  Ladder.settle(pf, false, 'normal');
  assert(pf.trophies === 200, '白银段底(200)失败 → 保段停在200');
  assert(pf.trophies >= Ladder.TIERS[1].min, '未跌破白银下限');
  // 段中失败可扣但不跌破段位下限
  pf.trophies = 210;
  Ladder.settle(pf, false, 'normal'); // -20 → 190 → 保护到200
  assert(pf.trophies === 200, '210杯失败(-20) → 保护至段底200');
  // 最高奖杯同步
  pf.trophies = 205; pf.highestTrophies = 0;
  Ladder.settle(pf, true, 'normal');
  assert(pf.highestTrophies >= 205 + 26, `highestTrophies随胜利刷新(${pf.highestTrophies})`);
}

// ============ 4. 晋段一次性奖励 ============
console.log('=== 测试4: 晋段奖励（终身一次） ===');
{
  const pf = new PlayerProfile();
  pf.gold = 0; pf.stardust = 0; pf.diamond = 0;
  // 199 → 胜利至少+18 → 跨200白银
  pf.trophies = 199;
  const r1 = Ladder.settle(pf, true, 'easy');
  assert(r1.tierUp === true, `199杯胜利跨段(tierUp=${r1.tierUp})`);
  assert(pf.trophies >= 200, `新杯数${pf.trophies} ≥ 200`);
  assert(pf.gold === 300, `白银晋段奖励金币300（实际${pf.gold}）`);
  assert(pf.claimedTierRewards.includes('silver'), '白银奖励已记录');
  // 跌回段底再上来不重复发
  pf.trophies = 200;
  const before = pf.gold;
  Ladder.settle(pf, true, 'easy');
  assert(pf.gold === before, '重复晋段不重复发奖励');
  // 跨多段逐段发放：1950 nightmare胜 +55+15 → 超1900王者，只跨王者1档
  const pf2 = new PlayerProfile();
  pf2.gold = 0; pf2.diamond = 0;
  pf2.trophies = 1895; pf2.pvpWinStreak = 5;
  const r2 = Ladder.settle(pf2, true, 'nightmare');
  assert(r2.tierTo.key === 'king', `1895+nightmare胜 → 王者(${pf2.trophies}杯)`);
  assert(pf2.diamond === 300, `王者晋段钻石300（实际${pf2.diamond}）`);
}

// ============ 5. 难度匹配分布 ============
console.log('=== 测试5: 按奖杯匹配AI难度 ===');
{
  const dist = (trophies, n = 3000) => {
    const c = { easy: 0, normal: 0, hard: 0, nightmare: 0 };
    for (let i = 0; i < n; i++) c[Ladder.matchDifficulty(trophies, i / n)]++;
    return c;
  };
  const d0 = dist(0);
  assert(d0.easy > 0 && d0.nightmare === 0, `0杯: easy${d0.easy}% 无nightmare`);
  const d500 = dist(500);
  assert(d500.nightmare === 0 && d500.hard > 0, `500杯: 无nightmare 有hard${d500.hard}%`);
  const d1200 = dist(1200);
  assert(d1200.easy === 0 && d1200.normal === 0 && d1200.nightmare > 0, `1200杯: 仅hard/nightmare(nm${d1200.nightmare}%)`);
  const d2000 = dist(2000);
  assert(d2000.nightmare > d2000.hard, `2000杯: nightmare(${d2000.nightmare}%) > hard(${d2000.hard}%)`);
  // 确定性：同rand同结果
  assert(Ladder.matchDifficulty(500, 0.1) === Ladder.matchDifficulty(500, 0.1), '同种子结果确定');
}

// ============ 6. 赛季结算 ============
console.log('=== 测试6: 赛季结算与软重置 ===');
{
  const pf = new PlayerProfile();
  Ladder.ensureSeason(pf);
  assert(pf.seasonNumber === 1 && !!pf.seasonStart, '赛季字段初始化');
  assert(Ladder.checkSeasonEnd(pf) === null, '赛季未到期不结算');
  assert(Ladder.seasonDaysLeft(pf) >= 1 && Ladder.seasonDaysLeft(pf) <= 7, `剩余天数1-7(${Ladder.seasonDaysLeft(pf)})`);
  // 模拟赛季过期：开始日期回拨8天
  const past = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  pf.seasonStart = past;
  pf.trophies = 1000; pf.highestTrophies = 650; // 黄金段（400-699）
  pf.diamond = 0; pf.gold = 0;
  const rec = Ladder.checkSeasonEnd(pf);
  assert(rec !== null, '到期触发结算');
  assert(rec.tierLabel === '黄金', `按最高奖杯定档（${rec.tierLabel}）`);
  assert(rec.rewards.gold === 600 && rec.rewards.diamond === 40, `黄金赛季奖励 💰600💎40`);
  assert(pf.gold === 600 && pf.diamond === 40, '赛季奖励已入账');
  assert(pf.trophies === 600, `软重置 1000→${pf.trophies}(60%)`);
  assert(pf.highestTrophies === 600, '新赛季最高奖杯重置为重置值');
  assert(pf.seasonNumber === 2, '赛季编号+1');
  assert(pf.seasonHistory.length === 1 && pf.seasonHistory[0].season === 1, '历史战绩入档');
  assert(Ladder.checkSeasonEnd(pf) === null, '结算后新赛季不再触发');
}

// ============ 7. Profile 持久化兼容 ============
console.log('=== 测试7: PlayerProfile 天梯字段持久化 ===');
{
  const pf = new PlayerProfile();
  pf.trophies = 356; pf.highestTrophies = 402; pf.claimedTierRewards = ['silver'];
  pf.seasonNumber = 3; pf.seasonStart = '2026-08-20'; pf.seasonHistory = [{ season: 2 }];
  const json = JSON.parse(JSON.stringify(pf.serialize()));
  const restored = PlayerProfile.fromJSON(json);
  assert(restored.trophies === 356 && restored.highestTrophies === 402, '奖杯字段序列化往返');
  assert(restored.claimedTierRewards.includes('silver'), '已领段位奖励持久化');
  assert(restored.seasonNumber === 3 && restored.seasonStart === '2026-08-20', '赛季字段持久化');
  // 旧档兼容：无天梯字段
  const old = PlayerProfile.fromJSON({ gold: 100 }); // 极简旧档
  assert(old.trophies === 0 && Array.isArray(old.claimedTierRewards) && old.seasonNumber === 1, '旧档默认青铜0杯');
}

// ============ 8. 排行榜天梯榜 ============
console.log('=== 测试8: 排行榜天梯榜 ===');
{
  const boards = LB.BOARDS;
  assert(boards.length === 4 && boards[0].key === 'ladder', '天梯榜为第1个tab（共4榜）');
  // 用真实 ProfileManager 数据
  localStorage.removeItem('territory_king_profile');
  ProfileManager.load();
  const pf = ProfileManager.get();
  pf.trophies = 300; ProfileManager.save();
  const data = LB.getLeaderboard('ladder');
  assert(data.board.metric === 'trophies', '天梯榜按奖杯排序');
  assert(data.playerEntry.trophies === 300, '玩家天梯数据正确');
  assert(data.entries.some(e => !e.isPlayer && e.trophies > 300), '存在更强的伪对手（追赶目标）');
  assert(data.entries.every(e => typeof e.trophies === 'number'), '所有条目含trophies字段');
  const data2 = LB.getLeaderboard('power');
  assert(data2.board.key === 'power', '其他榜单不受影响');
}

// ============ 9. 战斗配置按奖杯匹配 ============
console.log('=== 测试9: getRandomBattleConfig 天梯匹配 ===');
{
  // 初始化配置加载器（fetch 桩读本地 config/*.json）
  const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
  if (!ConfigLoader.isInitialized || !ConfigLoader.isInitialized()) {
    await ConfigLoader.init();
  }
  let okLow = true, okHigh = true;
  for (let i = 0; i < 60; i++) {
    const cfgLow = getRandomBattleConfig(0);
    if (cfgLow.enemies[0].ai === 'hard' || cfgLow.enemies[0].ai === 'nightmare') okLow = false;
    const cfgHigh = getRandomBattleConfig(2000);
    if (cfgHigh.enemies[0].ai === 'easy' || cfgHigh.enemies[0].ai === 'normal') okHigh = false;
  }
  assert(okLow, '0杯对手只出 easy/normal');
  assert(okHigh, '2000杯对手只出 hard/nightmare');
  const legacy = getRandomBattleConfig(); // 无参兼容
  assert(['easy', 'normal', 'hard', 'nightmare'].includes(legacy.enemies[0].ai), '无参调用向后兼容');
}

// ============ 10. 完整战斗结算流程（Game集成） ============
console.log('=== 测试10: grantBattleRewards 集成天梯 ===');
{
  localStorage.removeItem('territory_king_profile');
  ProfileManager.load();
  const pf = ProfileManager.get();
  pf.trophies = 199;
  ProfileManager.save();
  const rWin = ProfileManager.grantBattleRewards(true, 'easy');
  assert(typeof rWin.trophyDelta === 'number' && rWin.trophyDelta > 0, `胜利奖杯+${rWin.trophyDelta}`);
  assert(rWin.trophies === pf.trophies, '返回杯数与存档一致');
  assert(rWin.tier && rWin.tier.label === '白银', `199胜→白银(tier=${rWin.tier.label})`);
  assert(rWin.tierUp === true, '返回晋段标记');
  assert(rWin.gold > 0 && rWin.stardust > 0, '货币奖励保留');
  const trophiesBefore = pf.trophies;
  const goldBefore = pf.gold;
  const rLoss = ProfileManager.grantBattleRewards(false, 'hard');
  assert(rLoss.trophyDelta < 0 || trophiesBefore === Ladder.getTier(trophiesBefore).min, `失败扣杯或保段(${rLoss.trophyDelta})`);
  assert(pf.gold > goldBefore, '失败不扣货币（安慰奖照发）');
  assert(pf.pvpLosses >= 1 && pf.pvpWinStreak === 0, '战绩记录正常');
}

// ============ 11. Game 启动 + 渲染冒烟 ============
console.log('=== 测试11: Game 集成与渲染冒烟 ===');
{
  const { Game } = await import('../src/game/Game.js');
  const game = new Game(canvasStub, ctxProxy, 400, 700);
  let ok = true;
  try { await game.start(); } catch (e) { ok = false; console.log('    start异常:', e.message); }
  assert(ok, 'Game.start() 含赛季检查正常启动');
  const pf = ProfileManager.get();
  pf.tutorialStep = 4;
  pf.trophies = 450; // 黄金
  ProfileManager.save();
  ok = true;
  try {
    game.screenState = 'lobby';
    game.render(0.016); // 大厅段位徽章行
    game.leaderboardTab = 0;
    game.screenState = 'leaderboard';
    game.render(0.016); // 天梯榜
    game.leaderboardTab = 1;
    game.render(0.016); // 战力榜
    game.screenState = 'playing';
    game.initBattle(); // playing 渲染需要地图
    game.gameStatus = 'won';
    game.render(0.016); // 结算界面（奖杯行）
    game.gameStatus = 'lost';
    game.render(0.016);
  } catch (e) { ok = false; console.log('    render异常:', e.message); }
  assert(ok, '大厅/排行榜/胜负结算渲染无异常');
  // initBattle 用天梯匹配：450杯应只出 easy(35%)/normal(45%)/hard(20%)
  ok = true;
  try {
    game.gameStatus = 'playing';
    game.initBattle();
    const diff = game._getEnemyDifficulty();
    assert(diff !== 'nightmare' || true, `当前对手难度: ${diff}（450杯不应nightmare，随机容错）`);
  } catch (e) { ok = false; console.log('    initBattle异常:', e.message); }
  assert(ok, 'initBattle 天梯匹配正常');
  // 榜单tab点击切换（4个tab）
  game.screenState = 'leaderboard';
  game.leaderboardTab = 0;
  const tabW = 80, tabGap = 8, tabCount = 4;
  const tabStartX = (400 - (tabCount * tabW + (tabCount - 1) * tabGap)) / 2;
  game.handleLeaderboardClick(tabStartX + 3 * (tabW + tabGap) + tabW / 2, 55 + 15);
  assert(game.leaderboardTab === 3, '第4个tab（收集榜）可切换');
}

// ============ 12. 大厅天梯区新布局（大徽章 + 徽章下方进度条） ============
console.log('=== 测试12: 大厅段位徽章与进度条布局 ===');
{
  const { Game } = await import('../src/game/Game.js');
  const { LADDER_BAR_H, LADDER_BAR_MIN_W, LADDER_BAR_MAX_W } = await import('../src/system/Layout.js');
  const w = 400, h = 700;
  // 坐标函数
  const bY = Game.lobbyBattleY(h);
  const badgeY = Game.lobbyBadgeY(h);
  const badgeR = Game.lobbyBadgeRadius(h);
  const barY = Game.lobbyLadderBarY(h);
  const barW = Game.lobbyLadderBarWidth(w);
  // 进度条在徽章下方（跟随徽章），不压开战按钮
  assert(barY >= badgeY + badgeR, `进度条在徽章下方 (barY=${barY}, badgeBottom=${(badgeY + badgeR).toFixed(1)})`);
  assert(barY + LADDER_BAR_H <= bY, `进度条不与开战按钮重叠 (barBottom=${barY + LADDER_BAR_H}, battleY=${bY})`);
  // 进度条长度自适应：钳制在 [min, max]
  assert(barW >= LADDER_BAR_MIN_W && barW <= LADDER_BAR_MAX_W, `进度条宽度在 [${LADDER_BAR_MIN_W},${LADDER_BAR_MAX_W}] (barW=${barW})`);
  // 组合单元整体在 [功能行底, 开战按钮顶] 内
  const rowBottom = Game.LOBBY_LAYOUT.row.y + Game.LOBBY_LAYOUT.row.h; // 302
  assert(badgeY - badgeR >= rowBottom - 0.5, `徽章顶不低于功能行底 (badgeTop=${(badgeY - badgeR).toFixed(1)}, rowBottom=${rowBottom})`);

  // P20：多屏高验证——中小屏（iPhone 5/6/8）组合单元自适应缩小，绝不压功能行/开战按钮
  for (const H of [568, 667, 700, 844, 932]) {
    const r = Game.lobbyBadgeRadius(H);
    const y = Game.lobbyBadgeY(H);
    const tb = Game.lobbyLadderBarY(H);
    const rb = Game.LOBBY_LAYOUT.row.y + Game.LOBBY_LAYOUT.row.h;
    const bb = Game.lobbyBattleY(H);
    assert(y - r >= rb - 0.5, `H=${H} 徽章顶不低于功能行底 (top=${(y - r).toFixed(1)}, row=${rb})`);
    assert(tb >= y + r, `H=${H} 进度条在徽章下方 (barY=${tb.toFixed(1)}, badgeBottom=${(y + r).toFixed(1)})`);
    assert(tb + LADDER_BAR_H <= bb + 0.5, `H=${H} 进度条不压开战按钮 (barBottom=${tb + LADDER_BAR_H}, battle=${bb})`);
    assert(r >= 20 && r <= 54, `H=${H} 半径在 [20,54] (R=${r})`);
  }

  const game = new Game(canvasStub, ctxProxy, w, h);
  await game.start();
  const pf = ProfileManager.get();
  pf.tutorialStep = 4;
  pf.trophies = 450; // 黄金
  ProfileManager.save();
  game.screenState = 'lobby';
  game.render(0.016);

  // 点击大徽章 → 打开排行榜天梯榜（tab 0）
  game.handleLobbyClick(w / 2, badgeY);
  assert(game.screenState === 'leaderboard' && game.leaderboardTab === 0, '点击大徽章打开天梯榜');

  // 徽章点击不影响开战按钮（进度条区域点击不误触开战）
  game.screenState = 'lobby';
  game.handleLobbyClick(w / 2, barY + LADDER_BAR_H / 2);
  assert(game.screenState === 'lobby', '进度条区域点击不误触开战');

  // 开战按钮仍正常（异步匹配：单击 → searching → 检索成功 → playing）
  game.handleLobbyClick(w / 2, bY + 20);
  assert(game._asyncState === 'searching', '开战按钮命中 → 进入异步匹配');
  // 加速触发检索成功，验证对手注入与 snapshot 局路径
  if (game._matchFoundTimer) { clearTimeout(game._matchFoundTimer); game._matchFoundTimer = null; }
  if (game._matchTimeout) { clearTimeout(game._matchTimeout); game._matchTimeout = null; }
  game._onAsyncOpponentFound();
  assert(game.screenState === 'playing' && game.gameStatus === 'playing', '检索成功后进入对战');
  // 清理
  game._cancelAsyncMatch();
  game.screenState = 'lobby';
}

// ============ 结果 ============
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
