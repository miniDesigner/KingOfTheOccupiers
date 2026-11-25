// 测试: 所有关闭按钮统一改用 icons/state_close 图片表达，几何与命中不变
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rs = readFileSync(ROOT + 'src/system/RenderSystem.js', 'utf-8');
const am = readFileSync(ROOT + 'src/system/ArtManifest.js', 'utf-8');
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✅ ' + msg); }
  else { failed++; console.log('  ❌ ' + msg); }
}

console.log('=== 测试1: 统一关闭按钮绘制方法 ===');
check(rs.includes('_drawCloseButton(rect, opts) {'), '存在统一关闭按钮方法');
check(rs.includes("this._artIcon(ART_PREFIXES.state, 'close', cx, cy,"),
  '图片优先使用 icons/state_close（透明底金色宝石 X）');
check(rs.includes("Math.min(rect.w, rect.h) * 0.92, 1)"),
  '图片以居中 92% 尺寸、不透明绘制');
check(rs.includes("ctx.save();") && rs.includes('if (this._artIcon(ART_PREFIXES.state'),
  '图片可用时直接返回，不叠加文字兜底');

console.log('=== 测试2: 五处关闭按钮全部改为图片通道 ===');
const calls = (rs.match(/this\._drawCloseButton\(/g) || []).length;
check(calls === 5, `五处调用全部接入（实际 ${calls}）`);
check(rs.includes("this._drawCloseButton({ x: panelX + panelW - 35, y: panelY + 5, w: 30, h: 30 },"),
  '招募兵种面板关闭按钮已替换，几何不变');
check(rs.includes("this._drawCloseButton({ x: panelX + panelW - 36, y: panelY + 10, w: 26, h: 26 },"),
  '羁绊详情关闭按钮已替换，几何不变');
check(rs.includes("this._drawCloseButton({ x: L.panelX + L.panelW - 36, y: L.panelY + 10, w: 26, h: 26 },"),
  '建筑详情关闭按钮已替换，几何不变');
check(rs.includes("this._drawCloseButton({ x: panelX + panelW - 35, y: panelY + 4, w: 28, h: 28 },"),
  '单位详情卡关闭按钮已替换，几何不变');
check(rs.includes('this._drawCloseButton(closeRect, { style: \'round\''),
  '统一模态壳关闭按钮已替换，closeRect 原样传入');

console.log('=== 测试3: 不再有手绘关闭符号（删除按钮除外）===');
check(!rs.includes("ctx.fillText('×', closeX"), '招募/单位详情不再手绘 ×');
check(!rs.includes("ctx.fillText('✕', panelX + panelW - 20"), '羁绊详情不再手绘 ✕');
check(!rs.includes("ctx.fillText('✕', L.panelX + L.panelW - 20"), '建筑详情不再手绘 ✕');
check(!rs.includes("ctx.fillText('✕', cx, cy + 1)"), '模态壳不再手绘 ✕');
check(rs.includes("ctx.fillText('✕', del.x + del.w / 2"), '账号删除按钮 ✕ 保留（非关闭语义）');
check(rs.includes('o.showClose !== false'), '无关闭语义模态仍不画假按钮');

console.log('=== 测试4: 资源已登记且图片可用 ===');
check(am.includes('"icons/state_close"') && am.includes('"path": "icons/state_close.png"'),
  'ArtManifest 已登记 icons/state_close 与贴图路径');
check(/import\s*\{[^}]*ART_INDEX[^}]*\}\s*from\s*'\.\/ArtManifest\.js'/.test(rs),
  'RenderSystem 已接入 ART_INDEX');

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
