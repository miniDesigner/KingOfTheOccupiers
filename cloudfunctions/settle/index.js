/**
 * 云函数 settle — 服务端权威结算
 *
 * 入参：{ result, mode, difficulty, oppTrophies, power }
 * 出参：{ ok, version, result, rewards, profile }（客户端以此覆盖本地）
 */
const cloud = require('wx-server-sdk');
const dao = require('./shared/db.js');
const { attachCurrency, settle } = require('./shared/settle-core.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no openid' };

  const account = await dao.getAccountByOpenid(OPENID);
  if (!account) return { ok: false, error: 'account not found', statusCode: 404 };
  if (account.status === 'banned') return { ok: false, error: 'account banned', statusCode: 403 };

  const profile = await dao.getProfile(account.accountId);
  const data = profile ? profile.data : {};
  const p = attachCurrency(data);

  const result = settle(p, event || {});

  const version = await dao.writeProfileAuthoritative(account.accountId, p);
  await dao.syncRedundantColumns(account.accountId, p, typeof event.power === 'number' ? event.power : undefined);
  await dao.insertMatch({
    accountId: account.accountId,
    mode: result.mode,
    result: result.result,
    opp: result.opp,
    trophiesDelta: result.trophiesDelta,
  });

  return {
    ok: true,
    version,
    result: result.result,
    rewards: result.rewards,
    profile: p,
  };
};
