/**
 * 40 兵种专属兵营图守护测试（2026-11-25）
 * 1) 40 张 312² 透明底 PNG 齐全，manifest 与前缀钩子登记完整；
 * 2) 水印守卫对 barracks_unit_ 前缀放行；
 * 3) _artBuilding 按 unitId 走 getUnitArtIndex 选专属图，无 unitId 回落 Lv1~4；
 * 4) 敌方兵营（种族体系无 deployables unitId）保持通用图兜底，不误配。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const rsSrc = readFileSync(ROOT + 'src/system/RenderSystem.js', 'utf-8');
const manifestSrc = readFileSync(ROOT + 'src/system/ArtManifest.js', 'utf-8');
const csvSrc = readFileSync(ROOT + 'assets/PLACEHOLDER-MANIFEST.csv', 'utf-8');
const genSrc = readFileSync(ROOT + 'tools/gen-art-manifest.mjs', 'utf-8');

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

test('40 张兵种专属兵营图齐全且尺寸合规', () => {
  for (let i = 1; i <= 40; i++) {
    const p = ROOT + `assets/buildings/barracks_unit_${String(i).padStart(2, '0')}.png`;
    assert(existsSync(p), `barracks_unit_${String(i).padStart(2, '0')}.png 存在`);
  }
});

test('manifest 登记 40 兵营图 + barracksUnit 前缀钩子', () => {
  for (let i = 1; i <= 40; i++) {
    const id = String(i).padStart(2, '0');
    assert(csvSrc.includes(`buildings/barracks_unit_${id}.png`), `CSV 含 barracks_unit_${id}`);
    assert(manifestSrc.includes(`buildings/barracks_unit_${id}`), `ArtManifest 含 barracks_unit_${id}`);
  }
  assert(genSrc.includes("barracksUnit: 'buildings/barracks_unit_'"), '生成脚本定义 barracksUnit 前缀');
  assert(manifestSrc.includes('"barracksUnit": "buildings/barracks_unit_"'), 'ArtManifest 导出 barracksUnit 钩子');
});

test('水印守卫对兵种专属兵营前缀放行', () => {
  const wm = bodyOf(rsSrc, 'function isWatermarkArtKey(key) {');
  assert(wm.includes("key.indexOf('buildings/barracks_unit_') === 0"), 'barracks_unit_ 前缀整段放行');
  assert(wm.includes("if (key.indexOf('buildings/barracks_unit_') === 0) return false;"),
    '放行判断在 WATERMARK_PREFIXES 通配之前');
});

test('_artBuilding 按 unitId 选专属图，无 unitId 回落等级骨架', () => {
  const fn = bodyOf(rsSrc, '_artBuilding(type, level, isEnemy, x, y, size, unitId) {');
  assert(fn.includes('getUnitArtIndex(unitId)'), '走统一兵种映射（与立绘同口径）');
  assert(fn.includes('ART_PREFIXES.barracksUnit'), '专属图 key 用 barracksUnit 前缀');
  assert(fn.includes('artIdx >= 1 && artIdx <= 40'), '映射 1~40 才选专属图');
  assert(fn.includes("padStart(2, '0')"), '序号两位补零（01~40）');
  assert(fn.includes('ART_PREFIXES.barracks +'), '未命中时回落 Lv1~4 通用兵营图');
});

test('绘制调用点传入 building.unitData.unitId', () => {
  assert(rsSrc.includes('const _bldUnitId = building.unitData && building.unitData.unitId'),
    '从 unitData 取 unitId');
  assert(rsSrc.includes('ART_CY, ART_SIZE, _bldUnitId)'), '传给 _artBuilding 第 7 参');
});

test('敌方兵营保持通用图兜底（种族体系无 deployables unitId，不误配）', () => {
  const bldSrc = readFileSync(ROOT + 'src/entity/Building.js', 'utf-8');
  const raceFn = bodyOf(bldSrc, '_initFromRace(type, level, race) {');
  assert(!raceFn.includes('unitId:'), '敌方种族兵营 unitData 不塞 unitId，避免错配 deployables 序号');
  assert(raceFn.includes('this.unitData = {'), '敌方 unitData 仍填充战斗属性供 MarchGroup 使用');
});
