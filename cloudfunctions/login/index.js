/**
 * 云函数 login — openid 免密登录
 *
 * 入参：{ uid, nickname }
 * 出参：{ accountId, uid, nickname, openid, isNew }
 *
 * 流程：cloud.getWXContext() 拿 openid → 查/建 account → 返回 accountId。
 * 客户端后续 getProfile/putProfile/settle 直接用 openid 鉴权（无需 token）。
 */
const cloud = require('wx-server-sdk');
const dao = require('./shared/db.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no openid (call via minigame wx.cloud.callFunction)' };

  // 同一微信用户在云端只有 1 份存档：accountId 由 openid 唯一决定。
  // uid / nickname 属「呈现层 + 握手层」，只在首次创建时写入，
  // 之后不再随本地多账号切换覆盖（否则本地切账号会把云端字段来回刷新）。
  const uid = event.uid || ('u_' + OPENID.slice(-8));
  const nickname = event.nickname || '玩家' + OPENID.slice(-4);

  let account = await dao.getAccountByOpenid(OPENID);
  let isNew = false;
  if (!account) {
    const accountId = 'acc_' + OPENID;
    account = await dao.createAccount({ accountId, uid, openid: OPENID, nickname });
    isNew = true;
  } else {
    // 已存在账号：只刷新登录时间，不覆盖 uid/nickname（保持云端权威值稳定）。
    await dao.touchLogin(account.accountId);
  }

  return {
    ok: true,
    accountId: account.accountId,
    // uid 统一返回稳定主键 accountId（云端唯一标识），不再回传历史脏值。
    // 客户端 AccountManager.bindCloudIdentity 用它作为本地稳定 uid，大厅尾号与后台 uid 列一致。
    uid: account.accountId,
    nickname: account.nickname,
    openid: OPENID,
    isNew,
  };
};
