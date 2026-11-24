// 测试: 羁绊/建筑强化 7 张重绘图标已覆盖到正式 assets/icons/
// 校验 PNG 签名与 132×132 尺寸（与 PLACEHOLDER-MANIFEST.csv 声明一致）
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = [
  'synergy_melee', 'synergy_ranged', 'synergy_defense', 'synergy_magic',
  'building_up_barracks', 'building_up_mine', 'building_up_tower',
];

for (const name of FILES) {
  const file = `${ROOT}assets/icons/${name}.png`;
  assert(existsSync(file), `${name}.png 已覆盖到 assets/icons/`);
  const buf = readFileSync(file);
  assert.equal(buf.subarray(1, 4).toString('ascii'), 'PNG', `${name}.png 是有效 PNG`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  assert.equal(width, 132, `${name}.png 宽 132`);
  assert.equal(height, 132, `${name}.png 高 132`);
  assert(buf.length > 8000, `${name}.png 是正式重绘文件（非小占位），${buf.length} bytes`);
}
console.log(`✅ ${FILES.length} 张羁绊/建筑强化图标已覆盖且尺寸为 132×132`);
