/**
 * PlatformTracker 埋点 SDK 契约测试（对齐平台 v2.1 文档 / 官方 SDK v3.1 能力）
 *
 * 验证：正式配置已启用 / v2.1 新口径 app_launch+login / 玩家ID绑定前后时序 /
 *       register 幂等 / 事件名校验 / 顶层 amount 与 extra 敏感字段过滤 /
 *       批量阈值 / 切后台 flush / trackAd / trackEconomy / 公告拉取
 * 真机网络由 mock wx.request 模拟，不访问平台。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const requests = [];
const storage = {};
let hideCallback = null;

function _ok(res) {
  if (typeof res.success === 'function') res.success({ statusCode: 200, data: { ok: true, received: 1 } });
  if (typeof res.complete === 'function') res.complete();
}

globalThis.wx = {
  request(opts) {
    requests.push(opts);
    if (/announcements/.test(opts.url)) {
      if (typeof opts.success === 'function') {
        opts.success({ statusCode: 200, data: { ok: true, announcements: [{ id: 7, title: '测试公告' }] } });
      }
    } else _ok(opts);
  },
  getStorageSync(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : ''; },
  setStorageSync(key, value) { storage[key] = value; },
  onHide(cb) { hideCallback = cb; },
};

// 必须在 mock wx 之后再导入，让模块启动时绑定 onHide 钩子
const tracker = (await import('../src/net/PlatformTracker.js')).default;

test('正式配置：appKey 已替换、开关已启用、端点与心跳能力齐备', () => {
  const s = tracker.getState();
  assert.equal(s.enabled, true);
  assert.equal(s.appKey, 'app_kotc_613f11');
  assert.match(s.reportUrl, /\/api\/report$/);
  assert.equal(typeof tracker.startHeartbeat, 'function');
  assert.equal(typeof tracker.trackEconomy, 'function');
  assert.equal(typeof tracker.getAnnouncements, 'function');
  // 后续用例需要可控状态：先关掉
  tracker.configure({ enabled: false });
  assert.equal(tracker.getState().enabled, false);
});

test('关闭时不发事件也不写 register 标记', () => {
  assert.equal(tracker.track('app_launch'), false);
  assert.equal(tracker.registerOnce(), false);
  assert.equal(Object.prototype.hasOwnProperty.call(storage, 'tk_platform_registered'), false);
  assert.equal(requests.length, 0);
});

test('启用后入口事件先入队，玩家ID未就绪时不发送', () => {
  tracker.configure({ enabled: true, batchSize: 100, debug: false });
  assert.equal(tracker.track('app_launch', { scene: 'boot' }), true);
  assert.equal(tracker.track('login', { scene: 'boot' }), true);
  assert.equal(tracker.track('level_pass', { level: 5 }), true);
  assert.equal(tracker.getState().queueLength, 3);
  assert.equal(requests.length, 0);
});

test('绑定稳定 uid 后一次性 flush，请求体符合平台协议且为新口径', () => {
  assert.equal(tracker.setPlayerId('acc_test_uid_001'), true);
  assert.equal(requests.length, 1);
  assert.equal(tracker.getState().queueLength, 0);

  const req = requests[requests.length - 1];
  assert.equal(req.method, 'POST');
  assert.match(req.url, /\/api\/report$/);
  assert.equal(req.header['Content-Type'], 'application/json');

  const body = JSON.parse(req.data);
  assert.equal(body.appKey, 'app_kotc_613f11');
  assert.ok(body.events.length >= 3);
  for (const ev of body.events) {
    assert.equal(ev.player_id, 'acc_test_uid_001');
    assert.equal(ev.platform, 'wechat');
    assert.equal(typeof ev.ts, 'number');
    assert.equal(ev.client_version, '1.0.0');
  }
  assert.equal(body.events.some(e => e.event === 'app_launch' && e.scene === 'boot'), true);
  assert.equal(body.events.some(e => e.event === 'login'), true);
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

test('顶层 amount/currency/reason 透传，extra 敏感键过滤', () => {
  tracker.track('pay_success', {
    amount: 600, currency: 'CNY', reason: 'iap',
    channel: 'wx', server_id: 's1', session_id: 'sess_1',
    extra: {
      amount: 600, product: '礼包A', ok: true,
      phone: '13800000000', password: 'secret', openid: 'o_xxx', nested: { a: 1 },
    },
  });
  tracker.flush();
  const body = JSON.parse(requests[requests.length - 1].data);
  const ev = body.events.find(e => e.event === 'pay_success');
  assert.ok(ev);
  assert.equal(ev.amount, 600);
  assert.equal(ev.currency, 'CNY');
  assert.equal(ev.reason, 'iap');
  assert.equal(ev.server_id, 's1');
  assert.deepEqual(ev.extra, { amount: 600, product: '礼包A', ok: true });
});

test('trackAd / trackEconomy 映射到标准事件名与顶层字段', () => {
  tracker.trackAd('reward', { scene: 'banner' });
  tracker.trackEconomy('currency', -100, 'level_up_cost');
  tracker.flush();
  const body = JSON.parse(requests[requests.length - 1].data);
  assert.equal(body.events.some(e => e.event === 'ad_reward'), true);
  const eco = body.events.find(e => e.event === 'currency_change');
  assert.ok(eco);
  assert.equal(eco.amount, -100);
  assert.equal(eco.reason, 'level_up_cost');
});

test('满 batchSize 条自动上报，切后台立即 flush', () => {
  tracker.configure({ batchSize: 2 });
  const before = requests.length;
  tracker.track('battle_tick');
  assert.equal(requests.length, before);
  tracker.track('battle_tick');
  assert.equal(requests.length, before + 1);

  tracker.track('battle_end');
  assert.equal(requests.length, before + 1);
  assert.equal(typeof hideCallback, 'function');
  hideCallback();
  assert.equal(requests.length, before + 2);
  const body = JSON.parse(requests[requests.length - 1].data);
  assert.equal(body.events[0].event, 'battle_end');
});

test('心跳仅在真微信+启用时启动；当前 mock 无 __tkBrowser 故应可启动', () => {
  const before = requests.length;
  assert.equal(tracker.startHeartbeat(), true);
  assert.equal(tracker.getState().heartbeatActive, true);
  // 立即 beat 一条 heartbeat，入队后 flush 发出
  tracker.flush();
  const body = JSON.parse(requests[requests.length - 1].data);
  assert.equal(body.events.some(e => e.event === 'heartbeat'), true);
  assert.equal(tracker.stopHeartbeat(), true);
  assert.equal(tracker.getState().heartbeatActive, false);
  assert.ok(requests.length > before);
});

test('getAnnouncements 用 appKey 鉴权并返回平台公告', async () => {
  const anns = await tracker.getAnnouncements();
  assert.equal(anns.length, 1);
  assert.equal(anns[0].id, 7);
  const annReq = requests[requests.length - 1];
  assert.match(annReq.url, /announcements\/public$/);
  assert.equal(JSON.parse(annReq.data).appKey, 'app_kotc_613f11');
});

test('关闭后停止上报', () => {
  tracker.configure({ enabled: false });
  assert.equal(tracker.track('app_launch'), false);
  assert.equal(tracker.getState().enabled, false);
});
