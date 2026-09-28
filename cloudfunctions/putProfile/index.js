/**
 * 云函数 putProfile — 推送存档（乐观锁）
 *
 * 入参：{ version, data, power }
 * 出参：{ ok, version }；409 冲突时 { ok:false, conflict:true, version:serverVersion }
 */
const cloud = require('wx-server-sdk');
const dao = require('./shared/db.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no openid' };

  const { version, data, power } = event || {};
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'invalid profile data', statusCode: 400 };
  }

  const account = await dao.getAccountByOpenid(OPENID);
  if (!account) return { ok: false, error: 'account not found', statusCode: 404 };
  if (account.status === 'banned') return { ok: false, error: 'account banned', statusCode: 403 };

  const existing = await dao.getProfile(account.accountId);
  const expectedVersion = existing ? (typeof version === 'number' ? version : -1) : -1;

  const res = await dao.upsertProfile(account.accountId, data, expectedVersion);
  if (!res.ok) {
    return { ok: false, conflict: true, version: res.version, statusCode: 409 };
  }

  await dao.syncRedundantColumns(account.accountId, data, power);
  return { ok: true, version: res.version };
};
