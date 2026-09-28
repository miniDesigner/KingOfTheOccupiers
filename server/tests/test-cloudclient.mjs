// 临时 CloudClient 功能测试（跑完即弃）
import { CloudClient } from '../../src/net/CloudClient.js';

CloudClient.enable('http://127.0.0.1:8891');
const uid = 'u_client_' + Date.now().toString(36);

let ok = 0, fail = 0;
const check = (cond, name) => { if (cond) { ok++; console.log('  ✓ ' + name); } else { fail++; console.error('  ✗ ' + name); } };

const login = await CloudClient.login(uid, '客户端测试');
check(login.uid === uid, 'login uid 一致');
check(!!CloudClient.getToken(), 'token 已保存');

const empty = await CloudClient.getProfile();
check(empty.version === 0 && empty.data === null, '首次拉档为空 (version=0)');

const data = { nickname: '客户端测试', gold: 500, diamond: 2000, stardust: 200, trophies: 0, pvpWins: 0, pvpLosses: 0, totalGames: 0, totalWins: 0, highestTrophies: 0, claimedTierRewards: [] };
const put = await CloudClient.putProfile(0, data, 1234);
check(put.version === 1, '推档成功 (version=1)');

const got = await CloudClient.getProfile();
check(got.data.gold === 500, '拉回金币=500');

const settle = await CloudClient.settle('win', 'ai', { difficulty: 'normal' });
check(settle.result === 'win' && settle.rewards.trophyDelta > 0, '权威结算 奖杯增加 ' + settle.rewards.trophyDelta);
check(settle.profile.gold > 500, '权威结算 金币增加 → ' + settle.profile.gold);
check(settle.profile.totalGames === 1 && settle.profile.pvpWins === 1, '权威结算 战绩计数正确');

console.log('\n结果：通过 ' + ok + '，失败 ' + fail);
process.exit(fail > 0 ? 1 : 0);
