// 数据接入自动化测试（闭环）
// 依据：项目资产《数据接入自动化测试方案-供AI执行》v1.0（2026-11-27）
// 运行：node tools/data-ingest-selftest.mjs
// ⚠️ 本脚本会向正式租户（tenant 5）写入探针事件，测试结束需将 PROBE 转交平台清理：
//    DELETE FROM events_raw WHERE session_id LIKE 'autotest_%' OR player_id LIKE 'autotest_%';
// 文件名不带 test- 前缀，避免被全量回归 tests/test-*.mjs 捕获后每次都污染生产租户。
import { writeFileSync } from 'node:fs';

const BASE = 'https://mini-management-d0flwzdnf201202a-1463521202.ap-shanghai.app.tcloudbase.com';
const AK = 'app_kotc_613f11';
const PROBE = 'autotest_' + Date.now();
const ts = () => Date.now();
const results = [];

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { raw: await res.text() };
  }
  return { status: res.status, data };
}

function check(id, name, cond, detail) {
  const pass = !!cond;
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name}${detail ? ' :: ' + detail : ''}`);
}

console.log('BASE  =', BASE);
console.log('PROBE =', PROBE);
console.log('---');

// TC-01 鉴权有效性
let r = await post('/api/verify', { action: 'ping', appKey: AK });
check('TC-01', 'ping 有效 appKey', r.data.ok === true && r.data.tenantId === 5,
  `status=${r.status} ${JSON.stringify(r.data)}`);

// TC-01b 错误 key 应被拒绝（方案 §3 补充说明）
r = await post('/api/verify', { action: 'ping', appKey: 'bad_key' });
check('TC-01b', 'ping 错误 key 拒绝', r.data.ok === false || r.status === 401,
  `status=${r.status} ${JSON.stringify(r.data)}`);

// TC-02 单事件上报
r = await post('/api/report', {
  appKey: AK,
  events: [
    { event: 'app_launch', player_id: PROBE, session_id: PROBE, client_version: '1.0.0', platform: 'wechat', ts: ts() },
  ],
});
check('TC-02', '单事件上报', r.data.ok === true && r.data.received === 1, JSON.stringify(r.data));

// TC-03 批量混合上报（验证字段一致性，回归历史 bug）
r = await post('/api/report', {
  appKey: AK,
  events: [
    { event: 'app_launch', player_id: PROBE, session_id: PROBE, channel: 'autotest', ts: ts() },
    { event: 'register', player_id: PROBE, session_id: PROBE, server_id: 's1', ts: ts() },
    { event: 'pay_success', player_id: PROBE, session_id: PROBE, amount: 600, currency: 'CNY', ts: ts() },
  ],
});
check('TC-03', '批量混合上报', r.data.ok === true && r.data.received === 3, JSON.stringify(r.data));

// TC-04 探针入库闭环（核心，轻量重试等待入库可见）
let findData = null;
let matches = 0;
for (let i = 0; i < 5; i++) {
  r = await post('/api/verify', { action: 'find', appKey: AK, session_id: PROBE, minutes: 10 });
  findData = r.data;
  matches = r.data.matches || 0;
  if (matches >= 4) break;
  await new Promise((resolve) => setTimeout(resolve, 300));
}
const hitEvents = [...new Set((findData && findData.events || []).map((e) => e.event))];
const cover = ['app_launch', 'register', 'pay_success'].every((e) => hitEvents.includes(e));
check('TC-04', '探针入库闭环', matches >= 4 && cover,
  `matches=${matches} hitEvents=${JSON.stringify(hitEvents)}`);

// TC-05 汇总核对
r = await post('/api/verify', { action: 'summary', appKey: AK, minutes: 10, limit: 5 });
check('TC-05', '汇总核对 ingestOk', r.data.ingestOk === true,
  `total=${r.data.total} byEvent=${JSON.stringify(r.data.byEvent)}`);

// TC-06 非法事件名过滤
r = await post('/api/report', {
  appKey: AK,
  events: [{ event: 'Bad-Name!', player_id: PROBE, ts: ts() }],
});
check('TC-06', '非法事件名过滤', r.data.ok === true && r.data.received === 0, JSON.stringify(r.data));

// TC-07 租户隔离
r = await post('/api/verify', { action: 'find', appKey: 'demo_key_replace_me', session_id: PROBE, minutes: 10 });
check('TC-07', '租户隔离', (r.data.matches || 0) === 0, JSON.stringify(r.data));

const passCount = results.filter((x) => x.pass).length;
const verdict = passCount === results.length ? 'PASS' : 'FAIL';
console.log('---');
console.log(`RESULT ${verdict}  ${passCount}/${results.length}`);
console.log('PROBE =', PROBE, '（转交平台清理）');

writeFileSync('.workbuddy/data-ingest-test-result.json', JSON.stringify({
  probe: PROBE,
  ranAt: new Date().toISOString(),
  verdict,
  passCount,
  total: results.length,
  results,
  findSnapshot: findData,
}, null, 2));
console.log('结果已写入 .workbuddy/data-ingest-test-result.json');
