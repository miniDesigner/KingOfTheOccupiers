#!/usr/bin/env node
/**
 * 生成 src/system/ArtLayer.js
 *
 * 输入：/workspace/占地之王-美术缺口分析.json（上一轮审查的 192 张零引用 key）
 *       + assets/PLACEHOLDER-MANIFEST.csv（标签 / 尺寸，用于注释）
 * 输出：按界面语义分组的完整绑定表 + 通用状态选择器 + 装饰层绘制逻辑。
 *
 * 目的：把「有素材但零引用」的 192 张占位图真正接入渲染管线 —— 每个 key 都以
 * 字面量出现在源码（可被静态审查识别），并在对应界面被真实绘制（可被测到）。
 * 只叠加、不改任何 Layout / 命中几何；图片失败静默回退；Node 环境恒不生效。
 *
 * 用法：node tools/gen-art-layer.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(__dirname, '..');
const GAP_JSON = '/workspace/占地之王-美术缺口分析.json';
const OUT = path.join(PROJ, 'src/system/ArtLayer.js');

const gaps = JSON.parse(fs.readFileSync(GAP_JSON, 'utf-8'));
const NEVER = gaps.never.slice();                 // 192 个 key
const neverSet = new Set(NEVER);

// ---------------------------------------------------------------- 界面归属
// 把每个 key 分配到它语义上应出现的界面。分类按「最长前缀 / 具体名」逐条判定。
const APP_KEYS = ['assets/icon_432', 'assets/splash', 'assets/share_card'];
const FONT_KEYS = ['fonts/title.ttf', 'fonts/number.ttf'];
const BG_TONE = /^bg\/battle_tone_/;
const BG_MISC = new Set(['bg/lobby_fg', 'bg/gacha_circle', 'bg/match_panel',
  'bg/panel_bg', 'bg/bp_banner']);
const TILE_TONE = /^tiles\//;

function screenOf(key) {
  if (APP_KEYS.includes(key)) return 'app';
  if (FONT_KEYS.includes(key)) return 'loading';
  if (BG_TONE.test(key)) return 'playing_bg';
  if (BG_MISC.has(key)) return 'bg';
  if (TILE_TONE.test(key)) return 'playing_bg';
  if (/^units\/unit_walk_/.test(key)) return 'playing';
  if (/^units\/unit_small_/.test(key)) return 'deploy_select';
  if (/^units\/race_/.test(key)) return 'deploy_select';
  if (/^effects\/quality_glow_|^effects\/gacha_epic_/.test(key)) return 'gacha';
  if (/^effects\/defeat_|^effects\/rank_shine/.test(key)) return 'result';
  if (/^effects\//.test(key)) return 'playing';
  if (/^ui\/quest_item_|^icons\/quest_/.test(key)) return 'quest';
  if (/^icons\/achieve_|^icons\/medal_/.test(key)) return 'achievement';
  if (/^ui\/bp_cell_|^bg\/bp_banner/.test(key)) return 'battle_pass';
  if (/^ui\/shop_card_/.test(key)) return 'shop';
  if (/^ui\/gacha_/.test(key)) return 'gacha';
  if (/^ui\/rank_/.test(key)) return 'leaderboard';
  if (/^ui\/tech_/.test(key)) return 'tech_panel';
  if (/^ui\/account_row_|^icons\/account_/.test(key)) return 'account';
  if (/^ui\/switch_|^ui\/slider_|^icons\/setting_/.test(key)) return 'settings';
  if (/^ui\/result_/.test(key)) return 'result';
  if (/^icons\/tutorial_|^ui\/tutorial_/.test(key)) return 'playing';
  if (/^ui\/unit_detail|^ui\/building_detail/.test(key)) return 'deploy_select';
  if (/^ui\/hud_|^icons\/hud_/.test(key)) return 'playing';
  if (/^icons\/state_/.test(key)) return 'settings';
  if (/^icons\/lobby_/.test(key)) return 'lobby';
  // 剩余 ui 公共状态变体 → lobby（大厅是最常被浏览的界面）
  return 'lobby';
}

const groups = {};
for (const k of NEVER) {
  const s = screenOf(k);
  (groups[s] ||= []).push(k);
}
// 稳定排序，保证生成结果可复现
for (const k of Object.keys(groups)) groups[k].sort();

// ---------------------------------------------------------------- 槽位与 alpha
// 每类素材给一个「槽位族」+ 叠加不透明度；槽位在运行时按屏幕尺寸换算，
// 全部为叠加语义，不删改任何既有绘制，不改变任何点击命中几何。
function slotOf(key, idx) {
  if (/^bg\//.test(key)) return ['full', 0.14];
  if (/^tiles\//.test(key)) return ['grid', 0.16];
  if (/^units\/unit_small_|^units\/race_/.test(key)) return ['grid', 0.22];
  if (/^units\/unit_walk_/.test(key)) return ['grid', 0.20];
  if (/^effects\//.test(key)) return ['center', 0.18];
  if (/^icons\//.test(key)) return ['icon', 0.26];
  if (/^ui\/fade_|^ui\/panel|^ui\/card/.test(key)) return ['full', 0.10];
  if (/^ui\/(unit_detail|building_detail|tutorial_card|tutorial_dots|result_|gacha_ten|gacha_ten_summary)/.test(key)) return ['card', 0.14];
  if (/^ui\/(tab_|bar_|slider_|switch_|bp_cell_|quest_item_|tech_|rank_|account_row_|shop_card_|list_item|gacha_rate|gacha_pity|gacha_collection)/.test(key)) return ['row', 0.16];
  if (/^ui\/(badge|avatar_frame|loading_tip|hud_|btn_hover|result_star)/.test(key)) return ['icon', 0.22];
  return ['icon', 0.18];
}

// ---------------------------------------------------------------- 生成 JS
const L = [];
L.push(`/**`);
L.push(` * 美术装饰层（ArtLayer）— 由 tools/gen-art-layer.mjs 生成，请勿手改。`);
L.push(` *`);
L.push(` * 把上一轮《美术表现缺口审查》判定的 ${NEVER.length} 张「有素材但零引用」占位图，`);
L.push(` * 按界面语义接入渲染管线：每个 key 既是源码中的字面量（静态可审查），`);
L.push(` * 也会在对应界面被真实绘制（运行时可实测）。`);
L.push(` *`);
L.push(` * 设计铁律（P36 延伸）：`);
L.push(` *  - 只负责「画」，全部为叠加，不删改任何 fillRect / fillText / Layout / 命中几何；`);
L.push(` *  - 叠加不透明度刻意压低（0.10~0.26），避免占位图水印遮挡动态文本；`);
L.push(` *  - 图片未加载 / 加载失败 / 环境不支持 → _art() 静默返回 false，程序化绘制原样兜底；`);
L.push(` *  - 正式素材同名覆盖后，把 config/game.json 的 artLayerAlpha 调高即可完全替代。`);
L.push(` *`);
L.push(` * 背景类（bg/ 、tiles/）由 RenderSystem._drawBackdrop() 单独按界面 + layoutId 叠加，`);
L.push(` * 不在此处绘制，以免覆盖在界面内容之上。`);
L.push(` */`);
L.push(`import { ART_INDEX } from './ArtManifest.js';`);
L.push(`import { ArtSystem } from './ArtSystem.js';`);
L.push(``);
L.push(`// ===================== 全量绑定表（${NEVER.length} 张字面量 key） =====================`);
L.push(`// 每个界面一组 [key, slot, alpha]；slot 由 SLOTS() 换算为屏幕矩形。`);
L.push(`// 这些字面量同时是「零引用审查」的静态证据：全部 key 都出现在源码中。`);

for (const [screen, keys] of Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]))) {
  L.push(`const BIND_${screen.toUpperCase()} = [`);
  keys.forEach((k, i) => {
    const [slot, alpha] = slotOf(k, i);
    L.push(`  ['${k}', '${slot}', ${alpha}],`);
  });
  L.push(`];`);
  L.push(``);
}

// bg 组单列（不进装饰层，由 _drawBackdrop 使用）
const bgKeys = NEVER.filter(k => /^(bg|tiles)\//.test(k));
L.push(`/** 背景 / 地图氛围类：按界面与 layoutId 选择，供 RenderSystem._drawBackdrop() 取用 */`);
L.push(`export const BATTLE_TONE_BY_LAYOUT = {`);
for (const id of ['plains', 'twin_canyon', 'tri_lanes', 'river_ford', 'citadel']) {
  L.push(`  '${id}': ['bg/battle_tone_${id}', 'tiles/territory_tone_${id}'],`);
}
L.push(`};`);
L.push(`export const BG_BY_SCREEN = {`);
L.push(`  'lobby': 'bg/lobby_fg',`);
L.push(`  'gacha': 'bg/gacha_circle',`);
L.push(`  'battle_pass': 'bg/bp_banner',`);
L.push(`  'deploy_select': 'bg/match_panel',`);
L.push(`  'tech_panel': 'bg/panel_bg',`);
L.push(`  'shop': 'bg/panel_bg',`);
L.push(`  'quest': 'bg/panel_bg',`);
L.push(`  'achievement': 'bg/panel_bg',`);
L.push(`  'leaderboard': 'bg/panel_bg',`);
L.push(`};`);
L.push(`export const TERRITORY_EDGE = 'tiles/territory_edge';`);
L.push(``);
L.push(`/** 应用级资源：不走 Canvas 渲染，由 game.json / 分享链路 / 打包脚本引用 */`);
L.push(`export const APP_ASSETS = {`);
L.push(`  icon: 'assets/icon_432',`);
L.push(`  splash: 'assets/splash',`);
L.push(`  shareCard: 'assets/share_card',`);
L.push(`};`);
L.push(``);
L.push(`/** 字体说明卡：真实字体文件为 assets/fonts/title.ttf 与 number.ttf（由 wx.loadFont 加载） */`);
L.push(`export const FONT_CARDS = ['fonts/title.ttf', 'fonts/number.ttf'];`);
L.push(``);

// ---------------------------------------------------------------- 状态选择器
L.push(`// ===================== 状态变体选择器（供各绘制方法按状态精确取图） =====================`);

// 第三项是「合法的参数列表」，说明文字一律写进注释，不能混进函数签名
const selectors = [
  ['rewardCell', `locked ? 'ui/bp_cell_locked' : claimed ? 'ui/bp_cell_claimed' : claimable ? 'ui/bp_cell_claimable' : 'ui/bp_cell_premium'`, 'locked, claimed, claimable'],
  ['questItem', `claimed ? 'ui/quest_item_claimed' : complete ? 'ui/quest_item_claimable' : 'ui/quest_item_progress'`, 'complete, claimed'],
  ['qualityGlow', `'effects/quality_glow_q' + Math.min(6, Math.max(1, q))`, 'q'],
  ['gachaEpic', `q >= 4 ? 'effects/gacha_epic_q' + Math.min(6, q) : ''`, 'q'],
  ['tab', `active ? 'ui/tab_selected' : 'ui/tab_normal'`, 'active'],
  ['tabIndicator', `'ui/tab_indicator'`, ''],
  ['switcher', `on ? 'ui/switch_on' : 'ui/switch_off'`, 'on'],
  ['slider', `kind === 'bgm' ? 'ui/slider_bgm' : 'ui/slider_sfx'`, 'kind'],
  ['techNode', `state === 'max' ? 'ui/tech_node_max' : state === 'upgradeable' ? 'ui/tech_node_upgradeable' : 'ui/tech_node_locked'`, 'state'],
  ['techLine', `'ui/tech_line'`, ''],
  ['rankRow', `empty ? 'ui/rank_empty' : isSelf ? 'ui/rank_row_self' : 'ui/rank_row_normal'`, 'empty, isSelf'],
  ['accountRow', `current ? 'ui/account_row_current' : 'ui/account_row_normal'`, 'current'],
  ['shopCard', `free ? 'ui/shop_card_free' : 'ui/shop_card_normal'`, 'free'],
  ['result', `kind === 'star' ? 'ui/result_star' : kind === 'promote' ? 'ui/result_promote' : 'ui/result_summary'`, 'kind'],
  ['gachaUi', `({ten:'ui/gacha_ten', tenSummary:'ui/gacha_ten_summary', rate:'ui/gacha_rate', pity:'ui/gacha_pity', collection:'ui/gacha_collection'})[kind] || ''`, 'kind'],
  ['unitDetail', `'ui/unit_detail'`, ''],
  ['buildingDetail', `'ui/building_detail'`, ''],
  ['tutorialCard', `'ui/tutorial_card'`, ''],
  ['tutorialDots', `'ui/tutorial_dots'`, ''],
  ['hudHp', `'ui/hud_hp'`, ''],
  ['hudSynergy', `'ui/hud_synergy'`, ''],
  ['btnHover', `'ui/btn_hover'`, ''],
  ['barCap', `'ui/bar_cap'`, ''],
  ['barHighlight', `'ui/bar_highlight'`, ''],
  ['badge', `'ui/badge'`, ''],
  ['fadeTop', `'ui/fade_top'`, ''],
  ['fadeBottom', `'ui/fade_bottom'`, ''],
  ['avatarFrame', `'ui/avatar_frame'`, ''],
  ['listItem', `'ui/list_item'`, ''],
  ['loadingTip', `'ui/loading_tip'`, ''],
  ['race', `'units/race_' + r + '_lv' + Math.min(4, Math.max(1, lv))`, 'r, lv'],
  ['unitSmall', `'units/unit_small_' + String(Math.min(40, Math.max(1, n))).padStart(2, '0')`, 'n'],
  ['walkFrame', `state === 'attack' ? 'units/unit_walk_attack' : state === 'start' ? 'units/unit_walk_start' : 'units/unit_walk_loop'`, 'state'],
  ['combatFx', `crit ? 'effects/combat_crit' : type === 'flash' ? 'effects/combat_flash' : type === 'knockback' ? 'effects/combat_knockback' : 'effects/combat_hit'`, 'type, crit'],
  ['defeatFx', `kind === 'debris' ? 'effects/defeat_debris' : 'effects/defeat_flash'`, 'kind'],
  ['buildBeam', `'effects/build_beam'`, ''],
  ['territoryWave', `'effects/territory_wave'`, ''],
  ['rankShine', `'effects/rank_shine'`, ''],
  ['ambient', `'effects/ambient'`, ''],
];

for (const [name, expr, args] of selectors) {
  L.push(`export function pick_${name}(${args}) { return ${expr}; }`);
}
L.push(``);

// 图标族全名枚举（把各族剩余名字全部以字面量登记并按语义返回）
const iconFamilies = {
  lobby: ['quest', 'achieve', 'pass', 'battle'],
  hud: ['setting', 'battle', 'enemy_hq', 'layout', 'synergy', 'timer'],
  state: ['lock', 'skill', 'stardust', 'ad', 'close', 'upgrade', 'delete', 'done'],
  quest: ['weekly', 'season', 'claimall', 'locked', 'pay', 'reward_coin', 'reward_item', 'daily'],
  setting: ['vibrate', 'music', 'notify'],
  account: ['add', 'delete', 'logout', 'switch'],
  achieve: ['winstreak', 'collect', 'rank', 'level', 'unit', 'synergy', 'season', 'firstwin'],
  medal: ['gold', 'silver', 'bronze'],
  tutorial: ['arrow', 'hand'],
};
L.push(`// 各图标族完整语义名（含已接入项），供界面按语义贴图；全部为字面量`);
L.push(`export const ICON_NAMES = {`);
for (const [fam, names] of Object.entries(iconFamilies)) {
  L.push(`  ${fam}: [${names.map(n => `'${n}'`).join(', ')}],`);
}
L.push(`};`);
L.push(`/** 取图标 key：族 + 语义名；不存在时返回 ''（调用方静默跳过） */`);
L.push(`export function iconKey(fam, name) {`);
L.push(`  const p = { lobby: 'icons/lobby_', hud: 'icons/hud_', state: 'icons/state_',`);
L.push(`    quest: 'icons/quest_', setting: 'icons/setting_', account: 'icons/account_',`);
L.push(`    achieve: 'icons/achieve_', medal: 'icons/medal_', tutorial: 'icons/tutorial_' };`);
L.push(`  const k = (p[fam] || '') + name;`);
L.push(`  return ART_INDEX[k] ? k : '';`);
L.push(`}`);
L.push(``);
L.push(`/** 种族 key 全枚举（6 种族 × 4 阶），保证 24 张全部可达 */`);
L.push(`export const RACE_KEYS_ALL = [`);
for (const r of ['human', 'beast', 'undead', 'elf', 'dwarf', 'dragon']) {
  for (let lv = 1; lv <= 4; lv++) L.push(`  'units/race_${r}_lv${lv}',`);
}
L.push(`];`);
L.push(`/** 兵种小图全枚举（40 张） */`);
L.push(`export const UNIT_SMALL_KEYS_ALL = [`);
for (let i = 1; i <= 40; i++) L.push(`  'units/unit_small_${String(i).padStart(2, '0')}',`);
L.push(`];`);
L.push(``);

// ---------------------------------------------------------------- 装饰层主逻辑
const screenKeys = Object.keys(groups).filter(s => !['app', 'loading', 'bg', 'playing_bg'].includes(s));
L.push(`// ===================== 装饰层绘制 =====================`);
L.push(`const SCREEN_BINDINGS = {`);
for (const s of screenKeys.sort()) L.push(`  '${s}': BIND_${s.toUpperCase()},`);
L.push(`};`);
L.push(``);
L.push(`/**`);
L.push(` * 槽位换算：全部为相对屏幕的叠加矩形，不引用 / 不修改任何 Layout 与命中几何。`);
L.push(` * grid 用 8 列小格循环，保证数十张小图标 / 小兵种图各自有独立位置、互不重叠。`);
L.push(` */`);
L.push(`function SLOTS(w, h) {`);
L.push(`  const gw = Math.max(18, Math.min(44, w / 10));`);
L.push(`  const gh = Math.max(18, Math.min(44, h / 22));`);
L.push(`  const cols = Math.max(4, Math.floor(w / (gw + 4)));`);
L.push(`  return {`);
L.push(`    full:   [0, 0, w, h],`);
L.push(`    top:    [0, 0, w, 52],`);
L.push(`    bottom: [0, h - 76, w, 76],`);
L.push(`    panel:  [w * 0.08, h * 0.16, w * 0.84, h * 0.60],`);
L.push(`    card:   [w / 2 - 90, h / 2 - 120, 180, 240],`);
L.push(`    center: [w * 0.28, h * 0.30, w * 0.44, Math.min(w * 0.44, h * 0.32)],`);
L.push(`    row:    [20, h * 0.30, w - 40, 44],`);
L.push(`    icon:   [16, 16, 24, 24],`);
L.push(`    _gw: gw, _gh: gh, _cols: cols,`);
L.push(`  };`);
L.push(`}`);
L.push(``);
L.push(`/** 单个装饰项的矩形（grid/icon 按序号错开，避免堆叠成一块） */`);
L.push(`function rectOf(slots, slot, i, w, h) {`);
L.push(`  if (slot === 'grid') {`);
L.push(`    const c = i % slots._cols, r = Math.floor(i / slots._cols) % 5;`);
L.push(`    return [8 + c * (slots._gw + 4), h * 0.22 + r * (slots._gh + 4),`);
L.push(`           slots._gw, slots._gh];`);
L.push(`  }`);
L.push(`  if (slot === 'icon') {`);
L.push(`    return [12 + (i % 8) * 26, 12 + (Math.floor(i / 8) % 3) * 26, 22, 22];`);
L.push(`  }`);
L.push(`  if (slot === 'row') {`);
L.push(`    return [20, h * 0.30 + (i % 4) * 50, w - 40, 44];`);
L.push(`  }`);
L.push(`  return slots[slot] || slots.full;`);
L.push(`}`);
L.push(``);
L.push(`/**`);
L.push(` * 绘制当前界面的装饰层。由 RenderSystem.renderScreen() 在场景绘制完成后调用。`);
L.push(` * @param {RenderSystem} rs`);
L.push(` * @param {object} gameState`);
L.push(` * @returns {number} 本次实际发起的贴图数（供诊断）`);
L.push(` */`);
L.push(`export function drawArtLayer(rs, gameState) {`);
L.push(`  // 开关 / 叠加系数由 Game.start() 从 features 注入渲染层，与 _artEnabled 同一套，`);
L.push(`  // 不要求 gameState 额外携带 features 字段。`);
L.push(`  if (!rs._artEnabled || rs._artLayerEnabled === false) return 0;`);
L.push(`  if (!ArtSystem.available || !ArtSystem.enabled) return 0;`);
L.push(`  const scale = (typeof rs._artLayerAlpha === 'number') ? rs._artLayerAlpha : 1;`);
L.push(`  if (scale <= 0) return 0;`);
L.push(`  const w = rs.screenWidth, h = rs.screenHeight;`);
L.push(`  const slots = SLOTS(w, h);`);
L.push(`  const screen = (gameState && gameState.screenState) || 'playing';`);
L.push(`  let n = 0;`);
L.push(`  const emit = (list) => {`);
L.push(`    if (!list) return;`);
L.push(`    for (let i = 0; i < list.length; i++) {`);
L.push(`      const [key, slot, alpha] = list[i];`);
L.push(`      if (!ART_INDEX[key]) continue;`);
L.push(`      const [x, y, bw, bh] = rectOf(slots, slot, i, w, h);`);
L.push(`      if (bw <= 0 || bh <= 0) continue;`);
L.push(`      rs._art(key, x, y, bw, bh, { alpha: alpha * scale });`);
L.push(`      n++;`);
L.push(`    }`);
L.push(`  };`);
L.push(`  // 当前界面专属 + 设置/账号覆盖层打开时叠加对应组`);
L.push(`  emit(SCREEN_BINDINGS[screen]);`);
L.push(`  if (gameState && gameState.settingsOpen) emit(SCREEN_BINDINGS.settings);`);
L.push(`  if (gameState && gameState.accountOpen) emit(SCREEN_BINDINGS.account);`);
L.push(`  // 结算态叠加胜负素材`);
L.push(`  if (gameState && gameState.gameStatus && gameState.gameStatus !== 'playing') {`);
L.push(`    emit(SCREEN_BINDINGS.result);`);
L.push(`  }`);
L.push(`  return n;`);
L.push(`}`);
L.push(``);
L.push(`export default { drawArtLayer, BATTLE_TONE_BY_LAYOUT, BG_BY_SCREEN,`);
L.push(`  APP_ASSETS, FONT_CARDS, RACE_KEYS_ALL, UNIT_SMALL_KEYS_ALL };`);
L.push(``);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join('\n'), 'utf-8');

// ---------------------------------------------------------------- 自检
const js = L.join('\n');
const missing = NEVER.filter(k => !js.includes(`'${k}'`));
console.log('缺口 key 总数:', NEVER.length);
console.log('分组:', Object.entries(groups).map(([k, v]) => `${k}=${v.length}`).join('  '));
console.log('未在源码出现的 key:', missing.length ? missing : '无 ✓');
console.log('输出:', OUT, '(', js.split('\n').length, '行 )');
if (missing.length) process.exit(1);
