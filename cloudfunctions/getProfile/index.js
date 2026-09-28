/**
 * 云函数 getProfile — 拉取存档
 *
 * 入参：{}（openid 从 wxContext 取）
 * 出参：{ ok, version, data, updatedAt }（无存档时 version=0, data=null）
 */
const cloud = require('wx-server-sdk');
const dao = require('./shared/db.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no openid' };

  const account = await dao.getAccountByOpenid(OPENID);
  if (!account) return { ok: true, version: 0, data: null };

  const profile = await dao.getProfile(account.accountId);
  if (!profile) return { ok: true, version: 0, data: null };

  return { ok: true, version: profile.version, data: profile.data, updatedAt: profile.updatedAt };
};
