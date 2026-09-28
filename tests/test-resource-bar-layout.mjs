/**
 * test-resource-bar-layout.mjs — 验证 Layout.resourceBarLayout()
 *
 * PM 2026-09-07：货币上限提到 99999999 后，资源栏必须能完整显示 8 位数字
 *
 * 设计：
 *  - 5 字符以内：原 cellW=56 + 11px 字号（不变）
 *  - 6~8 字符：升 cellW=76 + 降字号 9px
 *  - clusterW 钳制到 safeRight - clusterX 之内，防止撞右上角设置按钮
 *
 * 安全区：右上角设置按钮 [w-95, w-55] → safeRight = w-103 留 8px 间隙
 */
import { resourceBarLayout } from '../src/system/Layout.js';

// ============ 单元测试 ============
let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('  ✗', msg); failures++; }
  else console.log('  ✓', msg);
}

console.log('[1] ≤5 字符 → 窄格 + 11px 字号');
{
  const r = resourceBarLayout([0, 100, 99999, 0], 360);
  assert(r.maxChars === 5, `maxChars=5 (got ${r.maxChars})`);
  assert(r.wide === false, 'wide=false');
  assert(r.cellW === 56, `cellW=56 (got ${r.cellW})`);
  assert(r.fontSize === 11, `fontSize=11 (got ${r.fontSize})`);
  assert(r.clusterW === 56 * 2 + 4 * 2, `clusterW=120 (got ${r.clusterW})`);
}

console.log('\n[2] 6 字符 → 宽格 + 9px 字号');
{
  const r = resourceBarLayout([100000, 0, 0, 0], 360);
  assert(r.maxChars === 6, `maxChars=6 (got ${r.maxChars})`);
  assert(r.wide === true, 'wide=true');
  assert(r.cellW === 76, `cellW=76 (got ${r.cellW})`);
  assert(r.fontSize === 9, `fontSize=9 (got ${r.fontSize})`);
  assert(r.clusterW === 76 * 2 + 4 * 2, `clusterW=160 (got ${r.clusterW})`);
}

console.log('\n[3] 8 字符（货币上限 99999999）→ 宽格 + 9px 字号，clusterW 不撞设置按钮');
{
  const r = resourceBarLayout([99999999, 99999999, 99999999, 0], 360);
  assert(r.maxChars === 8, `maxChars=8 (got ${r.maxChars})`);
  assert(r.wide === true, 'wide=true');
  assert(r.cellW === 76, `cellW=76 (got ${r.cellW})`);
  assert(r.fontSize === 9, `fontSize=9 (got ${r.fontSize})`);
  assert(r.clusterW === 160, `clusterW=160 (got ${r.clusterW})`);
  // 右边界：clusterX(8) + clusterW(160) = 168 < safeRight(360-103=257) → 安全
  assert(8 + r.clusterW <= 257, 'clusterW 不撞设置按钮');
}

console.log('\n[4] iPhone5 320 屏 → 8 字符不撞屏');
{
  const r = resourceBarLayout([99999999, 99999999, 99999999, 99999], 320);
  assert(r.cellW === 76, `cellW=76 (got ${r.cellW})`);
  assert(r.clusterW === 160, `clusterW=160 (got ${r.clusterW})`);
  assert(8 + r.clusterW <= 320 - 103, 'iPhone5 不撞设置按钮'); // 8+160=168 < 217 ✓
  // 1 字（百万级）→ 回到窄格
  const r1 = resourceBarLayout([1, 0, 0, 0], 320);
  assert(r1.cellW === 56, `1 字符 cellW=56 (got ${r1.cellW})`);
}

console.log('\n[5] 极窄屏 (240) → wide 形态 clusterW 钳制');
{
  // 模拟 _drawResourceBar 实际调用：传 safeRight = screenW - 103
  const r = resourceBarLayout([99999999, 99999999, 99999999, 0], 240, 240 - 103);
  // safeRight=137 → maxClusterW = max(120, 137-8=129) = 129 → clusterW 被钳到 129
  assert(r.clusterW === 129, `clusterW 被钳到 129 (got ${r.clusterW})`);
  assert(r.cellW === 76, 'cellW 仍=76 但 clusterW 受限');
}

console.log('\n[6] 安全冗余：极端宽屏 (1024)');
{
  const r = resourceBarLayout([0, 0, 0, 0], 1024);
  assert(r.wide === false, '全 0 时 wide=false');
  assert(r.clusterW === 120, 'clusterW=120 不拉伸');
}

console.log('\n[7] 自适应：trophies 8 位但其他都不长');
{
  const r = resourceBarLayout([0, 0, 0, 99999999], 360);
  assert(r.wide === true, 'wide=true（任一超长即触发）');
  assert(r.maxChars === 8, 'maxChars=8');
}

console.log('\n[8] 残缺参数：values 缺位/null → 安全降级');
{
  const r1 = resourceBarLayout([null, undefined, '', 100], 360);
  assert(r1.maxChars === 3, 'null/undefined/"" → 当 0 (got ' + r1.maxChars + ')');
  const r2 = resourceBarLayout(null, 360);
  assert(r2.maxChars === 0, 'null values → safe default');
  assert(r2.clusterW === 120, '降级到窄格');
}

// ============ 集成测试：文本宽度断言（用 measureText mock）============
console.log('\n[9] 8 字符在 wide 形态 9px 字号下，cell 内可放下');
{
  // 模拟 9px sans-serif 测量：每个数字约 5.5px；8 字 ≈ 44px
  // cellW=76 - 图标 16 = 60 可用；44 < 60 ✅
  const r = resourceBarLayout([99999999], 360);
  // 假设每字 6.5px（粗估）：8 字 = 52px，可放
  const estWidth = String(99999999).length * 6.5;
  const availInCell = r.cellW - 16;
  assert(estWidth < availInCell, `数字估算宽 ${estWidth} < cell 内可用 ${availInCell}`);
}

// ============ 结果 ============
console.log(`\n${failures === 0 ? '✅' : '❌'} ${failures} 个失败`);
process.exit(failures === 0 ? 0 : 1);
