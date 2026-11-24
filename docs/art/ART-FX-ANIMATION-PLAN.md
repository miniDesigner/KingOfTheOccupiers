# 占地之王 · 特效动画补充产出规格与预算（ART-FX-ANIMATION-PLAN）

> 建立时间：2026-11-24　|　适用：`assets/effects/` 全部特效 + `AnimationManager` 动效层
> 上游真相源：`docs/art/ART-STYLE.md`（风格语言）、`.workbuddy/artifacts/占位资源与特效动画盘点-2026-11-24.md`（现状盘点）
> 本文件管「补哪些、补成什么样、按什么规格、花多少预算」；路径/尺寸/格式以 `assets/PLACEHOLDER-MANIFEST.csv` 为准。

---

## 〇、结论先行

1. **现状**：22 张特效贴图中 21 张是程序化静态图（仅 `quality_glow_q2` 为正式图）；真正的动效由 `AnimationManager` 的 12 类 Canvas 程序化动画承担，贴图只做低透明度叠加（α0.08~0.28）。
2. **推荐路线（分两步）**：
   - **第一步 · 正式化（零代码、立刻生效）**：把 **15 张进渲染链路**的静态贴图升级为正式特效美术，同名同尺寸覆盖即可，不动 manifest、不动代码。
   - **第二步 · 动画化（需开发配合）**：只对 **4 张 192² 战斗特效**做序列帧（6 帧/张），并由开发加一个「按 effect.progress 选帧」的播放接口；**384² 特效禁止做序列帧**（内存会爆，见第五节）。
3. **不补**：`defeat_flash` / `defeat_debris` / `rank_shine` / `firework` —— 这 4 张在 `bfd5b00` 结算界面修复后已退出渲染链路（drawGameOver 装饰层移除、结算态跳过 drawArtLayer），补了看不见。
4. **风格锚点与禁忌**见第二、三节；**逐项规格**见第四节；**预算数字**见第五节；**可逐字复用的提示词包**见第六节。

---

## 一、范围界定：进链路 vs 零引用

| 状态 | 特效 key | 数量 | 消费点 | 处理 |
|---|---|---:|---|---|
| ✅ 进链路 | `combat_hit` / `combat_crit` / `combat_flash` / `combat_knockback` | 4 | `drawEffects` α0.28，每个战斗事件触发 | **P0 补**，优先序列帧 |
| ✅ 进链路 | `territory_wave` / `build_beam` / `ambient` | 3 | `drawEffects` α0.22 / α0.22 / α0.08 | **P0 补**，单帧正式化 |
| ✅ 进链路 | `quality_glow_q1/q3/q4/q5/q6` | 5 | 布阵兵种卡 `RenderSystem:2348` | **P1 补**，沿用功能色不改色号 |
| ✅ 进链路 | `gacha_epic_q4/q5/q6` | 3 | ArtLayer `BIND_GACHA` α0.18 | **P1 补**，单帧（禁序列帧） |
| ✅ 进链路 | `tutorial_halo` | 1 | `_drawTutorialOverlay` α0.22 | **P2 补**，引导态可见 |
| ✔️ 已正式 | `quality_glow_q2` | 1 | 同上 | **保留不动**，作为同族风格参照 |
| ⛔ 零引用 | `defeat_flash` / `defeat_debris` / `rank_shine` / `firework` | 4 | 结算修复后无调用点 | **不补**；若要恢复需先改渲染层 |

> 合计：进链路待补 15 张 + 已正式 1 张 + 零引用 4 张 = 20 张（清单登记 22 张，差额为枚举口径差异，以实际文件为准）。

---

## 二、风格锚点（特效专用，逐字复用）

继承 `ART-STYLE.md` 的 Q 版厚涂语言，特效应有发光/能量/动势语言。以下文字**每批提示词第一段的措辞完全一致**，只替换主体描述与配色槽位：

> **明快的 Q 版厚涂卡通游戏特效，圆润软萌的能量造型，糖果质感高光，柔和体积光，中心亮四周渐隐的发光结构，明亮高饱和，透明底，无硬黑描边，在深靛蓝夜景底上清晰可读**

### 2.1 六色特效色彩板（沿用 ART-STYLE，不新增主色）

| 槽位 | 色值 | 用途 | 明度 L |
|---|---|---|---:|
| 核心高光 | `#EAF8FF` 云白 | 所有特效的中心闪光点 | 95 |
| 主强调 | `#FFD23F` 明黄 | 命中 / 暴击 / 奖励 / 领地 | 85 |
| 次强调 | `#FF8C42` 活力橙 | 爆发 / 火焰 / 击退 | 72 |
| 辅助 | `#5BB8E8` 天蓝 | 治疗 / 护盾 / 波纹 | 74 |
| 稀有 | `#A855F7` 品质紫 | 羁绊 / 招募稀有度 | 64 |
| 危险 | `#EF4444` 神话红 | 暴击强化 / 伤害提示 | 62 |

> `quality_glow_q1~q6` 是**功能色**，必须沿用 `ART-STYLE 2.4` 的 `#9ca3af / #22c55e / #3b82f6 / #a855f7 / #f97316 / #ef4444`，不得替换为上表色值。

### 2.2 明度阶梯（特效叠在深底上的可读性）

| 层 | 明度 L | alpha |
|---|---:|---:|
| 核心高光 | 85–95 | 0.9–1.0 |
| 主体发光 | 60–80 | 0.7–0.9 |
| 外缘辉光 | 30–50 | 0.2–0.4 |
| 舞台底（夜景） | 15–48 | — |

**铁律**：特效外缘必须渐隐到透明，不要硬边；在 L15–48 的深底上，核心高光与舞台底明度差须 ≥ 40，否则看不见。

---

## 三、禁忌清单（特效专用）

- 不要写实爆炸 / 烟雾 / 火光照片感，不要赛博霓虹与激光束
- 不要硬黑描边（继承 ART-STYLE）；暗部用带色相深色，不用纯黑
- 不要纯白大色块（深底上会糊成一片），高光只留中心小面积
- 不要粉嫩少女色、不要品红系
- 不要任何文字、编号、水印、角标
- 不要光束 / 射线 / 极光 / 星云（延续背景禁令，抢焦点）
- **序列帧铁律**：同一特效的各帧必须是同一图形的连续演化，不得逐帧独立构图，否则播放时会闪烁

---

## 四、逐项动画规格表

### 4.1 单帧正式化（第一步，零代码）

| 特效 | 尺寸 | 覆盖方式 | α | 图集组 | 优先级 |
|---|---|---|---:|---|---|
| `combat_hit` | 192×192 | 同名覆盖 | 0.28 | ATLAS-FX-COMBAT | P0 |
| `combat_crit` | 192×192 | 同名覆盖 | 0.28 | ATLAS-FX-COMBAT | P0 |
| `combat_flash` | 192×192 | 同名覆盖 | 0.28 | ATLAS-FX-COMBAT | P0 |
| `combat_knockback` | 192×192 | 同名覆盖 | 0.28 | ATLAS-FX-COMBAT | P0 |
| `territory_wave` | 384×384 | 同名覆盖 | 0.22 | ATLAS-FX-WORLD | P0 |
| `build_beam` | 192×768 | 同名覆盖 | 0.22 | ATLAS-FX-WORLD | P0 |
| `ambient` | 192×192 | 同名覆盖 | 0.08 | ATLAS-FX-WORLD | P0 |
| `quality_glow_q1/q3/q4/q5/q6` | 384×384 | 同名覆盖 | 由渲染层定 | ATLAS-FX-CARD | P1 |
| `gacha_epic_q4/q5/q6` | 384×384 | 同名覆盖 | 0.18 | ATLAS-FX-GACHA | P1 |
| `tutorial_halo` | 384×384 | 同名覆盖 | 0.22 | ATLAS-FX-WORLD | P2 |

> 单帧覆盖**不需要**改 `PLACEHOLDER-MANIFEST.csv`，也不需要跑 `gen-art-manifest.mjs`（key 由路径派生，路径不变）。

### 4.2 序列帧动画（第二步，需开发配合）

仅对 4 张 192² 战斗特效做，理由见第五节内存推导：

| 特效 | 帧数 | 帧率 | 时长 | 循环 | 命名 | 播放接口 |
|---|---:|---:|---:|---|---|---|
| `combat_hit` | 6 | 20 fps | 0.30s | 单次 | `combat_hit_f01..f06.png` | `effect.progress → frame` |
| `combat_crit` | 8 | 20 fps | 0.40s | 单次 | `combat_crit_f01..f08.png` | 同上 |
| `combat_flash` | 4 | 20 fps | 0.20s | 单次 | `combat_flash_f01..f04.png` | 同上 |
| `combat_knockback` | 6 | 20 fps | 0.30s | 单次 | `combat_knockback_f01..f06.png` | 同上 |

**推荐合图**：把每组的帧横向拼成 spritesheet（如 `combat_crit_sheet.png` 1536×192），每帧渲染 1 次 drawImage 而非 8 张图切换，减少纹理绑定。

**接口规格（给开发，不属美术实现范围）**：在 `drawEffects` 中按 `Math.min(frameCount-1, Math.floor(progress * frameCount))` 取帧，替换现有 `this._art(pick_combatFx(...), ...)` 的单帧调用；无序列帧素材时回退到现有单帧路径。

### 4.3 程序化动画（现有能力，无需补）

`AnimationManager` 已有 12 类，全部可用：`addParticle` / `explosion` / `spark` / `ringPulse` / `floatingText` / `shakeScreen`（已被 PM 要求全局关闭）/ `flashScreen` / `buildingCollapse` / `synergyActivate` / `critEffect` / `victoryFireworks` / `defeatEffect`。

**动感增强建议（规格层面，交开发落地）**：打击感三要素目前缺「顿帧」——`critical` 与 `buildingCollapse` 可加 60–80ms 的 hit-stop；`combat_hit` 的 alpha 曲线可由线性改为 easeOut（快起慢收）。这些是代码改动，不在此次美术产出内。

---

## 五、性能预算（数字先行，倒推规格）

### 5.1 纹理内存（RGBA 未压缩，常驻显存）

| 规格 | 单张字节 | 单张 KB | 现有张数 | 小计 |
|---|---:|---:|---:|---:|
| 384×384 | 589,824 B | 576 KB | 15 | 8.44 MB |
| 192×192 | 147,456 B | 144 KB | 5 | 0.70 MB |
| 192×768 | 589,824 B | 576 KB | 1 | 0.56 MB |
| **合计** | | | **21** | **≈ 9.70 MB** |

### 5.2 序列帧增量（为什么 384² 禁做）

| 方案 | 计算 | 增量 | 结论 |
|---|---|---:|---|
| combat 4 张 × 6 帧（192²） | 4 × 6 × 144 KB − 原 4×144 KB | **+2.88 MB** | ✅ 可接受 |
| gacha_epic 3 张 × 12 帧（384²） | 3 × 12 × 576 KB − 原 3×576 KB | **+19.0 MB** | ⛔ 禁止 |
| quality_glow 5 张 × 8 帧（384²） | 5 × 8 × 576 KB − 原 5×576 KB | **+20.2 MB** | ⛔ 禁止 |

> 微信小游戏 `assets/` 已约 12MB（见 ART-STYLE 6.4），叠加序列帧会进一步挤占分包。所以序列帧**只给战斗 4 张 192²**，其余保持单帧。

### 5.3 同屏特效预算

| 指标 | 数值 | 依据 |
|---|---:|---|
| 粒子硬上限 | 300 | `AnimationManager.maxParticles` |
| 单次暴击 | 24 粒子 + 1 飘字 | `critEffect`: 16+8 |
| 建筑坍塌（大本营） | 77 粒子 | 30+15+20+12 |
| 羁绊激活（3阶） | 26 粒子 + 3 光环 + 1 飘字 | `synergyActivate` |
| 胜利烟花 | 8 波 × 20 = 160 粒子（分时发射） | `victoryFireworks` |
| **建议同屏 effect 实例上限** | **≤ 12** | 峰值 12×4=48 次 drawImage/帧 |
| **建议同屏粒子上限** | **≤ 200** | 留 100 余量给坍塌+暴击叠加 |

> 现有峰值测算：3 次暴击 + 1 次大本营坍塌 + 1 次 3 阶羁绊 = 24×3+77+26 = **175 粒子 < 300**，当前安全；补美术不改变粒子数。

---

## 六、提示词包（四段式，逐字复用）

> 用法：**段 1 与段 4 每个 prompt 完全一致**，只换段 2（主体）与段 3（配色/构图）。一次只变一个变量。

### 段 1 · 风格锚点（固定，逐字复制）

```
明快的 Q 版厚涂卡通游戏特效，圆润软萌的能量造型，糖果质感高光，柔和体积光，
中心亮四周渐隐的发光结构，明亮高饱和，透明底，无硬黑描边，
在深靛蓝夜景底上清晰可读
```

### 段 4 · 负面词（固定，逐字复制）

```
no realistic explosion, no smoke, no photo fire, no neon cyberpunk, no laser beam,
no hard black outline, no pure white block, no text, no numbers, no watermark,
no pink pastel, no aurora, no starfield, no ray
```

### 样例 A · `combat_crit`（暴击，P0）

**段 2 主体**：`a cartoon impact burst, jagged star shape with rounded tips, bright core with concentric glow rings, radiating short sparkle shards, energetic and readable at 48px`

**段 3 技术**：`center the burst in the frame, keep 20% transparent margin on all sides, palette: #EAF8FF core, #FFD23F main, #FF8C42 outer, 192x192 square, single frame`

### 样例 B · `territory_wave`（领地波纹，P0）

**段 2 主体**：`an expanding hexagonal territory ripple, soft glowing hexagon outline fading outward, gentle concentric wave, calm magical feel`

**段 3 技术**：`centered hexagon, thin glowing stroke that fades to transparent at edges, palette: #5BB8E8 and #EAF8FF, 384x384 square, single frame, no solid fill`

### 样例 C · `gacha_epic_q4`（稀有度光效，P1）

**段 2 主体**：`a cartoon epic summon aura, upward flowing energy ribbons, floating rounded sparkles, soft radial glow, celebratory but not flashy`

**段 3 技术**：`vertical composition, mostly transparent so unit art stays visible, palette: #A855F7 and #EAF8FF, 384x384 square, single frame, low density`

### 6.1 后处理与校验（收图后跑）

```bash
# 规格与命名合规校验 + 产出清单
python art_asset_tools.py check   <dir>
# 批量裁掉透明边（特效不建议裁，会改变中心锚点——只用于检查）
python art_asset_tools.py trim    <dir>
# 提取主色板，对齐已有资产
python art_asset_tools.py palette <img>
# 生成接触表，缩略图测试可读性
python art_asset_tools.py sheet   <dir>
```

> 脚本位置：`C:/Users/Moral001/.workbuddy/plugins/cache/experts/cocos-game-artist/2.0.1/skills/art-2d-production/scripts/art_asset_tools.py`。

---

## 七、落地批次计划

| 批次 | 内容 | 张数 | 代码改动 | 验收 |
|---|---|---:|---|---|
| B1 | combat 4 张单帧正式化 | 4 | 无（同名覆盖） | 战斗实拍：命中/暴击清晰，风格与幼龙同族 |
| B2 | world 3 张（territory/build/ambient） | 3 | 无 | 战斗实拍：波纹/光柱不糊底，ambient 不喧宾夺主 |
| B3 | card 5 张 + gacha 3 张 | 8 | 无 | 布阵卡品质光晕色号正确；招募光效不挡立绘 |
| B4 | tutorial_halo 1 张 | 1 | 无 | 引导态高亮圈清晰 |
| B5 | combat 4 张序列帧 | 4 | 需开发加选帧接口 | 逐帧连贯无闪烁；内存增量 ≤ +2.88 MB |

---

## 八、待确认项（假设，≤5 条）

- 假设：本次「补充产出特效动画」优先要**正式美术贴图**（B1–B4，零代码、立刻生效），序列帧（B5）留待开发排期后跟进。（待确认）
- 假设：4 张零引用结算特效（`defeat_*` / `rank_shine` / `firework`）不补，因结算界面修复后已退出渲染链路。（待确认）
- 假设：目标平台为微信小游戏，内存按上表 RGBA 常驻口径预算，不额外做 ASTC/ETC 压缩假设。（待确认）
- 假设：出图前先给方案（本文件），确认后先出 **1 张 `combat_crit` 基准图**定风格，再批量——遵循项目「先定调再放量」约定。（待确认）
- 假设：`quality_glow` 系列沿用 `ART-STYLE 2.4` 功能色，不改色号。（待确认）

> 按项目约定，本轮**只交方案与规格，未调用出图**。确认后我先出基准图给你过目，再决定是否批量生成。
