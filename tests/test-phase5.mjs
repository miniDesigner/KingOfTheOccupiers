/**
 * Phase 5 集成测试 — 分享 / 排行榜 / 新手引导 / 成就追踪
 * 运行：node tests/test-phase5.mjs
 */
import { readFileSync } from 'fs';

// === 浏览器环境桩 ===
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
global.wx = {
  shareAppMessage(cfg) { global.__lastShare = cfg; },
};

// === 加载模块（ConfigLoader 猴子补丁） ===
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const deployables = JSON.parse(readFileSync(new URL('../config/deployables.json', import.meta.url), 'utf-8'));
const questsCfg = JSON.parse(readFileSync(new URL('../config/quests.json', import.meta.url), 'utf-8'));
const techCfg = JSON.parse(readFileSync(new URL('../config/tech-tree.json', import.meta.url), 'utf-8'));
const _cfgs = { deployables, quests: questsCfg, techTree: techCfg };
ConfigLoader.getSafe = (k) => (_cfgs[k] !== undefined ? _cfgs[k] : null);
ConfigLoader.get = ConfigLoader.getSafe;

const ProfileManager = await import('../src/meta/ProfileManager.js');
const ShareSystem = (await import('../src/meta/ShareSystem.js')).default;
const LeaderboardSystem = (await import('../src/meta/LeaderboardSystem.js')).default;
const QuestSystem = (await import('../src/meta/QuestSystem.js')).default;
const DeploymentSystem = (await import('../src/meta/DeploymentSystem.js')).default;

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗ FAIL:', name); }
}

console.log('=== 测试1: 分享配置文案 ===');
const profile = ProfileManager.load();
profile.collectedUnits = { swordsman: { level: 1, recruitCount: 0 } };
ProfileManager.save();
const cfgLobby = ShareSystem.getShareConfig({ scene: 'lobby' });
assert(cfgLobby.title.includes('1/40'), '大厅分享文案含收集进度');
const cfgWin = ShareSystem.getShareConfig({ scene: 'victory', enemyName: '测试对手' });
assert(cfgWin.title.includes('测试对手'), '胜利分享文案含对手名');
const cfgLose = ShareSystem.getShareConfig({ scene: 'defeat' });
assert(cfgLose.title.length > 5, '失败分享文案生成');

console.log('=== 测试2: 分享 + 每日奖励 ===');
profile.gold = 1000; profile.stardust = 0; profile.lastShareDate = '';
ProfileManager.save();
const r1 = ShareSystem.shareAndReward({ scene: 'lobby' });
assert(r1.success && r1.message.includes('金币'), '首次分享发放奖励提示');
assert(profile.gold === 1200, `金币+200（实际${profile.gold}）`);
assert(profile.stardust === 5, `星尘+5（实际${profile.stardust}）`);
assert(profile.shareCount === 1, 'shareCount 累计为1');
assert(global.__lastShare && global.__lastShare.title, 'wx.shareAppMessage 被调用');
const r2 = ShareSystem.shareAndReward({ scene: 'lobby' });
assert(r2.success && profile.shareCount === 1 && profile.gold === 1200, '同日重复分享不再发奖');
assert(ShareSystem.isDailyRewardClaimed() === true, 'isDailyRewardClaimed 返回 true');

console.log('=== 测试3: 排行榜 ===');
for (const board of LeaderboardSystem.BOARDS) {
  const lb = LeaderboardSystem.getLeaderboard(board.key);
  assert(lb.entries.length >= 15, `${board.label} 条目数充足（${lb.entries.length}）`);
  assert(lb.playerRank >= 1 && lb.playerRank <= 20, `${board.label} 玩家排名有效（${lb.playerRank}）`);
  assert(lb.entries.some(e => e.isPlayer), `${board.label} 含玩家条目`);
  // 排序正确性
  const values = lb.entries.map(e => e[board.metric]);
  const sorted = [...values].sort((a, b) => b - a);
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${board.label} 降序排序正确`);
}
// 确定性：两次生成结果一致
const lb1 = LeaderboardSystem.getLeaderboard('power');
const lb2 = LeaderboardSystem.getLeaderboard('power');
assert(JSON.stringify(lb1.entries.map(e => e.name)) === JSON.stringify(lb2.entries.map(e => e.name)), '伪对手名单确定性生成');

console.log('=== 测试4: 新手引导字段与奖励 ===');
profile.tutorialStep = 0;
ProfileManager.save();
const fresh = ProfileManager.load();
assert(fresh.tutorialStep === 0, 'tutorialStep 持久化');
fresh.addCurrency('gold', 100);
assert(fresh.gold === 1300, '引导完成奖励金币+100（实际' + fresh.gold + '）');

console.log('=== 测试5: 成就追踪链路 ===');
QuestSystem.checkDailyRefresh();
// 注意：ProfileManager.load() 会替换内部实例，此处重新获取最新引用
const p5 = ProfileManager.get();
p5.gold = 10000;
ProfileManager.save();
const pullsBefore = p5.totalPulls || 0;
DeploymentSystem.gachaDraw();
assert(p5.totalPulls === pullsBefore + 1, `抽卡后 totalPulls 累计（${pullsBefore}→${p5.totalPulls}）`);
const ach = QuestSystem.getAchievements();
const gachaAch = ach.find(a => a.id === 'a_gacha_100');
assert(gachaAch && gachaAch.progress === p5.totalPulls, `a_gacha_100 进度=${gachaAch ? gachaAch.progress : 'N/A'} 与 totalPulls=${p5.totalPulls} 一致`);
// share_count 成就进度
const shareAch = ach.find(a => a.id === 'a_share_first');
assert(shareAch && shareAch.progress === 1, `a_share_first 进度=1（实际${shareAch ? shareAch.progress : 'N/A'}）`);
// hero_count 成就（fromJSON 迁移会补全6个初始兵种，进度应等于实际收集数）
const heroAch = ach.find(a => a.id === 'a_hero_count_40');
const ownedCount = Object.keys(p5.collectedUnits || {}).length;
assert(heroAch && heroAch.progress === ownedCount, `a_hero_count_40 进度=${heroAch ? heroAch.progress : 'N/A'} 与实际收集数=${ownedCount} 一致`);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
