# 占地之王 King of the Occupiers

> 六边形策略战棋 · 微信小游戏 · **全新玩法原型**

- 中文名：《占地之王》
- 英文名 / 目录名：`kingoftheoccupiers`
- 微信开发者工具项目名：`kingoftheoccupiers`

## 本项目定位

《占地之王》是在 **占城先锋**（Territory King）工程基础上 fork 出的**全新玩法原型**。

- **继承**：六边形战棋战斗引擎、Canvas 2D 渲染体系、局外养成框架（抽卡/科技/装备/商店/任务/通行证/天梯）、微信小游戏适配层、测试套件
- **改动**：玩法机制做较大调整（具体设计待定，见「当前状态」）
- **不继承**：云开发环境（原型阶段纯本地存档）、appid（需新注册）

## 当前状态

| 项 | 状态 |
|---|---|
| 工程底座 | ✅ 已就绪，可运行、可测试 |
| 浏览器预览 | ✅ 已跑通（进大厅 + 渲染无异常）|
| 微信真机入口 | ✅ 已重建（含分享/返回键/高分屏适配）|
| 测试套件 | ✅ 46 个回归测试全绿 |
| 双工程同步 | ⬜ 尚未建立（原型期单工程）|
| 云开发 | ⬜ 默认关闭，玩法定型后再接 |
| AppID | ⚠️ 占位 `touristappid`，待新注册 |
| 新玩法设计 | ⬜ 待补充 |

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
3. 导入后需在工具内填写真实小游戏 AppID（当前为 `touristappid` 占位）

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

- [ ] 确定新玩法核心机制，更新本文档「当前状态」
- [ ] 注册小游戏 AppID，替换 `project.config.json` 中的 `touristappid`
- [ ] 按新玩法调整 `config/` 配置表
- [ ] 建立双工程同步机制（若需要真机验证）
- [ ] 玩法定型后接入云开发（新环境，不复用占城先锋环境）
