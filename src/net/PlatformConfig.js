/**
 * 小程序数据管理平台 — 接入配置（运维配置，非游戏数值）
 *
 * 平台文档：项目资产《小程序接入数据平台说明》v2.1 / 2026-11-27
 * 看板：https://mini-management-d0flwzdnf201202a-1463521202.tcloudbaseapp.com/
 *
 * 2026-11-27 平台修复后正式启用：
 *   - 平台已在 tenants 表登记「占地之王」（租户 id=5，active），分配正式 appKey
 *   - 平台云函数已兼容旧口径，本模块同步升级到 v2.1 标准事件（app_launch/login）
 *   - appSecret 绝不写入客户端：仅服务端鉴权场景（公告管理/GM）使用，上报只需 appKey
 *
 * ⚠️ 真机上线前仍需在微信公众平台完成一件事（代码侧无法代劳）：
 *   开发管理 → 开发设置 → 服务器域名 → request 合法域名，添加：
 *   https://mini-management-d0flwzdnf201202a-1463521202.ap-shanghai.app.tcloudbase.com
 *   （每月仅可修改 5 次，一次配准；开发者工具可勾「不校验合法域名」先自测）
 *
 * 合规：隐私政策须补充「运营数据统计」条款（草案见接入交付报告），法务确认后发布。
 * player_id 取匿名 uid（acc_+ 账号标识），不构成可直接识别自然人的个人信息。
 */
export default {
  enabled: true,
  // 平台分配的正式上报凭证（租户 id=5 / kingoftheoccupiers / wxd68a1ef6432527b3）。
  // appKey 是上报凭证，官方做法就是填在 SDK 配置里；appSecret 不得入客户端仓库。
  appKey: 'app_kotc_613f11',
  reportUrl: 'https://mini-management-d0flwzdnf201202a-1463521202.ap-shanghai.app.tcloudbase.com/api/report',
  announcementUrl: 'https://mini-management-d0flwzdnf201202a-1463521202.ap-shanghai.app.tcloudbase.com/api/announcements/public',
  clientVersion: '1.0.0',
  batchSize: 20,
  flushIntervalMs: 3000,
  heartbeatIntervalMs: 5 * 60 * 1000, // 心跳：驱动看板「实时在线/峰值/分服在线」
  debug: false,
};
