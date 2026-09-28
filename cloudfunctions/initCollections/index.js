/**
 * initCollections — 一次性建集合云函数
 *
 * 用法：tcb fn invoke initCollections
 *   或在云开发控制台「云函数 → initCollections → 测试」点一次。
 *
 * 行为：
 *   - 6 个集合：accounts / profiles / match_records / admin_users / operation_logs / announcements
 *   - 如果集合已存在，createCollection 会返回错误但不影响整体（被 catch 吸收）
 *   - 返回 { created: [...], existed: [...], failed: [...] } 方便排查
 *
 * 注：建索引（如 openid 唯一、accountId 唯一）建议在控制台「数据库 → 集合 → 索引管理」手动加。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const COLLECTIONS = [
  'accounts',
  'profiles',
  'match_records',
  'admin_users',
  'operation_logs',
  'announcements',
];

exports.main = async () => {
  const db = cloud.database();
  const created = [];
  const existed = [];
  const failed = [];

  for (const name of COLLECTIONS) {
    try {
      const res = await db.createCollection(name);
      created.push({ name, res });
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || String(e);
      // "collection already exists" 或中文「集合已存在」都算「已存在」
      if (/exists|已存在|already/i.test(msg)) {
        existed.push({ name, msg });
      } else {
        failed.push({ name, msg, raw: e });
      }
    }
  }

  return {
    ok: failed.length === 0,
    created: created.map(x => x.name),
    existed: existed.map(x => x.name),
    failed,
    envId: cloud.getWXContext ? null : null, // wxContext 在 init 阶段不可用，仅占位
  };
};
