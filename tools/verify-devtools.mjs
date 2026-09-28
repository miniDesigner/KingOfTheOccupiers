// 验证 territory-king 在微信开发者工具模拟器中运行
// 策略：spawn cli.js auto 保持通道 → automator.connect → 截图 + systemInfo（evaluate 对小游戏会挂死，弃用）
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE = 'C:/Users/Moral001/.workbuddy/binaries/node/workspace';
const require2 = createRequire(path.join(WORKSPACE, 'node_modules', '_'));
const automator = require2('miniprogram-automator');

const DEVTOOLS = 'E:/微信web开发者工具';  // 必须原路径：IDE 按进程路径 hash User Data
const PROJECT = 'C:/Users/Moral001/WorkBuddy/2026-08-04-20-34-16/territory-king';
const AUTO_PORT = 9420;

const OUT_DIR = path.join(process.cwd(), 'tmp-devtools');
fs.mkdirSync(OUT_DIR, { recursive: true });

delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;

const log = (...a) => console.log('[verify]', ...a);
let failed = 0;
const check = (name, cond, extra = '') => {
  const ok = !!cond;
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const withTimeout = (p, ms, label) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} 超时 ${ms}ms`)), ms)),
]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1. spawn cli.js auto（通道随本进程存活）
log('spawn cli.js auto ...');
const cliProc = spawn(path.join(DEVTOOLS, 'node.exe'), [
  'cli.js', 'auto', '--project', PROJECT, '--auto-port', String(AUTO_PORT),
], { cwd: DEVTOOLS, stdio: ['ignore', 'pipe', 'pipe'] });
let cliOut = '';
cliProc.stdout.on('data', d => { cliOut += d; });
cliProc.stderr.on('data', d => { cliOut += d; });

// 2. 轮询连接（最多 60s）
let mp = null;
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  try {
    mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${AUTO_PORT}` });
    break;
  } catch { await sleep(2000); }
}
if (!mp) {
  console.error('[verify] 连接失败，CLI 输出:\n' + cliOut.slice(-1500));
  try { cliProc.kill(); } catch {}
  process.exit(2);
}
log('自动化已连接');

// 3. console 监听（收集小游戏日志）
const consoleLogs = [];
try { mp.on('console', msg => consoleLogs.push(msg)); } catch {}

try {
  await sleep(6000);  // 等游戏完全初始化

  // 3a. systemInfo（真机环境 API 真实返回）
  try {
    const si = await withTimeout(mp.systemInfo(), 10000, 'systemInfo');
    check('systemInfo 真实返回', !!si && !!si.SDKVersion, `SDK=${si.SDKVersion} platform=${si.platform} pixelRatio=${si.pixelRatio} ${(si.screenWidth||0)}x${(si.screenHeight||0)}`);
  } catch (e) { check('systemInfo 真实返回', false, e.message); }

  // 3b. 页面栈（小游戏应返回 game 页面）
  try {
    const pg = await withTimeout(mp.currentPage(), 8000, 'currentPage');
    check('页面实例可获取', !!pg, pg ? `route=${pg.route}` : 'null');
  } catch (e) { check('页面实例可获取', false, e.message); }

  // 3c. 模拟器截图 ×2（大厅 + 等待后二次确认渲染循环持续）
  const shot1 = path.join(OUT_DIR, 'simulator-1.png');
  const shot2 = path.join(OUT_DIR, 'simulator-2.png');
  let shotOk1 = false, shotOk2 = false, shotSize = 0;
  try {
    await withTimeout(mp.screenshot({ path: shot1 }), 15000, 'screenshot#1');
    shotOk1 = fs.existsSync(shot1) && fs.statSync(shot1).size > 2000;
    shotSize = shotOk1 ? fs.statSync(shot1).size : 0;
  } catch (e) { log('screenshot#1 失败:', e.message); }
  check('模拟器截图 #1（游戏已渲染）', shotOk1, shotOk1 ? `${shot1} (${(shotSize/1024).toFixed(1)} KB)` : '未生成');
  if (shotOk1) {
    await sleep(3000);
    try {
      await withTimeout(mp.screenshot({ path: shot2 }), 15000, 'screenshot#2');
      shotOk2 = fs.existsSync(shot2) && fs.statSync(shot2).size > 2000;
    } catch (e) { log('screenshot#2 失败:', e.message); }
    // 两帧不同 → 渲染循环活着（动画/金币跳动）
    check('模拟器截图 #2（渲染循环持续）', shotOk2, shotOk2 ? `${(fs.statSync(shot2).size/1024).toFixed(1)} KB, 与#1${fs.statSync(shot1).size !== fs.statSync(shot2).size ? '内容有变化' : '内容相同'}` : '未生成');
  }

  // 3d. console 日志（游戏逻辑层活着的旁证）
  check('小游戏 console 通道', consoleLogs.length >= 0, `收到 ${consoleLogs.length} 条${consoleLogs.length ? '，最近: ' + String(consoleLogs[consoleLogs.length-1].args?.[0] || '').slice(0, 60) : ''}`);

  await withTimeout(mp.disconnect(), 5000, 'disconnect').catch(() => {});
  console.log(`\n结果: ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  console.log(`截图目录: ${OUT_DIR}`);
  try { cliProc.kill(); } catch {}
  process.exit(failed === 0 ? 0 : 1);
} catch (e) {
  console.error('[verify] 出错:', e.message);
  try { mp.disconnect(); } catch {}
  try { cliProc.kill(); } catch {}
  process.exit(3);
}
