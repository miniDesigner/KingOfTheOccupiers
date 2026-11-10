/**
 * 生成 src/system/ArtManifest.js —— 美术占位图的「代码侧唯一映射源」
 *
 * 输入: assets/PLACEHOLDER-MANIFEST.csv（由 gen-placeholders.py 生成）
 * 输出: src/system/ArtManifest.js（ES module，微信小游戏 / 浏览器预览 / Node 测试通用）
 *
 * 用法: node tools/gen-art-manifest.mjs
 *
 * 说明: 占位图后续被正式素材「同名覆盖」时，本文件无需改动；
 *       只有新增/删除素材、或调整素材尺寸时重新运行本脚本。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets/PLACEHOLDER-MANIFEST.csv');
const OUT = join(ROOT, 'src/system/ArtManifest.js');

/** 极简 CSV 解析（支持双引号包裹与转义引号） */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1);
}

const rows = parseCsv(readFileSync(SRC, 'utf-8').replace(/^\uFEFF/, ''));
const head = rows[0];
const col = (name) => {
  const i = head.indexOf(name);
  if (i < 0) throw new Error(`CSV 缺少列: ${name}（实际列: ${head.join(' | ')}）`);
  return i;
};
const C = Object.fromEntries([
  '编号', '目标路径（相对 assets/）', '品类', '状态 / 名称', '尺寸（@3x 出图）',
  '格式', '九宫格', '品质/段位色', '数据来源', '备注',
].map(n => [n, col(n)]));

const entries = rows.slice(1).map(r => {
  const code = r[C['编号']];
  const path = r[C['目标路径（相对 assets/）']];
  const label = r[C['状态 / 名称']];
  const size = r[C['尺寸（@3x 出图）']];
  const fmt = r[C['格式']];
  const is9 = r[C['九宫格']] === '是';
  const quality = r[C['品质/段位色']] || '';
  const m = size.match(/^(\d+)×(\d+)$/);
  if (!m) throw new Error(`${code} 尺寸非法: ${size}`);
  const w = Number(m[1]), h = Number(m[2]);
  // key = 去掉 .9.png / .png / .jpg 后的路径，全局唯一
  const key = path.replace(/\.9\.png$/, '').replace(/\.(png|jpg)$/, '');
  const cat = path.split('/')[0];
  // 九宫格保护边距与 gen-placeholders.py 渲染时画的线保持一致
  const slice = is9 ? Math.max(3, Math.floor(Math.min(w, h) * 0.16)) : 0;
  return { key, code, path, label, cat, w, h, fmt, is9, slice, quality,
           source: r[C['数据来源']], note: r[C['备注']] };
});

// 唯一性自检
const keys = entries.map(e => e.key);
if (new Set(keys).size !== keys.length) throw new Error('生成后出现重复 key');

// 按编号分组
const byCode = {};
for (const e of entries) (byCode[e.code] ||= []).push(e.key);

// 品类 → 渲染钩子（全量编号都有一条绑定，便于审查「代码是否覆盖到」）
const HOOK_BY_CAT = {
  assets: 'app', bg: 'backdrop', buildings: 'building', effects: 'effect',
  fonts: 'font', icons: 'icon', tiles: 'tile', ui: 'widget', units: 'unit',
};
const bindings = {};
for (const code of Object.keys(byCode).sort()) {
  const cat = entries.find(e => e.code === code).cat;
  bindings[code] = { hook: HOOK_BY_CAT[cat] || 'ui', keys: byCode[code] };
}

// 界面背景表：覆盖 _renderScreenInner 的全部 screenState 分支
const SCREEN_BG = {
  lobby: 'bg/lobby_bg',
  deploy_select: 'bg/subpage_bg',
  tech_panel: 'bg/subpage_bg',
  shop: 'bg/subpage_bg',
  quest: 'bg/subpage_bg',
  achievement: 'bg/subpage_bg',
  battle_pass: 'bg/subpage_bg',
  gacha: 'bg/gacha_bg',
  leaderboard: 'bg/subpage_bg',
  playing: 'bg/battle_bg',
};
const RESULT_BG = { won: 'bg/result_win', lost: 'bg/result_lose' };
const LOADING_BG = 'bg/loading_art';
const LOADING_LOGO = 'bg/loading_logo';

// 具体元素钩子：RenderSystem 通过这些语义名取「完整 key」
const ART_HOOKS = {
  backButton: 'ui/back_normal',
  backPressed: 'ui/back_pressed',
  panel: 'ui/panel',
  card: 'ui/card',
  cardEmpty: 'ui/card_empty',
  slotEmpty: 'ui/slot_empty',
  slotDrag: 'ui/slot_drag',
  btnNormal: 'ui/btn_normal',
  btnPressed: 'ui/btn_pressed',
  btnDisabled: 'ui/btn_disabled',
  btnSelected: 'ui/btn_selected',
  barTrack: 'ui/bar_track',
  barFill: 'ui/bar_fill',
  hudTop: 'ui/hud_top',
  hudBottom: 'ui/hud_bottom',
  toastInfo: 'ui/toast_info',
  toastSuccess: 'ui/toast_success',
  toastWarn: 'ui/toast_warn',
  hexBright: 'tiles/hex_bright',
  hexDark: 'tiles/hex_dark',
  hexFlippable: 'tiles/hex_flippable',
  hexEmpty: 'tiles/hex_empty',
  mountain: 'tiles/mountain',
  river: 'tiles/river',
  tower: 'buildings/tower',
  mine: 'buildings/mine',
  hqAlly: 'buildings/hq_ally',
  hqEnemy: 'buildings/hq_enemy',
  ruin: 'buildings/ruin',
  medalGold: 'icons/medal_gold',
  settingNotify: 'icons/setting_notify',
  achieveStamp: 'effects/achieve_stamp',
  firework: 'effects/firework',
  tutorialHalo: 'effects/tutorial_halo',
};

// 前缀型钩子：按序号 / 状态名拼出完整 key（调用方必须精确构造，不做模糊匹配）
const ART_PREFIXES = {
  quality: 'ui/quality_q',
  barracks: 'buildings/barracks_',
  unit: 'units/unit_',
  unitSmall: 'units/unit_small_',
  race: 'units/race_',
  currency: 'icons/currency_',
  rank: 'icons/rank_',
  qualityMark: 'icons/quality_mark_q',
  nav: 'icons/nav_',
  lobby: 'icons/lobby_',
  hud: 'icons/hud_',
  state: 'icons/state_',
  quest: 'icons/quest_',
  achieve: 'icons/achieve_',
  setting: 'icons/setting_',
  account: 'icons/account_',
  techBranch: 'icons/tech_branch_',
  synergy: 'icons/synergy_',
  buildingUp: 'icons/building_up_',
  shopCat: 'icons/shop_cat_',
  medal: 'icons/medal_',
};

const banner = `/**
 * 自动生成，请勿手改。由 tools/gen-art-manifest.mjs 从
 * assets/PLACEHOLDER-MANIFEST.csv 生成，共 ${entries.length} 条。
 *
 * 全量贴图映射：ART_ENTRIES / ART_INDEX / ART_BY_CODE / ART_BINDINGS
 * 界面背景：SCREEN_BG / RESULT_BG / LOADING_BG
 * 元素钩子：ART_HOOKS
 *
 * 占位图被正式素材「同名覆盖」时本文件无需改动。
 */
`;

const out = banner
  + `export const ART_COUNT = ${entries.length};\n\n`
  + `export const ART_ENTRIES = ${JSON.stringify(entries, null, 2)};\n\n`
  + `export const ART_INDEX = Object.fromEntries(ART_ENTRIES.map(e => [e.key, e]));\n\n`
  + `export const ART_BY_CODE = ${JSON.stringify(byCode, null, 2)};\n\n`
  + `export const ART_BINDINGS = ${JSON.stringify(bindings, null, 2)};\n\n`
  + `export const SCREEN_BG = ${JSON.stringify(SCREEN_BG, null, 2)};\n\n`
  + `export const RESULT_BG = ${JSON.stringify(RESULT_BG, null, 2)};\n\n`
  + `export const LOADING_BG = ${JSON.stringify(LOADING_BG)};\n\n`
  + `export const LOADING_LOGO = ${JSON.stringify(LOADING_LOGO)};\n\n`
  + `export const ART_HOOKS = ${JSON.stringify(ART_HOOKS, null, 2)};\n\n`
  + `export const ART_PREFIXES = ${JSON.stringify(ART_PREFIXES, null, 2)};\n`;

writeFileSync(OUT, out, 'utf-8');
console.log(`[gen-art-manifest] ${entries.length} 条 → ${OUT}`);
console.log(`  编号: ${Object.keys(byCode).length} | 界面背景: ${Object.keys(SCREEN_BG).length} | 元素钩子: ${Object.keys(ART_HOOKS).length}`);
const missingBg = Object.values(SCREEN_BG).concat(Object.values(RESULT_BG), LOADING_BG, LOADING_LOGO)
  .filter(k => !keys.includes(k));
const missingHook = Object.values(ART_HOOKS).filter(k => !keys.includes(k));
const missingPrefix = Object.values(ART_PREFIXES).filter(p => !keys.some(k => k.startsWith(p)));
console.log(`  背景表缺失 key: ${missingBg.length ? missingBg.join(', ') : '无'}`);
console.log(`  元素钩子缺失 key: ${missingHook.length ? missingHook.join(', ') : '无'}`);
console.log(`  前缀型钩子无匹配: ${missingPrefix.length ? missingPrefix.join(', ') : '无'}`);
if (missingBg.length || missingHook.length || missingPrefix.length) process.exitCode = 1;
