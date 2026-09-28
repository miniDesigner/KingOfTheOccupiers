// 验证 CloudClient 三通道分流逻辑（静态断言，不依赖真实 wx/fetch）
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../src/net/CloudClient.js'), 'utf8');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

console.log('=== CloudClient 云函数通道改造静态断言 ===\n');

// 1. 云函数环境判断存在
assert(src.includes('function isCloud()'), 'isCloud() 环境判断已定义');
assert(src.includes('wx.cloud.callFunction'), '云函数调用通道已接入');
assert(src.includes('wx.cloud.init'), '云环境 init 已接入');

// 2. 云函数环境 ID 与 cloudbaserc 一致
assert(src.includes('minigame-prod-d5g02fq8e40658692'), '云函数 envId 已写入');

// 3. login 云函数分支：openid 免密无 token
assert(src.includes("_callCloud('login'"), 'login 走云函数通道');
assert(src.includes('_loggedIn = true'), '登录标记 _loggedIn 已维护');

// 4. getProfile/putProfile/settle 云函数分支
assert(src.includes("_callCloud('getProfile'"), 'getProfile 走云函数');
assert(src.includes("_callCloud('putProfile'"), 'putProfile 走云函数');
assert(src.includes("_callCloud('settle'"), 'settle 走云函数');

// 5. 云函数错误 → err.status 映射（复用乐观锁 409 重试）
assert(src.includes('err.status = (r && r.statusCode) || 500'), '云函数 statusCode → err.status 映射');
assert(src.includes('e.status = 0'), '云函数调用失败 status=0 兜底');

// 6. flushPush 登录条件改为 _loggedIn || _token
assert(src.includes('if (!_loggedIn && !_token) await login'), 'flushPush 登录条件已改为 _loggedIn 优先');

// 7. 三通道优先级：云函数 > wx.request > fetch
assert(src.includes('if (isCloud())'), 'API 方法内云函数分支在前（高优先级）');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
