# 占地之王 · 兵种专属兵营建筑方案

> 状态：**用户已拍板走「40 张独立兵营图」（非徽记层方案 C）；基准图已出，待锁风格后放量 40 张**。
> 需求原话：「新增不同的兵种的兵营建筑不一样表现的效果，并为所有兵种制作对应的兵营图片」
> 日期：2026-11-25
>
> ⚠️ 决策变更（2026-11-25）：下方第三节仍保留三方案对比作决策记录，但执行口径以用户确认的
> **40 张独立兵营图**为准，第七节工程链路需相应改为「按 unitId 直接选独立兵营图」，
> 不再走徽记叠加。包体风险（6.4MB）已向用户明示，确认后建议兵营图单独进 art 分包按需加载。
>
> 🔧 后处理口径（2026-11-25）：所有兵营/地块候选图统一用 `tools/remove-bg-connected.py`
> （连通域抠底）。**禁用** `tools/remove-bg-building.py` 的全局颜色阈值——它会把米白石基、
> 奶油雪顶这类主体内部浅色当背景挖掉形成黑洞（山脉基准图已踩坑并修复，见 v2）。

---

## 一、结论先行

**需求成立，但不能按"40 张独立 312² 兵营图"直做——包体会炸。** 现有单张兵营 149~184KB（平均 163KB），40 张 = **6.4MB**，而 `assets/` 已约 12MB，微信主包 4MB 上限（`docs/project/CHECKLIST.md:210`）。同规格的 40 张兵种小图平均只要 15KB/张（合计 0.6MB），差 10 倍。

**推荐方案 C · 分层复用（锚点 + 兵种徽记 Overlay）**：
- 复用现有 `barracks_1~4` 作**等级骨架**（不改、不重画）
- 为 40 兵种各出一张**透明底兵种徽记层**（旗面/门楣徽章/武器架，小尺寸 96×96，约 8–15KB/张 → 总计 0.4–0.6MB）
- 运行时在兵营图上叠徽记层 → 视觉上"每兵种兵营不一样"，包体只增 0.5MB

**首轮只出 1 个兵种的徽记基准批锁风格，确认后再放量 40 张。** 这是项目铁律，也是风格一致性的保证。

---

## 二、现状事实（探查所得）

| 项 | 现状 |
|---|---|
| 选图逻辑 | `_artBuilding(type, level, isEnemy, ...)` 只看 `type+level`，barracks 用 `barracks_1~4`，**完全不看 `unitData.unitId`** |
| 可用字段 | `building.unitData.unitId`（字符串如 `'swordsman'`）、`variantColor`（品质色）、`level`、`quality` |
| 建筑着色 | `variantColor` 只用于贴图加载失败时的 emoji 兜底文字，**贴图不染色**（`ArtSystem.draw` 无 tint 参数） |
| 翻转动画 | `drawFlippingTile` 阶段 `tile.building` 还没创建，只有 `presetBuilding {type,level}`；精细图在翻转完成后的 `drawFlippedTile` 才画 |
| 兵种总数 | 40 个（`config/deployables.json`），`combatStyles` 分类：melee 25 / ranged 9 / magic 11 / defense 12 |
| 兵种小图 | `unit_small_01~40` 齐全，平均 15.3KB/张 |
| 水印守卫 | `isWatermarkArtKey()` 拦 `buildings/` 前缀，新图必须加 `FORMAL_BUILDING_KEYS` 或改前缀判断，否则静默降级成 emoji |
|  Manifest   | 新增素材要加 `PLACEHOLDER-MANIFEST.csv` 行 + 跑 `node tools/gen-art-manifest.mjs`，否则 `ART_INDEX` 无 key，`_art()` 静默失败 |
|  包体  | 单张兵营 149~184KB；40 张独立图 = 6.4MB；同屏理论 40~42 座兵营（77 格棋盘，barracks 概率 0.5） |

---

## 三、三方案对比（预算倒推规格）

| 方案 | 做法 | 新增包体 | 视觉差异 | 工程改动 | 评价 |
|---|---|---|---|---|---|
| **C（推荐）骨架 + 徽记层** | 沿用 4 张等级兵营，叠 40 张兵种专属透明徽记 | **0.4–0.6MB** | 旗面/门徽/武器架按兵种变；等级骨架仍区分 Lv1–4 | 渲染层叠 1 层（每兵营多 1 draw）、manifest 加 40 key、白名单 | 风格稳、包体省、可复用 |
| A（全独立图） | 40 兵种 × 4 等级 = 160 张 312² | 26MB | 最大 | 大 | **不可行**，包体爆炸 |
| B（40 张独立图，等级靠通用色） | 40 张 312² 各兵种一张，等级靠旗色/描边 | 6.4MB | 中 | 中 | 包体超限，且 losing 现有 4 级骨架 |

**为什么选 C**：现有 `barracks_1~4` 是已确认风格锚点（2.5D 卡通厚涂、暖木+石基、逐级加装饰），重画等于推翻已确认设计。徽记层只加装饰不改骨架，符合「同系列共用构图/视角/比例，只递进装饰细节」的铁律。

---

## 四、风格锚点（沿用现有兵营，逐字复用）

从 `assets/buildings/barracks_1~4.png` 实测提取，**徽记层必须与之同族**：

| 维度 | 锚点 |
|---|---|
| 视角 | 固定高位 2.5D 等距，顶面+侧面同框，无透视漂移 |
| 体积 | 圆润厚涂，无硬描边；顶面暖亮、侧面冷暗 |
| 配色 | 暖木棕 `#92562D` / `#C99A60`、石基米白、高光 `#E4BF71` |
| 徽记位置 | 旗面（顶部）、门楣徽章、武器架 三选一，随兵种固定不随机 |
| 尺寸 | 徽记层 96×96 透明底，叠在 312² 兵营图上时缩放到对应区域 |
| 明度 | 徽记主色 L 90–170，不用纯白/纯黑（会在暖木底上跳脱） |
| 禁忌 | 不画文字、不用发光/霓虹、不引入冷色科幻感、不盖住兵营原有等级装饰 |

---

## 五、40 兵种徽记分类方案（按 combatStyles 聚类，减少出图风格漂移）

| 类别 | 兵种数 | 徽记母题 | 主色 |
|---|---|---|---|
| melee（近战） | 25 | 剑/斧/盾交叉 | 钢灰 + 暖木 |
| ranged（远程） | 9 | 弓/弩/箭袋 | 深绿 + 皮革棕 |
| magic（法术） | 11 | 法杖/符文/晶石 | 紫/蓝 |
| defense（防御） | 12 | 塔盾/城垛 | 石灰 + 铜 |

> 多标签兵种（如既 melee 又 defense）按**主战斗风格**取一个母题，避免一图多母题糊掉。
> 品质差异（Q1–Q6）由现有 `variantColor` 兜底文字 + 徽记边框色体现，不出额外图。

---

## 六、完整提示词包（逐字复用，英文出图）

> 槽位表：`{{MOTIF}}` = sword/axe/shield/bow/crossbow/staff/rune/crystal/tower_shield（本次基准批固定 sword）
> `{{ACCENT_COLOR}}` = 按上表类别（本次基准批 steel grey）
> **一次只变一个变量。** 风格锚点段每批完全一致。

**段 1 · 风格锚点（固定）**
```
Painterly 2.5D isometric game emblem overlay, chunky rounded volumes, soft thick-paint shading with smooth brush transitions, no hard outline strokes, warm wood and stone color family, premium casual mobile game building decoration, matching an existing hand-painted cartoon barracks building: rounded volumes, soft golden highlights, no outlines. This is a transparent overlay element only, not a full building.
```

**段 2 · 主体描述**
```
A small decorative emblem representing a {{MOTIF}}, designed to be placed on the flag banner and above the doorway of a cartoon barracks building. Rounded chunky silhouette, soft painted highlights in {{ACCENT_COLOR}}, subtle warm wood undertones, clean negative space, readable at small size. The emblem sits on its own with no building behind it.
```

**段 3 · 约束与禁忌**
```
No text, no letters, no numbers, no glow, no neon, no ray, no beam, no aurora, no cold sci-fi color, no pure white or pure black, no hard black outline, no realistic texture. Do NOT paint a full building, only the isolated emblem decoration. Transparent background only.
```

**段 4 · 输出规格**
```
Square 1:1 canvas, fully transparent alpha background, emblem tightly cropped and centered filling about 70 percent of canvas, clean alpha edges with at most 1px antialiasing, four corners fully transparent, 96x96 output suitable for game atlas.
```

**Negative prompt（整段复用）**
```
text, letter, number, glow, neon, beam, ray, aurora, hard outline, black lineart, realistic, full building, opaque background, white background, pure white, pure black, sci-fi, cyber
```

**参考图**：`assets/buildings/barracks_1.png`（仅风格参考：厚涂圆润、暖木+石基、无描边）

---

## 七、工程接入清单（确认后执行）

1. **资源**：40 张徽记层落 `assets/buildings/barracks_emblems/emblem_XX.png`（96×96）
2. **清单**：`PLACEHOLDER-MANIFEST.csv` 加 40 行 → `node tools/gen-art-manifest.mjs` 重生成 `ArtManifest.js`
3. **ArtLayer**：新增 `pick_barracksEmblem(unitId)`，复用 `getUnitArtIndex(unitId)` 映射（字符串 id，数字兜底）
4. **RenderSystem**：
   - `_artBuilding()` 保持 4 张等级骨架不变
   - `drawFlippedTile()` 在 `_artBuilding()` 成功后，追加一层 `_art(emblemKey, ...)` 叠在旗面/门楣位置
   - `FORMAL_BUILDING_KEYS` 加 40 个徽记 key 或改前缀判断（绕过水印守卫）
5. **敌方兵营**：`Building._initFromRace()` 补 `unitId`（否则敌方只能显示通用兵营）
6. **测试**：新增守护测试断言字符串 unitId → 徽记 key 映射、manifest 40 key 齐全、白名单覆盖；跑全量回归
7. **实拍**：430×932 + 安全区，进场看至少 3 座不同兵种兵营的徽记是否清晰、不遮挡等级字

---

## 八、预算表（数字口径）

| 项 | 当前 | 方案 C 新增 | 方案 A 对照 |
|---|---|---|---|
| 兵营图 | 4 张 × 163KB = 0.65MB | 0 | +6.4MB |
| 兵种徽记 | — | 40 × 8–15KB = **0.32–0.6MB** | — |
| 运行时开销 | 1 draw/兵营 | +1 draw/兵营（同屏 ~40 座 → +40 draw） | 0 |
| 解码内存 | — | 40 × 96×96×4 ≈ 1.5MB | 40 × 312×312×4 ≈ 15.6MB |

> 同屏 +40 draw 对 Canvas 2D 可接受；若实测卡顿，可改为「徽记预合成到兵营图」的离线方案（40×4 张但只加载当前等级，包体按需）。

---

## 九、验收标准（逐项打勾）

- [ ] 40 张徽记 96×96 RGBA，四角 alpha=0，主体 alpha=255
- [ ] 与 `barracks_1` 风格同族：厚涂圆润、无硬描边、暖木+石色系
- [ ] 4 类母题（近战/远程/法术/防御）可辨识，同类别内 8–15KB/张
- [ ] manifest 40 key 齐全，`_art()` 不静默失败
- [ ] 字符串 unitId 正确映射徽记（含刚修的立绘映射同款口径）
- [ ] 水印花名单放行，徽记不被拦成 emoji
- [ ] 不影响等级字与品质兜底文字可读性
- [ ] 全量回归通过（当前基线 111/111）+ 430×932 实拍

---

## 十、待确认项

**假设：采用方案 C（骨架 + 徽记层），不重画 4 张等级兵营（待确认）**
**假设：徽记按 combatStyles 四类母题聚类，品质差异靠现有 variantColor 兜底而非额外出图（待确认）**
**假设：先出 1 个兵种（swordsman / 剑徽记）基准批锁风格，确认后再放量 40 张（待确认）**
**假设：敌方兵营也显示徽记，需补 unitId 字段（待确认）**
**假设：新增资源落在 assets/ 分包，运行时按需加载（待确认）**

---

## 十一、已确认 / 待定分界

| 已确认（不得擅自改动） | 待定（本次提案） |
|---|---|
| 现有 `barracks_1~4` 等级骨架与风格 | 是否用方案 C 的徽记层 |
| 40 兵种 key、combatStyles 分类 | 四类母题的具体视觉 |
| 字符串 unitId → getUnitArtIndex 映射（刚修复） | 敌方兵营是否也显示徽记 |
| 包体红线：assets/ 已 12MB，主包 4MB 上限 | 是否接受 +0.5MB 增量 |
