# 占地之王 · 工程底座交付清单

交付时间：2026-09-21　基线：占城先锋（截至 2026-09-16）

## 一、已完成修复

| # | 问题 | 处置 | 验证 |
|---|---|---|---|
| 1 | 根目录 3 份过期副本（`game.js` / `InputSystem.js` / `RenderSystem.js`，与 `src/` 差 250~270 行）导致真机跑旧代码 | 移入 `.attic/` | 微信入口测试 26/26 通过 |
| 2 | 真机入口 `game.js` 缺失 | 采用真机工程验证过的入口桩，并关闭云开发 | ✅ 启动链路验证通过 |
| 3 | `compileType = miniprogram`（应为 `game`） | 改为 `game` | 测试项通过 |
| 4 | 云开发硬编码占城先锋环境 ID | 注释保留 + `TK_CLOUD_ENABLED = false` | 启动无云请求 |
| 5 | `test-wechat-entry.mjs` 全通过却挂住不退（`node --test` 超时） | 补 `process.exit(failed > 0 ? 1 : 0)` | 退出码 0，立即退出 |
| 6 | 游戏名未随项目更新 | 15 处玩家可见文案改为「占地之王」 | 页面标题/分享文案已验证 |

## 二、验收结果

```
依赖完整性    ALL IMPORTS VALID ✅ (47 files)
全量回归      46 个测试 / 46 通过 / 0 失败 / 退出码 0
浏览器预览    HTTP 200，启动进大厅，渲染无异常
配置加载      16 个 JSON 全部加载成功
```

## 三、当前配置状态

| 项 | 值 | 说明 |
|---|---|---|
| appid | `touristappid` | ⚠️ 占位，待新注册小游戏 AppID |
| projectname | `kingoftheoccupiers` | |
| compileType | `game` | 小游戏 |
| 云开发 | 关闭 | 玩法定型后再接新环境 |
| 存档 | 纯本地 | localStorage / wx.setStorageSync |

## 四、待你确认/提供

1. **小游戏 AppID** —— 注册后替换 `project.config.json` 的 `appid` 字段
2. **新玩法设计** —— 核心机制、与占城先锋的差异点
3. **是否建立双工程同步** —— 若需真机验证，需决定同步机制（脚本 or 单一工程）

## 五、常用命令

```bash
python3 preview-server.py              # 浏览器预览（:8890）
node --test "tests/test-*.mjs"         # 全量回归
node tests/check-imports.mjs           # 依赖检查
node tools/build-config-js.mjs         # 改 config 后必跑
```
