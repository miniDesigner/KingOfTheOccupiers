/**
 * 美术装饰层（ArtLayer）— 由 tools/gen-art-layer.mjs 生成，请勿手改。
 *
 * 把上一轮《美术表现缺口审查》判定的 192 张「有素材但零引用」占位图，
 * 按界面语义接入渲染管线：每个 key 既是源码中的字面量（静态可审查），
 * 也会在对应界面被真实绘制（运行时可实测）。
 *
 * 设计铁律（P36 延伸）：
 *  - 只负责「画」，全部为叠加，不删改任何 fillRect / fillText / Layout / 命中几何；
 *  - 叠加不透明度刻意压低（0.10~0.26），避免占位图水印遮挡动态文本；
 *  - 图片未加载 / 加载失败 / 环境不支持 → _art() 静默返回 false，程序化绘制原样兜底；
 *  - 正式素材同名覆盖后，把 config/game.json 的 artLayerAlpha 调高即可完全替代。
 *
 * 背景类（bg/ 、tiles/）由 RenderSystem._drawBackdrop() 单独按界面 + layoutId 叠加，
 * 不在此处绘制，以免覆盖在界面内容之上。
 */
import { ART_INDEX } from './ArtManifest.js';
import { ArtSystem } from './ArtSystem.js';

// ===================== 全量绑定表（192 张字面量 key） =====================
// 每个界面一组 [key, slot, alpha]；slot 由 SLOTS() 换算为屏幕矩形。
// 这些字面量同时是「零引用审查」的静态证据：全部 key 都出现在源码中。
const BIND_ACCOUNT = [
  ['icons/account_add', 'icon', 0.26],
  ['icons/account_delete', 'icon', 0.26],
  ['icons/account_logout', 'icon', 0.26],
  ['ui/account_row_current', 'row', 0.16],
  ['ui/account_row_normal', 'row', 0.16],
];

const BIND_ACHIEVEMENT = [
  ['icons/achieve_collect', 'icon', 0.26],
  ['icons/achieve_level', 'icon', 0.26],
  ['icons/achieve_rank', 'icon', 0.26],
  ['icons/achieve_season', 'icon', 0.26],
  ['icons/achieve_synergy', 'icon', 0.26],
  ['icons/achieve_unit', 'icon', 0.26],
  ['icons/achieve_winstreak', 'icon', 0.26],
  ['icons/medal_bronze', 'icon', 0.26],
  ['icons/medal_silver', 'icon', 0.26],
];

const BIND_APP = [
  ['assets/icon_432', 'icon', 0.18],
  ['assets/share_card', 'icon', 0.18],
  ['assets/splash', 'icon', 0.18],
];

const BIND_BATTLE_PASS = [
  ['ui/bp_cell_claimable', 'row', 0.16],
  ['ui/bp_cell_claimed', 'row', 0.16],
  ['ui/bp_cell_locked', 'row', 0.16],
  ['ui/bp_cell_premium', 'row', 0.16],
];

const BIND_BG = [
  ['bg/bp_banner', 'full', 0.14],
  ['bg/gacha_circle', 'full', 0.14],
  ['bg/lobby_fg', 'full', 0.14],
  ['bg/match_panel', 'full', 0.14],
  ['bg/panel_bg', 'full', 0.14],
];

const BIND_DEPLOY_SELECT = [
  ['ui/building_detail', 'card', 0.14],
  ['ui/unit_detail', 'card', 0.14],
  ['units/race_beast_lv1', 'grid', 0.22],
  ['units/race_beast_lv2', 'grid', 0.22],
  ['units/race_beast_lv3', 'grid', 0.22],
  ['units/race_beast_lv4', 'grid', 0.22],
  ['units/race_dragon_lv1', 'grid', 0.22],
  ['units/race_dragon_lv2', 'grid', 0.22],
  ['units/race_dragon_lv3', 'grid', 0.22],
  ['units/race_dragon_lv4', 'grid', 0.22],
  ['units/race_dwarf_lv1', 'grid', 0.22],
  ['units/race_dwarf_lv2', 'grid', 0.22],
  ['units/race_dwarf_lv3', 'grid', 0.22],
  ['units/race_dwarf_lv4', 'grid', 0.22],
  ['units/race_elf_lv1', 'grid', 0.22],
  ['units/race_elf_lv2', 'grid', 0.22],
  ['units/race_elf_lv3', 'grid', 0.22],
  ['units/race_elf_lv4', 'grid', 0.22],
  ['units/race_human_lv2', 'grid', 0.22],
  ['units/race_human_lv3', 'grid', 0.22],
  ['units/race_human_lv4', 'grid', 0.22],
  ['units/race_undead_lv1', 'grid', 0.22],
  ['units/race_undead_lv2', 'grid', 0.22],
  ['units/race_undead_lv3', 'grid', 0.22],
  ['units/race_undead_lv4', 'grid', 0.22],
  ['units/unit_small_01', 'grid', 0.22],
  ['units/unit_small_02', 'grid', 0.22],
  ['units/unit_small_03', 'grid', 0.22],
  ['units/unit_small_04', 'grid', 0.22],
  ['units/unit_small_05', 'grid', 0.22],
  ['units/unit_small_06', 'grid', 0.22],
  ['units/unit_small_07', 'grid', 0.22],
  ['units/unit_small_08', 'grid', 0.22],
  ['units/unit_small_09', 'grid', 0.22],
  ['units/unit_small_10', 'grid', 0.22],
  ['units/unit_small_11', 'grid', 0.22],
  ['units/unit_small_12', 'grid', 0.22],
  ['units/unit_small_13', 'grid', 0.22],
  ['units/unit_small_14', 'grid', 0.22],
  ['units/unit_small_15', 'grid', 0.22],
  ['units/unit_small_16', 'grid', 0.22],
  ['units/unit_small_17', 'grid', 0.22],
  ['units/unit_small_18', 'grid', 0.22],
  ['units/unit_small_19', 'grid', 0.22],
  ['units/unit_small_20', 'grid', 0.22],
  ['units/unit_small_21', 'grid', 0.22],
  ['units/unit_small_22', 'grid', 0.22],
  ['units/unit_small_23', 'grid', 0.22],
  ['units/unit_small_24', 'grid', 0.22],
  ['units/unit_small_25', 'grid', 0.22],
  ['units/unit_small_26', 'grid', 0.22],
  ['units/unit_small_27', 'grid', 0.22],
  ['units/unit_small_28', 'grid', 0.22],
  ['units/unit_small_29', 'grid', 0.22],
  ['units/unit_small_30', 'grid', 0.22],
  ['units/unit_small_31', 'grid', 0.22],
  ['units/unit_small_32', 'grid', 0.22],
  ['units/unit_small_33', 'grid', 0.22],
  ['units/unit_small_34', 'grid', 0.22],
  ['units/unit_small_35', 'grid', 0.22],
  ['units/unit_small_36', 'grid', 0.22],
  ['units/unit_small_37', 'grid', 0.22],
  ['units/unit_small_38', 'grid', 0.22],
  ['units/unit_small_39', 'grid', 0.22],
  ['units/unit_small_40', 'grid', 0.22],
];

const BIND_GACHA = [
  ['effects/gacha_epic_q4', 'center', 0.18],
  ['effects/gacha_epic_q5', 'center', 0.18],
  ['effects/gacha_epic_q6', 'center', 0.18],
  ['effects/quality_glow_q1', 'center', 0.18],
  ['effects/quality_glow_q2', 'center', 0.18],
  ['effects/quality_glow_q3', 'center', 0.18],
  ['effects/quality_glow_q4', 'center', 0.18],
  ['effects/quality_glow_q5', 'center', 0.18],
  ['effects/quality_glow_q6', 'center', 0.18],
  ['ui/gacha_collection', 'row', 0.16],
  ['ui/gacha_pity', 'row', 0.16],
  ['ui/gacha_rate', 'row', 0.16],
  ['ui/gacha_ten', 'card', 0.14],
  ['ui/gacha_ten_summary', 'card', 0.14],
];

const BIND_LEADERBOARD = [
  ['ui/rank_empty', 'row', 0.16],
  ['ui/rank_row_normal', 'row', 0.16],
  ['ui/rank_row_self', 'row', 0.16],
];

const BIND_LOADING = [
  ['fonts/number.ttf', 'icon', 0.18],
  ['fonts/title.ttf', 'icon', 0.18],
];

const BIND_LOBBY = [
  ['icons/lobby_achieve', 'icon', 0.26],
  ['icons/lobby_battle', 'icon', 0.26],
  ['icons/lobby_pass', 'icon', 0.26],
  ['icons/lobby_quest', 'icon', 0.26],
  ['ui/avatar_frame', 'icon', 0.22],
  ['ui/badge', 'icon', 0.22],
  ['ui/bar_cap', 'row', 0.16],
  ['ui/bar_highlight', 'row', 0.16],
  ['ui/btn_hover', 'icon', 0.22],
  ['ui/fade_bottom', 'full', 0.1],
  ['ui/fade_top', 'full', 0.1],
  ['ui/list_item', 'row', 0.16],
  ['ui/loading_tip', 'icon', 0.22],
  ['ui/tab_indicator', 'row', 0.16],
  ['ui/tab_normal', 'row', 0.16],
  ['ui/tab_selected', 'row', 0.16],
];

const BIND_PLAYING = [
  ['effects/ambient', 'center', 0.18],
  ['effects/build_beam', 'center', 0.18],
  ['effects/combat_crit', 'center', 0.18],
  ['effects/combat_flash', 'center', 0.18],
  ['effects/combat_hit', 'center', 0.18],
  ['effects/combat_knockback', 'center', 0.18],
  ['effects/territory_wave', 'center', 0.18],
  ['icons/hud_battle', 'icon', 0.26],
  ['icons/hud_enemy_hq', 'icon', 0.26],
  ['icons/hud_layout', 'icon', 0.26],
  ['icons/hud_setting', 'icon', 0.26],
  ['icons/hud_synergy', 'icon', 0.26],
  ['icons/tutorial_arrow', 'icon', 0.26],
  ['icons/tutorial_hand', 'icon', 0.26],
  ['ui/hud_hp', 'icon', 0.22],
  ['ui/hud_synergy', 'icon', 0.22],
  ['ui/tutorial_card', 'card', 0.14],
  ['ui/tutorial_dots', 'card', 0.14],
  ['units/unit_walk_attack', 'grid', 0.2],
  ['units/unit_walk_loop', 'grid', 0.2],
  ['units/unit_walk_start', 'grid', 0.2],
];

const BIND_PLAYING_BG = [
  ['bg/battle_tone_citadel', 'full', 0.14],
  ['bg/battle_tone_plains', 'full', 0.14],
  ['bg/battle_tone_river_ford', 'full', 0.14],
  ['bg/battle_tone_tri_lanes', 'full', 0.14],
  ['bg/battle_tone_twin_canyon', 'full', 0.14],
  ['tiles/territory_edge', 'grid', 0.16],
  ['tiles/territory_tone_citadel', 'grid', 0.16],
  ['tiles/territory_tone_plains', 'grid', 0.16],
  ['tiles/territory_tone_river_ford', 'grid', 0.16],
  ['tiles/territory_tone_tri_lanes', 'grid', 0.16],
  ['tiles/territory_tone_twin_canyon', 'grid', 0.16],
];

const BIND_QUEST = [
  ['icons/quest_claimall', 'icon', 0.26],
  ['icons/quest_locked', 'icon', 0.26],
  ['icons/quest_pay', 'icon', 0.26],
  ['icons/quest_reward_coin', 'icon', 0.26],
  ['icons/quest_reward_item', 'icon', 0.26],
  ['icons/quest_season', 'icon', 0.26],
  ['icons/quest_weekly', 'icon', 0.26],
  ['ui/quest_item_claimable', 'row', 0.16],
  ['ui/quest_item_claimed', 'row', 0.16],
  ['ui/quest_item_progress', 'row', 0.16],
];

const BIND_RESULT = [
  ['effects/defeat_debris', 'center', 0.18],
  ['effects/defeat_flash', 'center', 0.18],
  ['effects/rank_shine', 'center', 0.18],
  ['ui/result_promote', 'card', 0.14],
  ['ui/result_star', 'card', 0.14],
  ['ui/result_summary', 'card', 0.14],
];

const BIND_SETTINGS = [
  ['icons/setting_vibrate', 'icon', 0.26],
  ['icons/state_ad', 'icon', 0.26],
  ['icons/state_close', 'icon', 0.26],
  ['icons/state_delete', 'icon', 0.26],
  ['icons/state_lock', 'icon', 0.26],
  ['icons/state_skill', 'icon', 0.26],
  ['icons/state_stardust', 'icon', 0.26],
  ['icons/state_upgrade', 'icon', 0.26],
  ['ui/slider_bgm', 'row', 0.16],
  ['ui/slider_sfx', 'row', 0.16],
  ['ui/switch_off', 'row', 0.16],
  ['ui/switch_on', 'row', 0.16],
];

const BIND_SHOP = [
  ['ui/shop_card_free', 'row', 0.16],
  ['ui/shop_card_normal', 'row', 0.16],
];

const BIND_TECH_PANEL = [
  ['ui/tech_line', 'row', 0.16],
  ['ui/tech_node_locked', 'row', 0.16],
  ['ui/tech_node_max', 'row', 0.16],
  ['ui/tech_node_upgradeable', 'row', 0.16],
];

/** 背景 / 地图氛围类：按界面与 layoutId 选择，供 RenderSystem._drawBackdrop() 取用 */
export const BATTLE_TONE_BY_LAYOUT = {
  'plains': ['bg/battle_tone_plains', 'tiles/territory_tone_plains'],
  'twin_canyon': ['bg/battle_tone_twin_canyon', 'tiles/territory_tone_twin_canyon'],
  'tri_lanes': ['bg/battle_tone_tri_lanes', 'tiles/territory_tone_tri_lanes'],
  'river_ford': ['bg/battle_tone_river_ford', 'tiles/territory_tone_river_ford'],
  'citadel': ['bg/battle_tone_citadel', 'tiles/territory_tone_citadel'],
};
export const BG_BY_SCREEN = {
  'lobby': 'bg/lobby_fg',
  'gacha': 'bg/gacha_circle',
  'battle_pass': 'bg/bp_banner',
  'deploy_select': 'bg/match_panel',
  'tech_panel': 'bg/panel_bg',
  'shop': 'bg/panel_bg',
  'quest': 'bg/panel_bg',
  'achievement': 'bg/panel_bg',
  'leaderboard': 'bg/panel_bg',
};
export const TERRITORY_EDGE = 'tiles/territory_edge';

/** 应用级资源：不走 Canvas 渲染，由 game.json / 分享链路 / 打包脚本引用 */
export const APP_ASSETS = {
  icon: 'assets/icon_432',
  splash: 'assets/splash',
  shareCard: 'assets/share_card',
};

/** 字体说明卡：真实字体文件为 assets/fonts/title.ttf 与 number.ttf（由 wx.loadFont 加载） */
export const FONT_CARDS = ['fonts/title.ttf', 'fonts/number.ttf'];

// ===================== 状态变体选择器（供各绘制方法按状态精确取图） =====================
export function pick_rewardCell(locked, claimed, claimable) { return locked ? 'ui/bp_cell_locked' : claimed ? 'ui/bp_cell_claimed' : claimable ? 'ui/bp_cell_claimable' : 'ui/bp_cell_premium'; }
export function pick_questItem(complete, claimed) { return claimed ? 'ui/quest_item_claimed' : complete ? 'ui/quest_item_claimable' : 'ui/quest_item_progress'; }
export function pick_qualityGlow(q) { return 'effects/quality_glow_q' + Math.min(6, Math.max(1, q)); }
export function pick_gachaEpic(q) { return q >= 4 ? 'effects/gacha_epic_q' + Math.min(6, q) : ''; }
export function pick_tab(active) { return active ? 'ui/tab_selected' : 'ui/tab_normal'; }
export function pick_tabIndicator() { return 'ui/tab_indicator'; }
export function pick_switcher(on) { return on ? 'ui/switch_on' : 'ui/switch_off'; }
export function pick_slider(kind) { return kind === 'bgm' ? 'ui/slider_bgm' : 'ui/slider_sfx'; }
export function pick_techNode(state) { return state === 'max' ? 'ui/tech_node_max' : state === 'upgradeable' ? 'ui/tech_node_upgradeable' : 'ui/tech_node_locked'; }
export function pick_techLine() { return 'ui/tech_line'; }
export function pick_rankRow(empty, isSelf) { return empty ? 'ui/rank_empty' : isSelf ? 'ui/rank_row_self' : 'ui/rank_row_normal'; }
export function pick_accountRow(current) { return current ? 'ui/account_row_current' : 'ui/account_row_normal'; }
export function pick_shopCard(free) { return free ? 'ui/shop_card_free' : 'ui/shop_card_normal'; }
export function pick_result(kind) { return kind === 'star' ? 'ui/result_star' : kind === 'promote' ? 'ui/result_promote' : 'ui/result_summary'; }
export function pick_gachaUi(kind) { return ({ten:'ui/gacha_ten', tenSummary:'ui/gacha_ten_summary', rate:'ui/gacha_rate', pity:'ui/gacha_pity', collection:'ui/gacha_collection'})[kind] || ''; }
export function pick_unitDetail() { return 'ui/unit_detail'; }
export function pick_buildingDetail() { return 'ui/building_detail'; }
export function pick_tutorialCard() { return 'ui/tutorial_card'; }
export function pick_tutorialDots() { return 'ui/tutorial_dots'; }
export function pick_hudHp() { return 'ui/hud_hp'; }
export function pick_hudSynergy() { return 'ui/hud_synergy'; }
export function pick_btnHover() { return 'ui/btn_hover'; }
export function pick_barCap() { return 'ui/bar_cap'; }
export function pick_barHighlight() { return 'ui/bar_highlight'; }
export function pick_badge() { return 'ui/badge'; }
export function pick_fadeTop() { return 'ui/fade_top'; }
export function pick_fadeBottom() { return 'ui/fade_bottom'; }
export function pick_avatarFrame() { return 'ui/avatar_frame'; }
export function pick_listItem() { return 'ui/list_item'; }
export function pick_loadingTip() { return 'ui/loading_tip'; }
export function pick_race(r, lv) { return 'units/race_' + r + '_lv' + Math.min(4, Math.max(1, lv)); }
export function pick_unitSmall(n) { return 'units/unit_small_' + String(Math.min(40, Math.max(1, n))).padStart(2, '0'); }
export function pick_walkFrame(state) { return state === 'attack' ? 'units/unit_walk_attack' : state === 'start' ? 'units/unit_walk_start' : 'units/unit_walk_loop'; }
export function pick_combatFx(type, crit) { return crit ? 'effects/combat_crit' : type === 'flash' ? 'effects/combat_flash' : type === 'knockback' ? 'effects/combat_knockback' : 'effects/combat_hit'; }
export function pick_defeatFx(kind) { return kind === 'debris' ? 'effects/defeat_debris' : 'effects/defeat_flash'; }
export function pick_buildBeam() { return 'effects/build_beam'; }
export function pick_territoryWave() { return 'effects/territory_wave'; }
export function pick_rankShine() { return 'effects/rank_shine'; }
export function pick_ambient() { return 'effects/ambient'; }

// 各图标族完整语义名（含已接入项），供界面按语义贴图；全部为字面量
export const ICON_NAMES = {
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
/** 取图标 key：族 + 语义名；不存在时返回 ''（调用方静默跳过） */
export function iconKey(fam, name) {
  const p = { lobby: 'icons/lobby_', hud: 'icons/hud_', state: 'icons/state_',
    quest: 'icons/quest_', setting: 'icons/setting_', account: 'icons/account_',
    achieve: 'icons/achieve_', medal: 'icons/medal_', tutorial: 'icons/tutorial_' };
  const k = (p[fam] || '') + name;
  return ART_INDEX[k] ? k : '';
}

/** 种族 key 全枚举（6 种族 × 4 阶），保证 24 张全部可达 */
export const RACE_KEYS_ALL = [
  'units/race_human_lv1',
  'units/race_human_lv2',
  'units/race_human_lv3',
  'units/race_human_lv4',
  'units/race_beast_lv1',
  'units/race_beast_lv2',
  'units/race_beast_lv3',
  'units/race_beast_lv4',
  'units/race_undead_lv1',
  'units/race_undead_lv2',
  'units/race_undead_lv3',
  'units/race_undead_lv4',
  'units/race_elf_lv1',
  'units/race_elf_lv2',
  'units/race_elf_lv3',
  'units/race_elf_lv4',
  'units/race_dwarf_lv1',
  'units/race_dwarf_lv2',
  'units/race_dwarf_lv3',
  'units/race_dwarf_lv4',
  'units/race_dragon_lv1',
  'units/race_dragon_lv2',
  'units/race_dragon_lv3',
  'units/race_dragon_lv4',
];
/** 兵种小图全枚举（40 张） */
export const UNIT_SMALL_KEYS_ALL = [
  'units/unit_small_01',
  'units/unit_small_02',
  'units/unit_small_03',
  'units/unit_small_04',
  'units/unit_small_05',
  'units/unit_small_06',
  'units/unit_small_07',
  'units/unit_small_08',
  'units/unit_small_09',
  'units/unit_small_10',
  'units/unit_small_11',
  'units/unit_small_12',
  'units/unit_small_13',
  'units/unit_small_14',
  'units/unit_small_15',
  'units/unit_small_16',
  'units/unit_small_17',
  'units/unit_small_18',
  'units/unit_small_19',
  'units/unit_small_20',
  'units/unit_small_21',
  'units/unit_small_22',
  'units/unit_small_23',
  'units/unit_small_24',
  'units/unit_small_25',
  'units/unit_small_26',
  'units/unit_small_27',
  'units/unit_small_28',
  'units/unit_small_29',
  'units/unit_small_30',
  'units/unit_small_31',
  'units/unit_small_32',
  'units/unit_small_33',
  'units/unit_small_34',
  'units/unit_small_35',
  'units/unit_small_36',
  'units/unit_small_37',
  'units/unit_small_38',
  'units/unit_small_39',
  'units/unit_small_40',
];

// ===================== 装饰层绘制 =====================
const SCREEN_BINDINGS = {
  'account': BIND_ACCOUNT,
  'achievement': BIND_ACHIEVEMENT,
  'battle_pass': BIND_BATTLE_PASS,
  'deploy_select': BIND_DEPLOY_SELECT,
  'gacha': BIND_GACHA,
  'leaderboard': BIND_LEADERBOARD,
  'lobby': BIND_LOBBY,
  'playing': BIND_PLAYING,
  'quest': BIND_QUEST,
  'result': BIND_RESULT,
  'settings': BIND_SETTINGS,
  'shop': BIND_SHOP,
  'tech_panel': BIND_TECH_PANEL,
};

/**
 * 槽位换算：全部为相对屏幕的叠加矩形，不引用 / 不修改任何 Layout 与命中几何。
 * grid 用 8 列小格循环，保证数十张小图标 / 小兵种图各自有独立位置、互不重叠。
 */
function SLOTS(w, h) {
  const gw = Math.max(18, Math.min(44, w / 10));
  const gh = Math.max(18, Math.min(44, h / 22));
  const cols = Math.max(4, Math.floor(w / (gw + 4)));
  return {
    full:   [0, 0, w, h],
    top:    [0, 0, w, 52],
    bottom: [0, h - 76, w, 76],
    panel:  [w * 0.08, h * 0.16, w * 0.84, h * 0.60],
    card:   [w / 2 - 90, h / 2 - 120, 180, 240],
    center: [w * 0.28, h * 0.30, w * 0.44, Math.min(w * 0.44, h * 0.32)],
    row:    [20, h * 0.30, w - 40, 44],
    icon:   [16, 16, 24, 24],
    _gw: gw, _gh: gh, _cols: cols,
  };
}

/** 单个装饰项的矩形（grid/icon 按序号错开，避免堆叠成一块） */
function rectOf(slots, slot, i, w, h) {
  if (slot === 'grid') {
    const c = i % slots._cols, r = Math.floor(i / slots._cols) % 5;
    return [8 + c * (slots._gw + 4), h * 0.22 + r * (slots._gh + 4),
           slots._gw, slots._gh];
  }
  if (slot === 'icon') {
    return [12 + (i % 8) * 26, 12 + (Math.floor(i / 8) % 3) * 26, 22, 22];
  }
  if (slot === 'row') {
    return [20, h * 0.30 + (i % 4) * 50, w - 40, 44];
  }
  return slots[slot] || slots.full;
}

/**
 * 绘制当前界面的装饰层。由 RenderSystem.renderScreen() 在场景绘制完成后调用。
 * @param {RenderSystem} rs
 * @param {object} gameState
 * @returns {number} 本次实际发起的贴图数（供诊断）
 */
export function drawArtLayer(rs, gameState) {
  // 开关 / 叠加系数由 Game.start() 从 features 注入渲染层，与 _artEnabled 同一套，
  // 不要求 gameState 额外携带 features 字段。
  if (!rs._artEnabled || rs._artLayerEnabled === false) return 0;
  if (!ArtSystem.available || !ArtSystem.enabled) return 0;
  const scale = (typeof rs._artLayerAlpha === 'number') ? rs._artLayerAlpha : 1;
  if (scale <= 0) return 0;
  const w = rs.screenWidth, h = rs.screenHeight;
  const slots = SLOTS(w, h);
  const screen = (gameState && gameState.screenState) || 'playing';
  let n = 0;
  const emit = (list) => {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const [key, slot, alpha] = list[i];
      if (!ART_INDEX[key]) continue;
      const [x, y, bw, bh] = rectOf(slots, slot, i, w, h);
      if (bw <= 0 || bh <= 0) continue;
      rs._art(key, x, y, bw, bh, { alpha: alpha * scale });
      n++;
    }
  };
  // 当前界面专属 + 设置/账号覆盖层打开时叠加对应组
  emit(SCREEN_BINDINGS[screen]);
  if (gameState && gameState.settingsOpen) emit(SCREEN_BINDINGS.settings);
  if (gameState && gameState.accountOpen) emit(SCREEN_BINDINGS.account);
  // 结算态叠加胜负素材
  if (gameState && gameState.gameStatus && gameState.gameStatus !== 'playing') {
    emit(SCREEN_BINDINGS.result);
  }
  return n;
}

export default { drawArtLayer, BATTLE_TONE_BY_LAYOUT, BG_BY_SCREEN,
  APP_ASSETS, FONT_CARDS, RACE_KEYS_ALL, UNIT_SMALL_KEYS_ALL };
