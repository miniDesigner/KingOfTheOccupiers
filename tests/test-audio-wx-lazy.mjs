/**
 * AudioManager 懒创建测试（微信环境）
 *
 * 验证 Phase 7 P5 修复：
 *   - 微信平台 register() 不预创建音频实例（避免 IDE set src readFile 红字）
 *   - 浏览器平台 register() 保留预创建行为
 *   - play() 时按需懒创建，缺失/失败静默吞掉
 */

import { strict as assert } from 'assert';

// ===== 准备 wx-shim：必须先注入 wx 再 import AudioManager（platform 单次构造判定） =====
let createdInstances = 0;

globalThis.wx = {
  createInnerAudioContext() {
    createdInstances++;
    return {
      _src: '',
      get src() { return this._src; },
      set src(v) { this._src = v; },
      volume: 1.0,
      loop: false,
      _errHandler: null,
      play() {},
      stop() {},
      onError(fn) { this._errHandler = fn; },
      _triggerError(e) { if (this._errHandler) this._errHandler(e); },
    };
  },
  getSystemInfoSync() { return { SDKVersion: '3.0.0' }; },
};

const audioManager = (await import('../src/system/AudioManager.js')).default;
audioManager.platform = 'wechat'; // 显式锁定（防注入顺序时差）
assert.equal(audioManager.platform, 'wechat');

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push(`✓ ${name}`);
  } catch (e) {
    results.push(`✗ ${name}: ${e.message}`);
  }
}

function resetSfx() {
  audioManager.sounds = {};
  audioManager.throttleMap = {};
  audioManager._lastPlayTime = {};
  audioManager.enabledMap = {};
  audioManager.bgm = null;
  audioManager.bgmUrl = '';
}

function resetWxCount() { createdInstances = 0; }

// =============================================
// 1. 微信环境：register() 不预创建音频实例
// =============================================
test('wechat: register() does NOT pre-create pool', () => {
  resetWxCount();
  resetSfx();
  audioManager.init({ sfx: { click: { url: 'sfx/click.mp3', volume: 1.0, throttle: 0 } } });
  assert.equal(createdInstances, 0, 'register 后不应创建任何 InnerAudioContext');
  assert.equal(audioManager.sounds.click.pool.length, 0, 'pool 初始为空');
  assert.equal(audioManager.sounds.click.lazyCreated, true, 'lazyCreated 标志为 true');
});

// =============================================
// 2. 微信环境：play() 触发懒创建
// =============================================
test('wechat: play() triggers lazy creation', () => {
  resetWxCount();
  resetSfx();
  audioManager.init({ sfx: { click: { url: 'sfx/click.mp3', volume: 1.0, throttle: 0 } } });
  audioManager.wxAudioReady = true; // 模拟音频资源就绪，验证懒创建
  audioManager.sfxEnabled = true; audioManager.muted = false;
  audioManager.play('click');
  assert.equal(createdInstances, 1, 'play 后应创建 1 个 InnerAudioContext');
  assert.equal(audioManager.sounds.click.pool.length, 1, 'pool 现在有 1 个实例');
});

// =============================================
// 3. 微信环境：创建失败静默吞掉（不抛错）
// =============================================
test('wechat: play() silently swallows creation failure', () => {
  const origCreate = globalThis.wx.createInnerAudioContext;
  globalThis.wx.createInnerAudioContext = () => { throw new Error('not allowed'); };
  try {
    resetSfx();
    audioManager.init({ sfx: { click: { url: 'sfx/click.mp3' } } });
    audioManager.wxAudioReady = true; // 模拟音频资源就绪，验证创建失败静默
    audioManager.sfxEnabled = true; audioManager.muted = false;
    audioManager.play('click');
    assert.equal(audioManager.sounds.click.pool.length, 0, '创建失败时 pool 不增长');
  } finally {
    globalThis.wx.createInnerAudioContext = origCreate;
  }
});

// =============================================
// 4. 微信环境：onError 静默注册
// =============================================
test('wechat: onError registered silently (no throw on err)', () => {
  resetSfx();
  audioManager.init({ sfx: { click: { url: 'sfx/click.mp3' } } });
  audioManager.wxAudioReady = true; // 模拟音频资源就绪，验证 onError 静默
  audioManager.sfxEnabled = true; audioManager.muted = false;
  audioManager.play('click');
  const ctx = audioManager.sounds.click.pool[0];
  assert.ok(ctx, 'ctx 已创建');
  assert.doesNotThrow(() => ctx._triggerError({ errMsg: 'failed' }), 'onError 应静默吞掉');
});

// =============================================
// 5. 节流：throttle 不影响懒创建行为（第二次 play 命中节流）
// =============================================
test('wechat: throttle skips play (no lazy create on hit)', () => {
  resetWxCount();
  resetSfx();
  audioManager.init({ sfx: { hit: { url: 'sfx/hit.mp3', throttle: 1.0 } } });
  audioManager.wxAudioReady = true; // 模拟音频资源就绪，验证节流
  audioManager.sfxEnabled = true; audioManager.muted = false;
  audioManager.play('hit');
  const creates1 = createdInstances;
  audioManager.play('hit'); // 立即，节流命中
  assert.equal(createdInstances, creates1, '节流命中就不创建');
});

// =============================================
// 6. 浏览器环境：register() 仍预创建池（保留原行为）
// =============================================
test('browser: register() still pre-creates pool (using audio mock)', () => {
  // 模拟 browser Audio：每次 new 一个
  const origWx = globalThis.wx;
  const origAudio = globalThis.Audio;
  delete globalThis.wx;
  let audioCreates = 0;
  globalThis.Audio = function () { audioCreates++; this.src = ''; this.preload = ''; this.play = () => {}; };

  try {
    resetSfx();
    audioManager.platform = 'browser';
    audioManager.init({ sfx: { click: { url: 'sfx/click.mp3' } } });
    const createsAfterInit = audioCreates;
    assert.ok(createsAfterInit >= 1, '浏览器 register 至少预创建 1 个 Audio');
    assert.equal(audioManager.sounds.click.lazyCreated, false, '浏览器 lazyCreated=false');
    assert.equal(audioManager.sounds.click.pool.length, createsAfterInit, 'pool 长度 == 预创建数');
  } finally {
    globalThis.wx = origWx;
    globalThis.Audio = origAudio;
    audioManager.platform = 'wechat';
  }
});

// =============================================
// 7. 浏览器环境：play() 不触发额外创建
// =============================================
test('browser: play() uses pre-existing pool (no extra create)', () => {
  const origWx = globalThis.wx;
  const origAudio = globalThis.Audio;
  delete globalThis.wx;
  let audioCreates = 0;
  globalThis.Audio = function () { audioCreates++; this.src = ''; this.preload = ''; this.play = () => {}; };

  try {
    resetSfx();
    audioManager.platform = 'browser';
    audioManager.init({ sfx: { click: { url: 'sfx/click.mp3' } } });
    const createsAfterInit = audioCreates;
    audioManager.sfxEnabled = true; audioManager.muted = false;
    audioManager.play('click');
    audioManager.play('click');
    audioManager.play('click');
    // 浏览器 play() 不再 new Audio
    assert.equal(audioCreates, createsAfterInit, '浏览器 play() 不再额外 new Audio');
  } finally {
    globalThis.wx = origWx;
    globalThis.Audio = origAudio;
    audioManager.platform = 'wechat';
  }
});

// =============================================
// 8. 多次 play：不同 sfx 各 lazy 一次 + 同 sfx 复用池（微信）
// =============================================
test('wechat: different sfx lazy each once, same sfx reuses', () => {
  resetWxCount();
  resetSfx();
  audioManager.init({
    sfx: {
      click: { url: 'sfx/click.mp3' },
      tick: { url: 'sfx/tick.mp3' },
    },
  });
  audioManager.wxAudioReady = true; // 模拟音频资源就绪，验证各 sfx 懒创建
  audioManager.sfxEnabled = true; audioManager.muted = false;
  audioManager.play('click');
  audioManager.play('tick');
  audioManager.play('click'); // 复用 click 池
  audioManager.play('tick');  // 复用 tick 池
  assert.equal(createdInstances, 2, 'click + tick 各 lazy 一次 = 2');
});

// =============================================
// 9. 真实游戏流程：mute 开启时 play 跳过、不创建（防御）
// =============================================
test('wechat: muted=true skips play (no lazy create)', () => {
  resetWxCount();
  resetSfx();
  audioManager.init({ sfx: { click: { url: 'sfx/click.mp3' } } });
  audioManager.sfxEnabled = true; audioManager.muted = true;
  audioManager.play('click');
  assert.equal(createdInstances, 0, 'muted 时 play 不创建');
});

// =============================================
// 10. 微信环境：音频资源未就绪（wxAudioReady=false）时 play 静默跳过
// =============================================
test('wechat: wxAudioReady=false skips play silently (no set src)', () => {
  resetWxCount();
  resetSfx();
  audioManager.init({ sfx: { click: { url: 'sfx/click.mp3' } } });
  // init 后默认 wxAudioReady=false（WX_AUDIO_ASSETS_READY=false）
  assert.equal(audioManager.wxAudioReady, false, 'init 后默认未就绪');
  audioManager.sfxEnabled = true; audioManager.muted = false;
  audioManager.play('click');
  assert.equal(createdInstances, 0, '未就绪时 play 不创建实例（避免缺失文件 set src 报错）');
  assert.equal(audioManager.sounds.click.pool.length, 0, 'pool 保持空');
});

console.log('\n' + results.join('\n'));
const failed = results.filter((r) => r.startsWith('✗'));
if (failed.length > 0) {
  console.error(`\n❌ ${failed.length} 个断言失败`);
  process.exit(1);
}
console.log(`\n✅ ${results.length} 个断言全部通过`);
process.exit(0);
