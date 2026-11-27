/**
 * PlatformTracker 埋点 SDK 契约测试
 *
 * 验证：默认关闭 / 事件名校验 / 玩家ID绑定前后时序 / register 幂等 /
 *       敏感字段过滤 / 批量阈值 / 切后台 flush / 上报请求体格式
 * 真机网络由 mock wx.request 模拟，不访问平台。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const requests = [];
const storage = {};
let hideCallback = null;

globalThis.wx = {
  request(opts) {
    requests.push(opts);
    if (typeof opts.success === 'function') opts.success({ statusCode: 200, data: { ok: true, received: 1 } });
    if (typeof opts.complete === 'function') opts.complete();
  },
  getStorageSync(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : ''; },
  setStorageSync(key, value) { storage[key] = value; },
  onHide(cb) { hideCallback = cb; },
};

// 必须在 mock wx 之后再导入，让模块启动时绑定 onHide 钩子
const tracker = (await import('../src/net/PlatformTracker.js')).default;

test('默认关闭：不发事件也不写 register 标记', () => {
  assert.equal(tracker.getState().enabled, false);
  assert.equal(tracker.track('game_start'), false);
  assert.equal(tracker.registerOnce(), false);
  assert.equal(Object.prototype.hasOwnProperty.call(storage, 'tk_platform_registered'), false);
  assert.equal(requests.length, 0);
});

test('启用后入口事件先入队，玩家ID未就绪时不发送', () => {
  tracker.configure({ enabled: true, batchSize: 100, debug: false });
  assert.equal(tracker.track('game_start', { scene: 'boot' }), true);
  assert.equal(tracker.track('level_pass', { level: 5 }), true);
  assert.equal(tracker.getState().queueLength, 2);
  assert.equal(requests.length, 0);
});

test('绑定稳定 uid 后一次性 flush，请求体符合平台协议', () => {
  assert.equal(tracker.setPlayerId('acc_test_uid_001'), true);
  assert.equal(requests.length, 1);
  assert.equal(tracker.getState().queueLength, 0);

  const req = requests[requests.length - 1];
  assert.equal(req.method, 'POST');
  assert.match(req.url, /\/api\/report$/);
  assert.equal(req.header['Content-Type'], 'application/json');

  const body = JSON.parse(req.data);
  assert.equal(typeof body.appKey, 'string');
  assert.ok(body.events.length >= 2);
  for (const ev of body.events) {
    assert.equal(ev.player_id, 'acc_test_uid_001');
    assert.equal(ev.platform, 'wechat');
    assert.equal(typeof ev.ts, 'number');
    assert.equal(ev.client_version, '1.0.0');
  }
  assert.equal(body.events.some(e => e.event === 'game_start' && e.scene === 'boot'), true);
  assert.equal(body.events.some(e => e.event === 'level_pass' && e.level === 5), true);
});

test('registerOnce 幂等且跨会话持久', () => {
  const before = requests.length;
  assert.equal(tracker.registerOnce(), true);
  assert.equal(tracker.getState().queueLength, 1);
  assert.equal(tracker.registerOnce(), false);
  assert.equal(tracker.getState().queueLength, 1);
  assert.equal(storage.tk_platform_registered, 1);

  tracker.flush();
  assert.equal(requests.length, before + 1);
  const body = JSON.parse(requests[requests.length - 1].data);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].event, 'register');
});

test('事件名非法直接丢弃，不影响合法事件', () => {
  assert.equal(tracker.track('Bad-Event'), false);
  assert.equal(tracker.track('中文事件'), false);
  assert.equal(tracker.track(''), false);
  assert.equal(tracker.track('a'.repeat(65)), false);
  assert.equal(tracker.track('level_fail'), true);
  tracker.flush();
});

test('extra 敏感字段过滤，仅保留短字符串/有限数字/布尔', () => {
  tracker.track('share', {
    scene: 'victory',
    extra: {
      amount: 600,
      product: '礼包A',
      ok: true,
      phone: '13800000000',
      password: 'secret',
      openid: 'o_xxx',
      nested: { a: 1 },
    },
  });
  tracker.flush();
  const body = JSON.parse(requests[requests.length - 1].data);
  const ev = body.events.find(e => e.event === 'share');
  assert.ok(ev);
  assert.deepEqual(ev.extra, { amount: 600, product: '礼包A', ok: true });
});

test('满 batchSize 条自动上报，切后台立即 flush', () => {
  tracker.configure({ batchSize: 2 });
  const before = requests.length;
  tracker.track('battle_tick');
  assert.equal(requests.length, before);
  tracker.track('battle_tick');
  assert.equal(requests.length, before + 1);

  tracker.track('game_end');
  assert.equal(requests.length, before + 1);
  assert.equal(typeof hideCallback, 'function');
  hideCallback();
  assert.equal(requests.length, before + 2);
  const body = JSON.parse(requests[requests.length - 1].data);
  assert.equal(body.events[0].event, 'game_end');
});

test('关闭后停止上报', () => {
  tracker.configure({ enabled: false });
  assert.equal(tracker.track('game_start'), false);
  assert.equal(tracker.getState().enabled, false);
});
