/**
 * 小程序数据管理平台 — 接入配置（运维配置，非游戏数值）
 *
 * 平台文档：项目资产《小程序接入数据平台说明》v1.0 / 2026-11-26
 * 看板：https://mini-management-d0flwzdnf201202a-1463521202.tcloudbaseapp.com/
 *
 * ⚠️ 启用前必须完成两件事（代码侧无法代劳）：
 *   1. 找平台管理员在 tenants 表登记《占地之王》，分配正式 appKey
 *      需提供：小程序名称「占地之王」/ AppID「wxd68a1ef6432527b3」/ 项目名「kingoftheoccupiers」
 *   2. 微信公众平台 → 开发管理 → 开发设置 → 服务器域名 → request 合法域名，添加：
 *      https://mini-management-d0flwzdnf201202a-1463521202.ap-shanghai.app.tcloudbase.com
 *      （每月仅可修改 5 次，一次配准；开发者工具可临时关「不校验合法域名」自测）
 *
 * 然后把下方 enabled 改 true、appKey 换成正式值即可。
 * 不写死正式 appKey 到仓库：也可在运行时调用 tracker.configure({ appKey }) 注入。
 *
 * 当前默认 enabled=false 的原因：demo_key_replace_me 属于「示例小程序」租户，
 * 真机直接上报会污染他人看板数据。接入代码已就绪，只差上述外部依赖。
 */
export default {
  enabled: false,
  appKey: 'demo_key_replace_me',
  reportUrl: 'https://mini-management-d0flwzdnf201202a-1463521202.ap-shanghai.app.tcloudbase.com/api/report',
  clientVersion: '1.0.0',
  batchSize: 20,
  flushIntervalMs: 3000,
  debug: false,
};
