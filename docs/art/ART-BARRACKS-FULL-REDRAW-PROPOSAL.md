# 占地之王 · 兵营「按兵种特征彻底重绘」方案

> 状态：**待用户确认**。确认后才进入出图，不提前生成。
> 需求原话：「兵营之间的差异太小了要依据兵种特点进行完全的重绘」
> 日期：2026-11-25
> 前置：`docs/art/ART-BARRACKS-PER-UNIT-PROPOSAL.md`（上一版 40 张已交付，本方案是它的推翻重做）

---

## 一、结论先行

**上一版失败的根因不是细节不够，是形态没变。** 40 张图共用同一个木屋剪影、同一套屋顶、同一个门、同一块石基，只有旗色和门口挂件不同——缩到 10% 后 40 张几乎无法分辨，属于「同一资产的 40 种涂装」，不满足「不同兵种的兵营」这条需求。

**本次重绘的核心改动：把变化的层级从「涂装」提到「建筑本体」。** 每个兵种的营房是一座功能与形态都对应该兵种的不同建筑（剑士=剑刃训练棚、弓箭手=高脚箭楼、蒸汽坦克=铆钉铁工坊、战象=超大拱形兽舍、古龙=龙脊神殿……）。风格语言（视角、比例、光照、笔触、底座、配色体系）继续冻结不变，保证 40 张还是同一套东西。

**先出 4 张跨类型基准（剑士 / 弩手 / 冰法师 / 战象），确认风格与差异都成立后再放量 36 张。**

---

## 二、现状诊断（可复核）

| 维度 | 上一版实际 | 问题 |
|---|---|---|
| 剪影 | 40 张全部为同一坡顶木屋 + 同一椭圆石基 | 涂黑后 40 张剪影近似相同，10% 缩略图测试不通过 |
| 结构 | 屋顶、门、窗、木梁的位置全图一致 | 玩家读到的是「同一个建筑换了颜色」 |
| 差异载体 | 旗面图案、旗色、门口小道具 | 差异集中在画面 <8% 的面积，主视区没有信息 |
| 材质 | 全部暖木 + 石基 | 巨兽、机械、亡灵、法术兵种没有材质区分 |
| 色相 | Q1–Q6 按品质分旗色组 | 色相跟品质走而不是跟兵种走，进一步削弱识别 |
| 单张体积 | 119–149KB，40 张合计约 4.96MB | 重绘后预计上升，需按第五节预算卡线 |

**评审结论：重做**（不是小改）。原因：剪影和风格表现层里的「形态」不过关，调明度或加挂件救不回来。

---

## 三、重绘原则：变什么 / 不变什么

### 3.1 冻结不变（保证同族）

| 维度 | 冻结值 |
|---|---|
| 视角 | 高位 2.5D 等距，顶面 + 正面 + 右侧面同框，无透视漂移 |
| 占画比例 | 主体含底座占画布宽 82% ± 4%，垂直居中偏下 |
| 底座 | 同一椭圆碎石台，直径约为主体宽 88%，米白石 + 暖灰缝 |
| 光照 | 统一左上主光，顶面最亮、正面中间、右侧面最暗 |
| 明度阶梯 | 顶面 L170–200 / 正面 L120–150 / 侧面 L85–110 |
| 笔触 | 圆润厚涂，软过渡，无硬描边、无线稿 |
| 色域 | 主色仍落在暖木棕 / 米白石 / 金高光体系内；冷色只作兵种识别色，饱和度 ≤ 0.55 |
| 出图底 | 纯品红 `#FF00FF`，无渐变、无投影到背景，连通域抠图（`tools/remove-bg-connected.py`） |
| 尺寸 | 312×312 RGBA，透明底，四角 alpha=0 |

### 3.2 彻底变化（产生识别）

| 变化层 | 要求 |
|---|---|
| 建筑本体剪影 | 屋顶形制、主体高宽比、层数由兵种决定；40 张至少 32 张剪影互不相同 |
| 结构类型 | 棚 / 塔 / 堡 / 厩 / 工坊 / 巢 / 窟 / 殿 / 台 / 船 / 车 库 / 兽舍 等，不只木屋 |
| 材质 | 木、茅草、石、铁、冰、骨、青铜、树皮、岩石按兵种选；同族内材质可混搭 |
| 功能陈设 | 与兵种职业技能直接相关（武器架、靶场、熔炉、星盘、马槽、投石器、兽笼……） |
| 旗与标识 | 旗形、旗色跟兵种走（不再跟品质走），无文字无符号化品牌 |
| 识别色 | 每兵种 1 个主识别色，出现面积 ≥ 画面 12%（旗 + 屋顶 + 陈设），保证缩略图可辨 |

---

## 四、40 兵种建筑形态映射表（本次交付核心）

> 说明：`建筑本体` 是提示词里 `{BUILDING}` 的取值来源；`识别色` 只给色相方向，明度饱和度按冻结值执行。
> 归属批次用于产能与校验，A=基准批。

| # | 兵种 | 建筑本体（一句话可执行） | 材质 | 识别色 | 关键陈设 | 批次 |
|---|---|---|---|---|---|---|
| 01 | 剑士 | 双柄巨剑交叉作屋顶的矮训练棚 | 暖木 + 钢 | 钢灰 | 木人靶、剑架 | A |
| 02 | 弓箭手 | 细高木箭楼，草檐顶，三面箭窗 | 木 + 茅草 | 深绿 | 箭袋、靶心 | 1 |
| 03 | 枪兵 | 长枪斜靠成栅栏顶的狭长枪械棚 | 木 + 钢 | 赭红 | 成排长枪 | 1 |
| 04 | 斥候 | 细腿树顶瞭望台，帆布小顶 | 木 + 帆布 | 土黄 | 风旗、号角 | 1 |
| 05 | 民兵 | 矮宽歪斜茅草棚，麻绳捆扎 | 木 + 茅草 | 麻褐 | 草垛、木盾 | 1 |
| 06 | 投石兵 | 半开放石堆工棚，粗木投石臂 | 石 + 木 | 灰蓝 | 圆石堆、投石机 | 1 |
| 07 | 学徒 | 小书斋，卷轴形屋脊，斜屋顶 | 木 + 米石 | 靛蓝 | 书堆、羽毛笔 | 1 |
| 08 | 盾兵 | 正面用一排大盾作墙的矮石堡 | 石 + 木盾 | 铁灰 | 盾墙、短矛 | 1 |
| 09 | 骑士 | 宽木马厩，双坡顶，门外拴马桩 | 木 + 石 | 栗棕 | 马槽、马蹄铁 | 2 |
| 10 | 狂战士 | 粗木劈柴棚，兽骨屋脊 | 粗木 + 骨 | 暗红 | 巨斧砧、碎木堆 | 2 |
| 11 | 骷髅兵 | 肋骨拱顶的骨屋，墙体骨白 | 骨 + 灰石 | 骨白 | 骨堆、小墓碑 | 2 |
| 12 | 战士 | 围栏式训练场，中央木桩 | 木 + 沙地 | 砖红 | 兵器架、木桩 | 2 |
| 13 | 猎人 | 树枝搭的林间猎屋，兽皮挂墙 | 树皮 + 木 | 苔绿 | 鹿角、兽皮 | 2 |
| 14 | 牧师 | 小白礼拜堂，单钟楼，花窗 | 白石 + 木 | 奶白 + 金 | 钟、圣杯 | 2 |
| 15 | 卫兵 | 厚石门楼，顶部垛口，旁设岗亭 | 灰石 | 石灰 | 闸栅、长戟 | 2 |
| 16 | 海盗 | 翻覆船体作屋顶的船形营，桅杆旗 | 旧木 + 缆绳 | 海蓝 | 木桶、缆绳 | 2 |
| 17 | 弩手 | 屋顶装巨型弩机的木工坊 | 木 + 钢 | 深橄榄 | 墙挂弩、弩箭箱 | B |
| 18 | 游侠 | 树叶顶林中隐庐，藤蔓缠柱 | 木 + 树叶 | 森绿 | 弓、箭袋 | B |
| 19 | 长枪兵 | 高挑枪林屋顶的方塔，枪尖成排 | 木 + 钢 | 青铜 | 枪阵、盾牌 | B |
| 20 | 神射手 | 窄高靶塔，多层靶心，顶置风旗 | 石 + 木 | 亮金 | 靶心、观测台 | B |
| 21 | 冰法师 | 蓝白冰棱尖顶法塔，霜纹石基 | 冰晶 + 石 | 冰蓝 | 冰棱、霜纹 | B |
| 22 | 圣堂武士 | 白石柱 + 金色小穹顶的圣殿 | 白石 + 金 | 金白 | 彩窗、圣灯 | 3 |
| 23 | 战车 | 半开放车库，车头露出，轮形屋饰 | 木 + 铁 | 战红 | 车轮、车辕 | 3 |
| 24 | 驯兽师 | 木栅栏围场，内有兽笼与鞍具 | 木 + 绳 | 土橙 | 兽笼、骨头 | 3 |
| 25 | 法师 | 圆锥紫顶法师塔，塔顶星象仪 | 石 + 木 | 紫罗兰 | 魔法书、星盘 | 3 |
| 26 | 圣骑士 | 白金圣骑营，拱廊 + 铠甲架 | 白石 + 金 | 白金 | 铠甲、旗帜 | 3 |
| 27 | 刽子手 | 高木台 + 巨刃砧，暗红布幔 | 深木 + 铁 | 暗酒红 | 巨刃、木砧 | 3 |
| 28 | 战斗法师 | 符文熔炉工坊，铁烟囱 | 铁 + 石 | 熔橙 | 熔炉、符文砧 | 3 |
| 29 | 大法师 | 多层圆塔，顶部星盘与符石 | 石 + 铜 | 深紫 | 星盘、符石 | 3 |
| 30 | 十字军 | 石堡 + 盾墙 + 十字旗 | 灰石 + 铁 | 圣白 + 红 | 盾墙、战旗 | 3 |
| 31 | 死灵法师 | 墓园中的暗紫石塔，墓碑环绕 | 暗石 + 骨 | 暗紫 | 墓碑、烛台 | 4 |
| 32 | 吸血鬼 | 尖塔古堡，铁栅门，石棺门廊 | 黑石 | 暗酒红 | 石棺、蝙蝠纹 | 4 |
| 33 | 蒸汽坦克 | 铆钉铁工坊，双烟囱，外露齿轮 | 铁 + 铜 | 青铜 + 煤灰 | 齿轮、蒸汽白雾 | 4 |
| 34 | 死亡骑士 | 黑铁骸堡，断剑旗，骨饰屋檐 | 黑铁 + 骨 | 墨黑 + 暗红 | 断剑、骨饰 | 4 |
| 35 | 风暴法师 | 层叠旋涡状石塔，铜风铃 | 灰石 + 铜 | storm 青灰 | 风铃、云纹浮雕 | 4 |
| 36 | 战象 | 超大拱形兽舍，象牙形门柱，粗木栏 | 粗木 + 石 | 象牙白 + 土棕 | 鞍具、草料 | A |
| 37 | 凤凰 | 树枝巨巢，火焰形屋顶，巢中蛋 | 树枝 + 铜 | 暖橙红 | 巢、蛋、火纹瓦 | 4 |
| 38 | 幼龙 | 山洞形石窟，龙鳞瓦，洞内宝藏 | 岩石 + 金 | 翠绿 + 金 | 龙蛋、金币堆 | 4 |
| 39 | 战争泰坦 | 巨岩基座 + 巨足石阶，非完整人像 | 巨岩 | 花岗岩灰 | 石阶、断柱 | 4 |
| 40 | 古龙 | 巨大龙脊神殿，脊椎尖顶 + 石翼浮雕 | 古石 + 铜 | 青铜 + 暗金 | 龙蛋、石翼 | 4 |

**批次 A（基准 4 张）**：01 剑士（木棚）、17 弩手（机械工坊）、21 冰法师（法塔）、36 战象（异形兽舍）。这 4 张覆盖「木 / 铁 / 冰 / 异形」四种结构，能验证风格锚点是否锁得住。

---

## 五、提示词包（四段结构，逐字复用）

> 槽位表：`{BUILDING}` = 第四节表格里的「建筑本体」整句（英文写法见下）；`{MATERIAL}` = 材质；`{ACCENT}` = 识别色；`{PROP}` = 关键陈设。
> **一次只变一个变量。** 风格锚点段、约束段、规格段每批完全一致，不许凭记忆改写。

### 段 1 · 风格锚点（固定，逐字复用）

```
Painterly 2.5D isometric game building, high three-quarter view showing roof, front and right side in one frame, chunky rounded volumes with soft thick-paint shading and smooth brush transitions, no hard outlines, no lineart. Warm wood and cream stone palette with soft golden highlights, matching an established hand-painted casual mobile game art style. Consistent left-top key light: brightest roof plane, mid-tone front face, darker right side. The building sits on the same small elliptical crushed-stone pedestal used by the whole building family. Premium cartoon mobile game asset, clean readable shapes.
```

### 段 2 · 主体描述（每图替换槽位）

```
A {BUILDING} for a fantasy unit barracks. Constructed from {MATERIAL}, with {ACCENT} as the dominant accent color covering roof and signage. Surrounded by {PROP}. The architecture itself must clearly express this unit's role, not just a color swap on a generic wooden hut. Distinctive silhouette compared to other barracks in the same family.
```

> `{BUILDING}` 英文写法示例（基准批，逐字使用）：
> - 01: `low training shed whose crossed oversized sword hilts form the roof ridge`
> - 17: `wooden workshop with a giant crossbow mechanism mounted as the roof`
> - 21: `tall ice-spire mage tower with frosted stone base`
> - 36: `oversized arched beast stable with tusk-shaped door posts and thick timber rails`

### 段 3 · 画布与构图（固定）

```
Square 1:1 canvas, building centered slightly low, full building including the elliptical stone base fills about 82 percent of canvas width, 8 to 10 percent clean margin on all sides, no cropping, no perspective drift, flat even framing.
```

### 段 4 · 技术约束与禁忌（固定）

```
Pure solid magenta #FF00FF background only, no gradient, no floor shadow cast onto background, no background objects. No text, no letters, no numbers, no logo, no glow, no neon, no beam, no ray, no aurora, no hard black outline, no realistic photo texture, no pure white, no pure black. Sharp clean silhouette with at most 1px antialiasing, suitable for alpha keying. The whole building must be fully inside the frame with transparent-safe margins.
```

**Negative prompt（整段复用）**

```
text, letter, number, logo, glow, neon, beam, ray, aurora, hard outline, black lineart, realistic, photo, gradient background, floor shadow, white background, pure white, pure black, sci-fi, cyber, generic wooden hut, same building different color
```

**参考图**：`assets/buildings/barracks_1.png`（仅作风格语言参考：厚涂、圆润、无描边、底座与光照；**不得照抄木屋形态**）
**后处理**：`python tools/remove-bg-connected.py <input.png> --output <output.png>`（禁用全局阈值脚本，浅色雪顶/骨白/石基会被挖穿）

---

## 六、批次计划与预算

| 批次 | 数量 | 内容 | 校验动作 |
|---|---|---|---|
| A 基准 | 4 | 剑士 / 弩手 / 冰法师 / 战象 | 出图 → 抠底 → 40 图混排缩略图 → 用户确认 |
| 1 | 8 | 02–08（基础近战与远程） | 每批出接触表 + 10% 缩略图 + 灰度检查 |
| 2 | 8 | 09–16（Q1–Q2 职能营） | 同上 |
| B | 4 | 17–21（弩手到冰法） | 同上 |
| 3 | 9 | 22–30（圣堂到十字军） | 同上 |
| 4 | 7 | 31–40（暗系到古龙，含 36 已出） | 同上 |

**体积预算（数字口径，需实测复核）**

| 项 | 上一版 | 本次预计 | 说明 |
|---|---|---|---|
| 单张 | 119–149KB（均 127KB） | 140–190KB | 形态更复杂、材质更多，透明区压缩抵消一部分 |
| 40 张合计 | 4.96MB | 5.6–7.6MB | 增量 +0.6~2.6MB |
| 解码内存 | 40 × 312² × 4 ≈ 15.6MB | 同左 | 尺寸不变，内存不变 |
| 工程改动 | 已接线 | **0** | 文件名与 key 不变，只替换 png 内容 |

> `assets/` 当前 20MB。若出图后总包体逼近平台上限，按「优先压缩暗色大图 → 再考虑 WebP（需真机实测）」顺序处理，**不靠降低尺寸**解决。此项标「需实测验证（低端机型）」。

**工程零改动**：保留 `assets/buildings/barracks_unit_01~40.png` 文件名、`ArtManifest` 前缀、`FORMAL_BUILDING_KEYS` 白名单、`getUnitArtIndex()` 映射与全部测试。本次只换图，不动代码。

---

## 七、验收标准（逐项打勾）

1. 40 张 312×312 RGBA，四角 alpha=0，主体 alpha=255，无边缘杂色。
2. **剪影测试**：40 张涂黑后至少 32 张可互相区分；不足则回到形态层重画，不加挂件糊弄。
3. **10% 缩略图测试**：40 张混排，2 秒内可指出至少 32 张的兵种类别；识别依据是建筑主体，不是旗色。
4. **风格一致性**：底座形状、等距视角、光照方向、明度阶梯、无描边厚涂，40 张全部一致。
5. **特征对应**：每兵种陈设与 `config/deployables.json` 的 `_doc` / `special` 对应（例：投石兵有投石器、死灵法师有墓碑、蒸汽坦克有齿轮烟囱）。
6. **禁忌复核**：无文字、无霓虹、无 beam/ray/aurora、无纯白纯黑、无品牌元素、无受版权保护形象。
7. **回归**：`node --test "tests/test-*.mjs"` 全量通过（当前基线 119/119）；430×932 + 安全区实拍，进场看至少 3 座不同兵营。
8. **体积**：40 张合计 ≤ 7.6MB；超出则按第六节压缩口径处理并回报数字。

---

## 八、待确认项

**假设：推翻上一版 40 张图的形态，只保留风格语言与底座视角（待确认）**
**假设：按第四节 40 行映射表逐一重绘，建筑本体与兵种职能强绑定（待确认）**
**假设：先出批次 A 的 4 张基准图，确认后再放量 36 张（待确认）**
**假设：文件名、manifest key、工程接线与测试全部不动，只替换 png（待确认）**
**假设：敌方兵营仍走 Lv1–4 通用图（ID 空间不同，强映射会错配）（待确认）**

---

## 九、已确认 / 待定分界

| 已确认（不得擅自改动） | 待定（本方案） |
|---|---|
| 2.5D 卡通厚涂、圆润无描边、暖木+石基风格语言 | 40 张建筑形态映射表是否逐条采纳 |
| 等距视角、椭圆碎石底座、左上光照 | 识别色分配是否要按品质再分层 |
| 312×312 透明底规格与文件名 | 批次 A 的 4 个基准兵种选择 |
| `getUnitArtIndex()` 字符串 unitId 映射 | 体积上限与压缩策略 |
| 敌方兵营通用图兜底 | 是否要同步更新兵种小图的背景以呼应新兵营 |
