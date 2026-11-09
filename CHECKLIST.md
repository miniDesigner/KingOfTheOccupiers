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
全量回归      48 个测试 / 48 通过 / 0 失败 / 退出码 0
确定性基线    22 通过 / 0 失败
平衡模拟      200 局 × 4 难度 × 5 地图，零超时；胜率 95/49/39/30%
浏览器预览    HTTP 200，启动进大厅，渲染无异常
配置加载      16 个 JSON 全部加载成功
```

## 三、当前配置状态

| 项 | 值 | 说明 |
|---|---|---|
| appid | `wxd68a1ef6432527b3` | ✅ 已配置的正式小游戏 AppID |
| projectname | `kingoftheoccupiers` | |
| compileType | `game` | 小游戏 |
| 云开发 | 关闭 | 玩法定型后再接新环境 |
| 存档 | 纯本地 | localStorage / wx.setStorageSync |

## 四、待你确认/提供

1. ~~**小游戏 AppID**~~ —— ✅ 已配置 `wxd68a1ef6432527b3`（2026-09-28）
2. ~~**玩法是否调整**~~ —— ✅ 2026-11 已重启并完成玩法改造（11×7 小图 / 放大表现 / 战力压缩 / 快节奏经营），详见第六节
3. **双工程同步** —— 若需真机验证，需决定同步机制（脚本 or 单一工程）

## 五、常用命令

```bash
python3 preview-server.py              # 浏览器预览（:8890）
node --test "tests/test-*.mjs"         # 全量回归
node tests/check-imports.mjs           # 依赖检查
node tools/build-config-js.mjs         # 改 config 后必跑
node tests/sim-balance-phase6.mjs --games 200   # 平衡基线（写入 sim-results-phase6.json）
```

## 六、2026-11 玩法改造（本轮）

| 项 | 改造前 | 改造后 |
|---|---|---|
| 棋盘 | 20×11 = 220 格 | 11×7 = 77 格，5 套布局全部重做 |
| 视觉 | 格子/兵种偏小 | `hex.size=52`，兵种圆盘/图标/建筑字号放大，缩放下限 0.35→0.5 |
| 战力 | 顶级与基准数倍差距 | 压缩到 2.49×，榜首/榜尾 2.99×（`BASE_FLATTEN=0.25` / `GROWTH_SCALE=0.07`）|
| 战斗结算 | 远程无损全歼 + 宽阈值 | 远程先手削减 30~60% + 五档阈值收窄 1.35 / 1.06 / 0.94 / 0.74 |
| 经营 | 初始 150 金 | 200 金、`baseGoldRate=2`、编组阈值 6、行军速度 0.85、建筑成本下调约 30% |
| AI 决策间隔 | 6 / 3 / 2 / 1 秒 | 3.5 / 2.4 / 2.0 / 1.8 秒（收窄手速差，避免小图放大）|
| 存档兼容 | schemaVersion 1 | `PlayerProfile` v2（旧档返还养成投入）、快照 `RULES_VERSION=2` 不一致时降级 AI 对战 |

新增专项测试：`test-power-compression.mjs`（12/12）、`test-visual-scale.mjs`（16/16）、
11×7 全布局寻路冒烟；平衡基线 `tests/sim-results-phase6.json` 已按 200 局重生成
（easy 95.3% / normal 48.7% / hard 39.3% / nightmare 30.4%，5 图 normal 差异 45~51%）。

> 关键修复：**兵营产速双真源对齐**（`buildings.json` 与 `deployables.json` 必须同梯度）、
> **模拟器 AI 路径对齐真实对局**（注入 `generateAiDeployment`、双方初始金币均 200）。
> 详见 README 坑 8 / 9 / 10。
