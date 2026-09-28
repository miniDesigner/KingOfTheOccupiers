// 触觉震动跨平台适配测试（Phase 7 P0.3）
//
// 验证 AudioManager.vibrate 的真机 / 浏览器 / wx-shim 三环境分支：
//   - 真机（wx.connectSocket 存在）：strong→vibrateLong，medium/light→vibrateShort({type})
//   - 浏览器（无 wx）：navigator.vibrate(ms)，light=15 / medium=30 / strong=60
//   - wx-shim（有 wx 但无 connectSocket）：必须 fallback 到 navigator.vibrate（回归重点）
//   - 防抖：同级别短时间重复调用被节流
//   - muted / hapticEnabled=false 时静默
//
// 用法: node tests/test-haptic.mjs

const noop = () => {};

// 记录震动调用的探针
function makeProbe() {
  return { short: [], long: [], navMs: [] };
}

// Node 24 内置了只读 global.navigator，用 defineProperty 挂一个可变 mock
const navMock = { vibrate: noop };
Object.defineProperty(global, 'navigator', { value: navMock, configurable: true, writable: true });

// 全局环境切换
function setNativeWxEnv(probe) {
  global.wx = {
    connectSocket: noop, // 真机独有 API，wx-shim 不暴露
    vibrateShort(opts) { probe.short.push(opts || {}); },
    vibrateLong() { probe.long.push(true); },
  };
  navMock.vibrate = noop;
  return probe;
}

function setBrowserEnv(probe) {
  delete global.wx;
  navMock.vibrate = (ms) => probe.navMs.push(ms);
  return probe;
}

function setWxShimEnv(probe) {
  // wx-shim：有 wx 但无 connectSocket，vibrateShort/vibrateLong 是空实现
  global.wx = {
    vibrateShort() {},
    vibrateLong() {},
  };
  navMock.vibrate = (ms) => probe.navMs.push(ms);
  return probe;
}

// ========== 断言工具 ==========
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ========== 加载单例 ==========
// 默认浏览器环境（无 wx）import，单例 platform 字段会固定，但 vibrate 用运行时判据，不受影响
setBrowserEnv({ short: [], long: [], navMs: [] });
const audioManager = (await import('../src/system/AudioManager.js')).default;

function resetHaptic() {
  audioManager.hapticEnabled = true;
  audioManager.muted = false;
  audioManager._lastVibrateTime = { light: 0, medium: 0, strong: 0 };
}

// ========== 1. 真机分支 ==========
console.log('\n=== 真机分支（wx.connectSocket） ===');
{
  const probe = setNativeWxEnv(makeProbe());
  resetHaptic();

  audioManager.vibrate('strong');
  audioManager.vibrate('medium');
  audioManager.vibrate('light');

  eq(probe.long.length, 1, 'strong → vibrateLong 1 次');
  eq(probe.short.length, 2, 'medium + light → vibrateShort 2 次');
  eq(probe.short[0].type, 'medium', 'medium → vibrateShort({type:"medium"})');
  eq(probe.short[1].type, 'light', 'light → vibrateShort({type:"light"})');
  eq(probe.navMs.length, 0, '真机不触发 navigator.vibrate');
}

// ========== 2. 浏览器分支 ==========
console.log('\n=== 浏览器分支（无 wx） ===');
{
  const probe = setBrowserEnv(makeProbe());
  resetHaptic();

  audioManager.vibrate('light');
  audioManager.vibrate('medium');
  audioManager.vibrate('strong');

  eq(probe.navMs.length, 3, '浏览器触发 navigator.vibrate 3 次');
  eq(probe.navMs[0], 15, 'light → 15ms');
  eq(probe.navMs[1], 30, 'medium → 30ms');
  eq(probe.navMs[2], 60, 'strong → 60ms');
  eq(probe.short.length + probe.long.length, 0, '浏览器不触发 wx 震动');
}

// ========== 3. wx-shim 环境 fallback（回归重点） ==========
console.log('\n=== wx-shim 环境（有 wx 无 connectSocket） ===');
{
  const probe = setWxShimEnv(makeProbe());
  resetHaptic();

  audioManager.vibrate('strong');
  audioManager.vibrate('light');

  eq(probe.navMs.length, 2, 'wx-shim 环境 fallback 到 navigator.vibrate');
  eq(probe.navMs[0], 60, 'wx-shim strong → 60ms（未被空实现吞掉）');
  eq(probe.navMs[1], 15, 'wx-shim light → 15ms');
}

// ========== 4. 防抖 ==========
console.log('\n=== 防抖 ===');
{
  const probe = setBrowserEnv(makeProbe());
  resetHaptic();

  audioManager.vibrate('light');
  audioManager.vibrate('light'); // 立即重复 → 被节流
  eq(probe.navMs.length, 1, '同级别短时间重复调用被节流（仅 1 次）');

  // 手动把上次时间拨回，模拟间隔已过 → 应再次触发
  resetHaptic();
  audioManager._lastVibrateTime.light = Date.now() - 9999;
  audioManager.vibrate('light');
  eq(probe.navMs.length, 2, '间隔已过 → 再次触发');

  // 不同级别互不影响（light 与 strong 各自独立防抖）
  resetHaptic();
  audioManager.vibrate('light');
  audioManager.vibrate('strong');
  eq(probe.navMs.length, 4, '不同级别各自独立，均触发');
}

// ========== 5. 静音 / 开关 ==========
console.log('\n=== 静音 / 开关 ===');
{
  const probe = setBrowserEnv(makeProbe());
  resetHaptic();

  audioManager.muted = true;
  audioManager.vibrate('light');
  eq(probe.navMs.length, 0, 'muted 时不震动');

  audioManager.muted = false;
  audioManager.hapticEnabled = false;
  audioManager.vibrate('light');
  eq(probe.navMs.length, 0, 'hapticEnabled=false 时不震动');

  audioManager.hapticEnabled = true;
  audioManager.vibrate('light');
  eq(probe.navMs.length, 1, '恢复开关后正常震动');
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
