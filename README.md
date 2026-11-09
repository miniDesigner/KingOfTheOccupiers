# 占地之王 King of the Occupiers

> 六边形策略战棋 · 微信小游戏 · **全新玩法原型**

- 中文名：《占地之王》
- 英文名 / 目录名：`kingoftheoccupiers`
- 微信开发者工具项目名：`kingoftheoccupiers`

## 本项目定位

《占地之王》是在 **占城先锋**（Territory King）工程基础上 fork 出的**全新玩法原型**。

- **继承**：六边形战棋战斗引擎、Canvas 2D 渲染体系、局外养成框架（抽卡/科技/装备/商店/任务/通行证/天梯）、微信小游戏适配层、测试套件
- **改动**：2026-11 玩法改造已落地 —— 地图缩为 11×7（77 格）、格子/兵种/建筑视觉放大、战力差距压缩、快节奏经营、存档与快照跨版本兼容；同月追加「节奏回收」：压缩产出效率与交战密度，同时保持单局时长不变（见「当前状态」与坑 8/9/10/11）
- **不继承**：云开发环境（原型阶段纯本地存档）、appid（需新注册）

## 当前状态

| 项 | 状态 |
|---|---|
| 工程底座 | ✅ 已就绪，可运行、可测试 |
| 浏览器预览 | ✅ 已跑通（进大厅 + 渲染无异常）|
| 微信真机入口 | ✅ 已重建（含分享/返回键/高分屏适配）|
| 测试套件 | ✅ 48 个回归测试全绿 |
| 双工程同步 | ⬜ 尚未建立（原型期单工程）|
| 云开发 | ⬜ 默认关闭，玩法定型后再接 |
| AppID | ✅ `wxd68a1ef6432527b3`（已配置）|
| 玩法改造 | ✅ 2026-11 已完成：11×7 小图 / 放大表现 / 战力压缩 / 快节奏经营 / 存档兼容，48 测试全绿 |
| 节奏回收 | ✅ 2026-11 已完成：产出效率与交战密度压缩约 55%，四档胜率/单局时长保持基线，200 局基线重生成 |
| 图间差异收敛 | ✅ 2026-11 已结案：多 seed 诊断证明 13.5pp 跨度为抽样噪声（非地图缺陷），5 套障碍坐标保持原样，详见坑 12 |
| 核心玩法设计文档 | ⬜ 待补充（本轮以数值与表现改造为主）|

## 快速开始

### 浏览器预览

```bash
cd kingoftheoccupiers
python3 preview-server.py
```

访问 `http://localhost:8890/preview/index.html`

- 端口固定 **8890**，服务目录为项目根
- 自动附加 `Cache-Control: no-store`，刷新即取最新代码

### 跑测试

```bash
# 全部回归测试（46 个，约 40 秒）
node --test "tests/test-*.mjs"

# 单个测试
node tests/test-wechat-entry.mjs

# 依赖完整性检查
node tests/check-imports.mjs
```

> **测试命名约定**：`test-*.mjs` 参与全量回归；`diag-*` / `repro-*` / `sim-*` 是一次性诊断/复现/模拟脚本，不参与回归，按需单独跑。

### 改配置后必须重新编译

```bash
node tools/build-config-js.mjs
```

> 微信小游戏的 `require()` 不支持 `.json`。改完 `config/*.json` 必须跑此脚本生成 `config/*.js`，
> 否则真机读到的还是旧配置。（浏览器预览走 fetch 读 JSON，不受影响 —— 这正是易漏的坑。）

### 微信开发者工具

1. 导入本目录
2. 项目类型自动识别为 **小游戏**（`compileType: game`）
3. AppID 已内置为 `wxd68a1ef6432527b3`，导入即可编译、真机预览、上传

## 工程结构

```
kingoftheoccupiers/
├── game.js                  # 微信小游戏入口桩（只做 4 件事，不含业务逻辑）
├── game.json                # 小游戏运行时配置
├── project.config.json      # 工程配置（appid / compileType）
├── preview/                 # 浏览器预览（index.html + wx-shim.js 兼容层）
├── preview-server.py        # 本地预览服务器（端口 8890）
├── src/                     # 业务代码唯一真相源
│   ├── game/Game.js         # 主循环 + 状态管理 + 屏幕切换
│   ├── world/               # 六边形坐标 / 地块 / 地图
│   ├── entity/              # 建筑 / 玩家 / 行军 / AI / 快照对手
│   ├── system/              # 战斗 / 经济 / 渲染 / 输入 / 寻路 / 动画 / 音频 / 广告
│   ├── meta/                # 局外养成（抽卡/科技/装备/商店/任务/通行证/天梯）
│   ├── data/                # 配置加载 / 关卡生成 / 种族
│   ├── net/                 # 云同步 / 会话
│   └── utils/               # 数学 / 确定性 RNG
├── config/                  # 16 个 JSON（+ 编译期生成的 .js）
├── tests/                   # 测试套件
├── tools/                   # 构建工具（config 编译 / 技能生成）
├── cloudfunctions/          # 云函数（原型期未启用，保留）
├── server/                  # 本地 Node + SQLite 后端（原型期未启用，保留）
└── .attic/                  # 从占城先锋带过来的过期副本（仅备查，勿引用）
```

## ⚠️ 从占城先锋继承的坑（务必注意）

1. **入口桩与业务代码必须分离**

   根目录 `game.js` 是**入口桩**，只负责建 Canvas / 启动 / 注册分享和返回键。
   游戏逻辑唯一真相源是 `src/game/Game.js`。

   > 占城先锋项目曾长期存在根目录 `game.js` / `InputSystem.js` / `RenderSystem.js`
   > **三份过期副本**（与 `src/` 版本差 250~270 行），导致微信开发者工具跑的是旧代码，
   > P36/P37/P38 三轮改造在真机上完全没生效。这三个文件已移入 `.attic/`。
   > **切勿再在根目录放业务代码副本。**

2. **渲染与点击坐标必须共用同一份布局函数**

   `RenderSystem` 的静态布局函数（`deployLayout` / `gachaLayout` / `shopLayout` 等）
   必须被渲染和点击命中同时调用。历史上因两边各自硬编码坐标导致点击错位。

   配套硬约束：
   - `BACK_BTN` 占 `x 16~96 / y h-51~h-16`，任何全宽底部按钮必须先让开它
   - 统一资源栏覆盖 `y 0~50` → 子界面首个 label 必须 ≥ 58
   - 品质表达用 `QUALITY_COLORS` 外框 + 品质名，**不用星星**
   - 底部区域一律自下而上锚定：`底边 = h - margin`，逐个 `- gap - h`

3. **测试必须显式退出**

   启动 Game 后主循环用 `requestAnimationFrame` 无限调度。测试若只在失败时 `process.exit(1)`，
   全通过时会挂住不退（`node --test` 全量跑会超时）。正确写法：
   ```js
   process.exit(failed > 0 ? 1 : 0);
   ```

4. **改 config 必须重新编译**（见上文）

5. **`compileType` 必须是 `game`**

   小游戏与小程序的 `compileType` 不同。配成 `miniprogram` 会导致开发者工具按错误类型编译。
   （占城先锋主工程就配错了，`test-wechat-entry.mjs` 会卡这一项。）

6. **根目录 `game.json` 不能留空值字段**

   微信基础库新版（≥ 2.02.x）收紧了对项目配置项的校验，`workers: ""` 会直接报
   `game.json: ["workers"] 不能为 ''` 并终止编译。语义上这些字段「不写 = 不使用」，
   留空反而撞校验。当前根目录 `game.json` 只保留三项必需值：

   ```json
   { "deviceOrientation": "portrait", "showStatusBar": false, "networkTimeout": {...} }
   ```

   > 若将来要用多线程 Worker 或分包，写成真实路径/内容，不要再放空字符串或空数组。
   > 注意区分：根目录 `game.json` 是**微信项目配置**；`config/game.json` 是本游戏的
   > 自定义数值配置，两者同名不同物，互不干扰。

7. **不要依赖单一 wx API 做环境探测**

   `src/data/ConfigLoader.js` 的 `isWxEnv()` 曾要求 `getSystemInfoSync` 必须存在才算微信环境，
   而该 API 已被官方标记废弃。一旦被移除会把真机误判成浏览器 → 走 fetch 分支 →
   `fetch is not defined` → 配置全挂 → 白屏。现已改为对 4 个微信专有 API 做 OR 判定。
   新增环境判断时遵循同一原则：**用 OR 冗余，不用 AND 强依赖**。

8. **兵营产速有两条真源，改「快节奏」别只改一半**

   玩家兵营走 `deployables.json` 的 `buildingUpgrades`（局外强化）；AI 兵营
   `generateAiDeployment()` 返回空 `buildingUpgrades` → 落回 `config/buildings.json`。
   两处 `warriorRate` 必须**同值同梯度**（当前均为 1/2/4/6）。2026-11 曾只把
   `buildings.json` 的 Lv1 从 1 提到 2 想做「快节奏」，结果只有 AI 单方面翻倍、
   玩家产速纹丝不动，小图上直接变成 2.56 倍出队碾压，模拟胜率崩到 0~15%。

   另外 `Building._initFromDeployment` 早期把玩家兵营产速锁死在 Lv1 强化值、
   忽略地图预设等级；AI 无强化数据却按 `levelConfig` 取 1/2/4/6，翻到高级兵营
   便白嫖 4~6 倍产速。现统一为 `产速 = 地图等级基础 × 局外强化倍率`，双方对称。

   > 调节奏请通过「初始金币 / 金产率 / 编组阈值 / 行军速度」实现，
   > 不要单方面抬兵营产速；翻格成本也不是对称杠杆（见坑 11）。

9. **平衡模拟器必须与真实对局同路径**

   `tests/sim-balance-phase6.mjs` 早期让 AI 走 `_initFromRace`（races.json 固定属性）
   并保留按难度作弊的初始金币，而 `Game.js` 用的是
   `ai.deploymentBundle = generateAiDeployment(diff)`。两者不一致时，战力压缩只压了
   真实对局双方、没压模拟器里的 AI，任何调参都在追一个假目标。
   现已对齐：AI 注入 deploymentBundle、初始金币双方均 200、大本营同传 bundle。
   **改平衡前先确认模拟器与 `Game.initLevel` 同路径**，否则结论全是噪声。

10. **死配置清单（改了不生效的字段）**

   `config/game.json` 中以下键当前**没有业务消费点**，改它不会改变游戏行为：
   `map.radius`、`map.camera`（相机由 `HexMap.getBounds()` + `fitScale` 硬编码）、
   `economy.initialGold`（真源在 `src/data/levels.js` 的 `buildBattleConfig`）、
   `ai.decisionInterval`（真源在 `src/entity/AIPlayer.js` 的 `AI_DIFFICULTY`）。
   另外 `march.hqBufferMax`、`config/combat.json` 的 `duration.*`（真结算间隔硬编码在
   `src/system/MarchSystem.js:193/208`）、`config/levels.json` 整表也都是死配置。
   改数值前先用 Grep 找消费点，别只看配置文件名猜；`src/config.js` 里 5 个 getter
   全项目零调用，判断死活要看**静态导出**而不是 getter。

11. **节奏调参的两个反直觉点（2026-11 节奏回收踩坑）**

    - **攻城不是「一击摧毁」，而是持久磨血**。`CombatSystem._resolveBuildingCombatInner`
      用 `attackPower`（= 队伍 `getPower()`，战力压缩后仅个位数到十几）对比
      `defense`（= `currentHp + defenseBonus`，HQ 初始 220）。二者差一个数量级，
      `attackPower > defense` 几乎不会成立；实际是每 0.8 秒扣一次血、近战队伍攻城
      失败即全灭。因此「调大编组阈值 → 队伍更大 → 拆家更快 → 单局变短」是错的：
      编组数下降的幅度远大于单队战力上升，**总攻城输出反而下降**，单局被拉长 20~50%。
      要「交战变少但单局不拉长」，得同比**下调大本营 hp/defense**（200/20→100/10）
      把取胜门槛拉回来，而不是指望队伍变大。

    - **「双方同价」的翻格成本并非对称杠杆**。脚本化人类玩家（`ScriptedHuman`
      interval 1.8s）翻格频率远高于 AI（决策间隔 2.6s 以上），`cost +15%` 会
      非对称地把 normal/nightmare 胜率压掉约 5pp。本轮实测后已回退成本，
      产出压缩改由 `baseGoldRate 2→1` 与 `deployables.units[].productionSpeed ×0.8`
      （双方对称）承担，胜率再用 `AI_DIFFICULTY.interval` 这一唯一非对称旋钮校准。

   > 判定节奏是否达标请看 `tests/sim-balance-phase6.mjs` 的**编组数**与**时长**两列，
   > 别只看胜率：胜率漂移可以用 AI 手速补回来，但交战密度和单局时长不会说谎。

12. **图间胜率跨度是抽样噪声，不是地图缺陷（2026-11 收敛结案）**

    节奏回收后 5 套地图 normal 胜率跨度从 6.0pp 涨到 13.5pp（`twin_canyon` 39.5%、
    `river_ford` hard 33.0% 看似「异常图」），一度准备改障碍坐标收敛。**多 seed 诊断
    证明这是统计噪声，已决定 5 套坐标保持原样**，证据链：

    - **根因**：`tests/sim-balance-phase6.mjs:356` 用
      `seed = OPT.seed + hashCombo(diff, layout.id, i)`，`hashCombo` 拼的是
      `diff|mapId|i`，**与障碍坐标无关**。每张 `layout.id` 抽到的是不同一批对局，
      每局 `mulberry32(seed)` 独立重置。因此 `span = 5 图胜率的 max−min`
      混入了「5 条不同随机流」的抽样散布，不是几何差异。
    - **V9 对照**：把 5 套障碍物坐标改成完全相同，normal span 仍约 **10.5pp**
      —— 这就是噪声地板，绝对 span 阈值（如 ≤8pp）在 200 局单 seed 下不可达。
    - **几何贡献上界**：T5 把 `twin_canyon` 障碍全清，normal 只从 39.5 涨到 42.0
      （+2.5pp），仍追不上 `plains` 49.0；且 hard 反而掉 11pp、span 涨到 16.0
      —— 中轴封死本来就是玩家侧的缓冲，打通它让高强度 AI 的推进增益更大。
    - **换 seed 翻转**：仅把 seed 从 `20260829` 换成 `20260830`（坐标完全不动），
      C0 的 normal span 13.5→**7.0**、hard 13.0→**7.5**；`twin_canyon` normal
      39.5→49.0（最低变次高）、`river_ford` hard 33.0→41.5（最低变最高）。
      所有候选的「改善」同步反转（`R1` river_hard +4.5→−1.0、`T3`/`TR1`
      normal span −3.5→+2.5）。**任何基于单 seed 的坐标改动都是过拟合**。

    > 结论与约定：**不设图间 span 的绝对达标线、不为收敛而改坐标**。
    > 若将来要判断某张图是否真的偏难，必须先换 seed 复核方向一致（A7），
    > 或用多 seed 聚合胜率，再谈改图；判「改善」一律用同 seed 同图的**配对 Δ**。
    > 附带两个扫描口径坑：60 局是 200 局的确定性子集但 span 虚高、判据会失效，
    > 必须用 200 局；stdout 的整数秒舍入会把 +6.14% 误判成 +7.22%，一律从
    > `sim-results-phase6.json` 明细精确计算。未改动的图逐图逐档 Δ=0 可作
    > 「替换正则没串位」的硬校验（本轮全部 ✓）。

## 技术栈

| 维度 | 选型 |
|---|---|
| 平台 | 微信小游戏 Canvas 2D / 浏览器 |
| 语言 | JavaScript ES6 模块（原生 import/export，无打包工具）|
| 坐标 | 六边形轴向坐标 (q, r) |
| 寻路 | A* + 六边形距离启发 |
| 渲染 | Canvas 2D + requestAnimationFrame |
| 随机 | Mulberry32 确定性种子 RNG |
| 存档 | localStorage（浏览器）/ wx.setStorageSync（微信）|
| 依赖 | 零 npm 运行时依赖（测试用 `node:test`）|

## 待办

- [x] 注册小游戏 AppID 并写入 `project.config.json`（`wxd68a1ef6432527b3`）
- [x] 玩法改造（2026-11）：11×7 小图 / 放大表现 / 战力压缩 / 快节奏经营 / 存档兼容，48 测试全绿
- [x] 节奏回收（2026-11）：产出效率与交战密度压缩约 55%，四档胜率/时长保持基线，200 局基线重生成
- [ ] 补充核心玩法设计文档（本轮改造以数值与表现为主）
- [x] ~~收敛 `twin_canyon` 等布局在压缩后的路径差异~~ —— 已结案：多 seed 诊断证明 13.5pp 为 200 局单 seed 抽样噪声，非地图缺陷；5 套坐标保持原样，避免过拟合（见坑 12）
- [ ] 微信开发者工具环境自检（wx API 兼容性 / Canvas / 安全区 / 包体）
- [ ] 建立双工程同步机制（若需要真机验证）
- [ ] 接云开发（新环境，不复用占城先锋环境）
