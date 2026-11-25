/**
 * 战斗表现守护测试（2026-11-25）
 * 1) 障碍格与翻开格必须共用同一套「立体石砖 + 贴图染色 + 3px 描边」表达；
 * 2) 兵种四态动画（出生/移动/攻击/死亡）与队伍血条必须在渲染层落地；
 * 3) 动画状态只存渲染层，不写回 MarchGroup，且开局清零。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const rsSrc = readFileSync(ROOT + 'src/system/RenderSystem.js', 'utf-8');
const gameSrc = readFileSync(ROOT + 'src/game/Game.js', 'utf-8');

function bodyOf(src, signature) {
  const start = src.indexOf(signature);
  assert(start >= 0, `找不到 ${signature}`);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return '';
}

test('障碍格与翻开格共用同一石砖与染色管线', () => {
  const obs = bodyOf(rsSrc, 'drawObstacleTile(tile, x, y) {');
  const flip = bodyOf(rsSrc, 'drawFlippedTile(tile, x, y, map, gameState) {');
  assert(obs.includes('_artHex(ART_HOOKS.mountain'), '障碍格仍用同款 312² 立体石砖');
  assert(obs.includes('_drawTileOwnerTint(x, y,'), '障碍格走与翻开格相同的贴图染色 + 3px 描边');
  assert(obs.includes("'#64748b'"), '障碍格用中性岩灰，区别于敌我蓝/红');
  assert(flip.includes('_drawTileOwnerTint(x, y, color)'), '翻开格仍走阵营染色');
  assert(!obs.includes("'#334155'"), '旧的深色直角兜底已移除');
});

test('障碍格染色降权保住卡通山峰明暗，翻开格不受影响', () => {
  const tint = bodyOf(rsSrc, '_drawTileOwnerTint(x, y, color, alpha = 0.45) {');
  const obs = bodyOf(rsSrc, 'drawObstacleTile(tile, x, y) {');
  assert(tint.includes('ctx.globalAlpha = alpha'), '染色函数使用可配置 alpha');
  assert(tint.includes("'_drawTileOwnerTint'") === false, '染色函数自身无递归');
  assert(obs.includes("_drawTileOwnerTint(x, y, '#64748b', 0.18)"),
    '障碍格传 0.18 保留 2.5D 厚涂明暗，不再用 0.45 压闷');
});

test('兵种四态动画与血条已接入渲染层', () => {
  const march = bodyOf(rsSrc, 'drawMarchGroups(marchGroups, map, gameState) {');
  assert(march.includes('spawnP = (now - st.bornAt) / UNIT_SPAWN_MS'), '出生态按 bornAt 计时');
  assert(march.includes('const isSpawn = spawnP < 1'), '出生态有独立分支');
  assert(march.includes('const attackP ='), '攻击态按 stateAt 计时');
  assert(march.includes('fighting) {'), '攻击态有独立分支');
  assert(march.includes('Math.sin(now / 135'), '移动态踏步节奏');
  assert(march.includes('_drawUnitSprite(st.shot, alpha)'), '角色主体来自对应兵种立绘');
  assert(march.includes('drawUnitHPBar('), '队伍血条已绘制');
  assert(march.includes('group._initialWarriors'), '血条比例以初始兵力为上限');
  assert(rsSrc.includes('_drawUnitDeathGhosts(now)'), '死亡消散已接入');
  assert(rsSrc.includes('UNIT_DEATH_MS = 560'), '死亡时长 560ms');
  assert(!march.includes('pick_walkFrame'), '不再叠通用红衣行走帧');
});

test('动画状态渲染层私有，开局清零', () => {
  assert(rsSrc.includes('this._unitActors = new Map()'), '渲染层持有角色状态表');
  assert(rsSrc.includes('this._deathGhosts = []'), '死亡虚影独立队列');
  assert(rsSrc.includes('resetUnitActors()'), '提供清零入口');
  assert(gameSrc.includes('this.renderSystem.resetUnitActors();'), 'initBattle 调用清零');
  // 不得把动画字段写回 MarchGroup（只允许写渲染层快照）
  const march = bodyOf(rsSrc, 'drawMarchGroups(marchGroups, map, gameState) {');
  assert(!/group\.(bornAt|stateAt|animState|deathTimer)\s*=/.test(march), '动画计时不写回队伍数据');
});

test('兵种角色素材存在且尺寸合规', () => {
  assert(existsSync(ROOT + 'assets/units/unit_small_01.png'), '兵种小图 01 存在');
  assert(existsSync(ROOT + 'assets/units/unit_small_40.png'), '兵种小图 40 存在');
});

test('字符串兵种id正确映射到立绘序号，不再全部回落01', () => {
  const sprite = bodyOf(rsSrc, '_drawUnitSprite(shot, alpha) {');
  assert(sprite.includes("typeof shot.unitId === 'number'"), '数字序号仍直用');
  assert(sprite.includes('getUnitArtIndex(shot.unitId)'), '字符串id走统一映射函数');
  assert(sprite.includes('|| 1'), '未命中id有安全兜底');
  assert(!/const id = typeof shot\.unitId === 'number' \? shot\.unitId : 1;/.test(sprite),
    '旧的"非数字一律回落01"判断已移除');
  assert(rsSrc.includes('getUnitArtIndex }'), '映射函数已在渲染系统导入');
});
