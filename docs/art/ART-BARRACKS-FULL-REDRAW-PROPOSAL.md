# 占地之王 · 兵营「按兵种特征彻底重绘」方案

> 状态：**待用户确认**。确认后才进入出图，不提前生成。
> 需求原话：「兵营之间的差异太小了要依据兵种特点进行完全的重绘」
> 日期：2026-11-25
> 前置：`docs/art/ART-BARRACKS-PER-UNIT-PROPOSAL.md`（上一版 40 张已交付，本方案是它的推翻重做）

---

## 一、结论先行

**上一版失败的根因不是细节不够，是形态没变。** 40 张图共用同一个木屋剪影、同一套屋顶、同一个门、同一块石基，只有旗色和门口挂件不同——缩到 10% 后 40 张几乎无法分辨，属于「同一资产的 40 种涂装」，不满足「不同兵种的兵营」这条需求。

**本次重绘的核心改动：把变化的层级从「涂装」提到「建筑本体」。** 每个兵种的营房是一座功能与形态都对应该兵种的不同建筑（剑士=剑刃训练棚、弓箭手=高脚箭楼、蒸汽坦克=铆钉铁工坊、战象=超大拱形兽舍、古龙=龙脊神殿……）。风格语言（视角、比例、光照、笔触、底座、配色体系）继续冻结不变，保证 40 张还是同一套东西。

**新增硬约束（2026-11-25 用户补充）：战斗棋盘上建筑显示面积很小，每座兵营必须有且只有一个「巨型特征物」——占建筑视觉主体 35% 以上、优先置于屋顶/正面上方，缩到 10% 仍能一眼认出。典型如学徒书斋顶部的巨型打开书本、弩手工坊屋顶的巨型弩机。小旗标、小挂件不再作为识别载体。**

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
| **巨型特征物（最高优先级）** | **每座建筑有且只有一个压倒性特征物，占建筑高度 ≥35%、画布宽 ≥20%（≥62px/312）；10% 缩略图下仍可辨轮廓。摆放分两种：① 默认「悬空独立」——浮在屋顶上方、与建筑本体有明显空隙、不接触不嵌合（2026-11-25 用户确认剑士/弩手用此式，避免标志物混在房屋上）；② 例外「门楣嵌合」——仅战象保留象头石雕嵌在门楣。详见第四节 `{SIGNATURE}` 列。** |
| 建筑本体剪影 | 屋顶形制、主体高宽比、层数由兵种决定；40 张至少 32 张剪影互不相同。特征物必须参与剪影，不能贴在上面当标签 |
| 结构类型 | 棚 / 塔 / 堡 / 厩 / 工坊 / 巢 / 窟 / 殿 / 台 / 船 / 车库 / 兽舍 等，不只木屋 |
| 材质 | 木、茅草、石、铁、冰、骨、青铜、树皮、岩石按兵种选；同族内材质可混搭 |
| 功能陈设 | 次要陈设（武器架、靶场、熔炉、星盘、马槽、投石器、兽笼……）只做陪衬，面积与亮度均低于巨型特征物，禁止喧宾夺主 |
| 旗与标识 | 旗形、旗色跟兵种走（不再跟品质走），无文字无符号化品牌；旗不得挡住特征物 |
| 识别色 | 每兵种 1 个主识别色，出现面积 ≥ 画面 12%，其中巨型特征物承担至少一半 |

---

## 四、40 兵种建筑形态映射表（本次交付核心）

> 说明：`建筑本体` 是提示词里 `{BUILDING}` 的取值来源；`识别色` 只给色相方向，明度饱和度按冻结值执行。
> 归属批次用于产能与校验，A=基准批。

> `{SIGNATURE}` 是**每张图的第一识别要素**：只允许一个，必须做到「遮住其余部分仍能认出兵种」。次要陈设不得与其争夺视觉中心。

| # | 兵种 | 建筑本体（一句话可执行） | 巨型特征物 `{SIGNATURE}`（最大最显眼） | 材质 | 识别色 | 次要陈设 | 批次 |
|---|---|---|---|---|---|---|---|
| 01 | 剑士 | 带完整坡顶的木训练棚（剑不再作屋顶） | 悬空于屋顶上方的交叉巨型长剑，剑格与剑柄清晰，与建筑有明显空隙不接触 | 暖木 + 钢 | 钢灰 | 木人靶、剑架 | A（重出） |
| 02 | 弓箭手 | 细高木箭楼，草檐顶，三面箭窗 | 横跨屋顶的巨型长弓，弓弦作屋脊线 | 木 + 茅草 | 深绿 | 箭袋、靶心 | 1 |
| 03 | 枪兵 | 长枪斜靠成栅栏顶的狭长枪械棚 | 斜插屋顶的巨型长枪，枪尖 + 红缨 | 木 + 钢 | 赭红 | 成排短枪 | 1 |
| 04 | 斥候 | 细腿树顶瞭望台，帆布小顶 | 塔顶巨型黄铜罗盘，指针明显 | 木 + 帆布 | 土黄 | 风旗、号角 | 1 |
| 05 | 民兵 | 矮宽歪斜茅草棚，麻绳捆扎 | 正面巨型圆木盾，盾面宽于门洞 | 木 + 茅草 | 麻褐 | 草垛 | 1 |
| 06 | 投石兵 | 半开放石堆工棚，粗木投石臂 | 屋顶巨型投石臂 + 一颗大圆石 | 石 + 木 | 灰蓝 | 圆石堆 | 1 |
| 07 | 学徒 | 小书斋，卷轴形屋脊，斜屋顶 | **屋顶一本打开的巨型书籍，书页与书脊清晰（用户指定范例）** | 木 + 米石 | 靛蓝 | 书堆、羽毛笔 | 1 |
| 08 | 盾兵 | 正面用一排大盾作墙的矮石堡 | 正面整面巨型塔盾，占正立面宽 80% | 石 + 木盾 | 铁灰 | 短矛 | 1 |
| 09 | 骑士 | 宽木马厩，双坡顶，门外拴马桩 | 屋顶巨型马蹄铁 + 马头石雕 | 木 + 石 | 栗棕 | 马槽 | 2 |
| 10 | 狂战士 | 粗木劈柴棚，兽骨屋脊 | 屋顶巨型双刃战斧 | 粗木 + 骨 | 暗红 | 碎木堆 | 2 |
| 11 | 骷髅兵 | 肋骨拱顶的骨屋，墙体骨白 | 屋顶巨型骷髅头，眼窝深凹 | 骨 + 灰石 | 骨白 | 骨堆、小墓碑 | 2 |
| 12 | 战士 | 围栏式训练场，中央木桩 | 场心巨型木人桩（带双臂） | 木 + 沙地 | 砖红 | 兵器架 | 2 |
| 13 | 猎人 | 树枝搭的林间猎屋，兽皮挂墙 | 屋顶巨型鹿角 | 树皮 + 木 | 苔绿 | 兽皮 | 2 |
| 14 | 牧师 | 小白礼拜堂，单钟楼，花窗 | 钟楼巨型铜钟 | 白石 + 木 | 奶白 + 金 | 花窗、圣杯 | 2 |
| 15 | 卫兵 | 厚石门楼，顶部垛口，旁设岗亭 | 屋顶巨型长戟 | 灰石 | 石灰 | 闸栅 | 2 |
| 16 | 海盗 | 翻覆船体作屋顶的船形营，桅杆旗 | 正面巨型船锚 | 旧木 + 缆绳 | 海蓝 | 木桶、缆绳 | 2 |
| 17 | 弩手 | 带完整坡顶的木工坊（弩机不再作屋顶） | 悬空于屋顶上方的巨型弩机，弩臂、弩弦与弩箭清晰，与建筑有明显空隙不接触 | 木 + 钢 | 深橄榄 | 弩箭箱 | B（重出） |
| 18 | 游侠 | 树叶顶林中隐庐，藤蔓缠柱 | 屋顶巨型长弓 + 斜挂箭袋 | 木 + 树叶 | 森绿 | 藤蔓 | B |
| 19 | 长枪兵 | 高挑枪林屋顶的方塔 | 屋顶三支巨型枪尖呈扇形排列 | 木 + 钢 | 青铜 | 盾牌 | B |
| 20 | 神射手 | 窄高靶塔，多层靶心，顶置风旗 | 塔顶巨型靶心（红白同心圆） | 石 + 木 | 亮金 | 观测台 | B |
| 21 | 冰法师 | 蓝白冰棱尖顶法塔，霜纹石基 | 塔顶巨型六角冰晶 | 冰晶 + 石 | 冰蓝 | 霜纹 | B |
| 22 | 圣堂武士 | 白石柱 + 金色小穹顶的圣殿 | 穹顶之上巨型金色圣杯 | 白石 + 金 | 金白 | 彩窗、圣灯 | 3 |
| 23 | 战车 | 半开放车库，车头露出，轮形屋饰 | 正面巨型车轮（带辐条） | 木 + 铁 | 战红 | 车辕 | 3 |
| 24 | 驯兽师 | 木栅栏围场，内有兽笼与鞍具 | 屋顶巨型弯曲兽角 | 木 + 绳 | 土橙 | 兽笼、骨头 | 3 |
| 25 | 法师 | 圆锥紫顶法师塔，塔顶星象仪 | 塔顶巨型水晶球 + 尖顶巫师帽 | 石 + 木 | 紫罗兰 | 魔法书 | 3 |
| 26 | 圣骑士 | 白金圣骑营，拱廊 + 铠甲架 | 屋顶巨型金盾与竖剑 | 白石 + 金 | 白金 | 铠甲 | 3 |
| 27 | 刽子手 | 高木台 + 巨刃砧，暗红布幔 | 屋顶巨型斧刃 | 深木 + 铁 | 暗酒红 | 木砧 | 3 |
| 28 | 战斗法师 | 符文熔炉工坊，铁烟囱 | 屋顶巨型符文法杖 | 铁 + 石 | 熔橙 | 熔炉 | 3 |
| 29 | 大法师 | 多层圆塔，顶部星盘与符石 | 塔顶巨型星盘（带黄铜环） | 石 + 铜 | 深紫 | 符石 | 3 |
| 30 | 十字军 | 石堡 + 盾墙 + 十字旗 | 屋顶巨型十字盾 | 灰石 + 铁 | 圣白 + 红 | 盾墙 | 3 |
| 31 | 死灵法师 | 墓园中的暗紫石塔，墓碑环绕 | 塔顶巨型骷髅 + 前方倾倒墓碑 | 暗石 + 骨 | 暗紫 | 烛台 | 4 |
| 32 | 吸血鬼 | 尖塔古堡，铁栅门，石棺门廊 | 屋脊巨型展翼蝙蝠 | 黑石 | 暗酒红 | 石棺 | 4 |
| 33 | 蒸汽坦克 | 铆钉铁工坊，双烟囱，外露齿轮 | 屋顶两个咬合的巨型齿轮 | 铁 + 铜 | 青铜 + 煤灰 | 蒸汽白雾 | 4 |
| 34 | 死亡骑士 | 黑铁骸堡，断剑旗，骨饰屋檐 | 屋顶巨型带角头盔 | 黑铁 + 骨 | 墨黑 + 暗红 | 断剑 | 4 |
| 35 | 风暴法师 | 层叠旋涡状石塔，铜风铃 | 塔顶巨型四叶风车 | 灰石 + 铜 | storm 青灰 | 风铃 | 4 |
| 36 | 战象 | **驯象苑**：粗木+石门楼接半开放围栏，含石沿泥浴池/高架草料架/拴象桩+铁链/遮阳草棚；地面湿泥脚印、散落草料、柱挂象鞍象钩。**不出现真象**（2026-11-25 用户裁决，保持纯建筑资产） | **保留例外并加大**：象头石雕嵌门楣上方，雕出卷鼻+长牙+耳廓，占建筑高约 40% | 粗木 + 石 | 象牙白 + 土棕 | 泥浴池、草料架、铁链、象鞍 | A（三次重出） |
| 37 | 凤凰 | 树枝巨巢，火焰形屋顶，巢中蛋 | 巢中一枚巨型火纹蛋 + 火焰羽冠 | 树枝 + 铜 | 暖橙红 | 火纹瓦 | 4 |
| 38 | 幼龙 | 山洞形石窟，龙鳞瓦，洞内宝藏 | 洞口上方巨型龙鳞蛋 | 岩石 + 金 | 翠绿 + 金 | 金币堆 | 4 |
| 39 | 战争泰坦 | 巨岩基座 + 巨足石阶，非完整人像 | 基座侧面巨型石拳撑住平台 | 巨岩 | 花岗岩灰 | 断柱 | 4 |
| 40 | 古龙 | 巨大龙脊神殿，脊椎尖顶 + 石翼浮雕 | 殿顶巨型龙首石雕 | 古石 + 铜 | 青铜 + 暗金 | 石翼、龙蛋 | 4 |

**批次 A（基准 4 张）**：01 剑士（坡顶训练棚 + **悬空交叉巨剑**）、17 弩手（坡顶木工坊 + **悬空巨型弩机**）、21 冰法师（法塔 + 六角冰晶）、36 战象（重绘粗木兽栏 + 象头仍嵌门楣）。这 4 张覆盖「木 / 铁 / 冰 / 异形」四种结构与四种特征物类型（武器 / 机械 / 元素 / 动物），既验证风格锚点，也验证「棋盘小尺寸下特征物是否一眼可辨」。

**2026-11-25 二次修订（用户评审第一批后确认）**：① 01/17 的标志物不再与房屋混为一体（不做屋顶、不嵌墙），改为**悬空于屋顶上方、有明显空隙**；② 36 战象保留象头嵌门楣，只重绘房屋本体（去橙瓦农舍感，改粗木巨兽棚）；③ 21 冰法师表现通过，**不重出、沿用 v3**。重出 01/17/36 共 3 张。

---

## 五、提示词包（四段结构，逐字复用）

> 槽位表：`{BUILDING}` = 第四节表格里的「建筑本体」整句（英文写法见下）；`{SIGNATURE}` = 第四节「巨型特征物」列的英文描述；`{MATERIAL}` = 材质；`{ACCENT}` = 识别色；`{PROP}` = 次要陈设。
> **一次只变一个变量。** 风格锚点段、构图段、约束段、规格段每批完全一致，不许凭记忆改写。

### 段 1 · 风格锚点（固定，逐字复用）

> **2026-11-25 强化版**：上次纯文生剑士形态对了但风格漂移成冷灰蓝薄涂。本版加入具体暖色色号与「禁止冷灰/风化/线稿」的硬排除，专治纯文生图无参考图时的风格漂移。**4 张基准与后续 36 张必须逐字复用本段，一字不改。**

```
Painterly 2.5D isometric game building, high three-quarter view showing roof, front and right side in one frame, chunky rounded volumes with soft thick-paint shading and smooth brush transitions, no hard outlines, no lineart. STRICTLY WARM PALETTE: golden honey wood, warm amber timber, creamy ivory stone, soft golden highlights and warm brown shadows; the whole asset reads warm and sunny. Never cool grey, never desaturated, never bluish, never weathered or dirty. Consistent left-top key light: brightest warm cream roof plane, mid-tone honey front face, darker warm brown right side. The building sits on the same small elliptical crushed-stone pedestal used by the whole building family, made of warm cream stones. Premium hand-painted cartoon mobile game asset, thick rounded brushwork, plump soft forms, clean readable shapes, cheerful candy-like finish.
```

### 段 2 · 主体描述（每图替换槽位）

```
A {BUILDING} for a fantasy unit barracks. Constructed from {MATERIAL}, with {ACCENT} as the dominant accent color. One dominant oversized signature object dominates the scene: {SIGNATURE}. This single signature object must occupy at least 35 percent of the building height and at least 20 percent of the canvas width; it must read clearly when the image is scaled down to 10 percent. All other details, including {PROP}, are secondary and must stay visually quieter and smaller than the signature object. The architecture itself must clearly express this unit's role, not just a color swap on a generic wooden hut. Distinctive silhouette compared to other barracks in the same family.

**标志物摆放二选一（按槽位 `PLACEMENT` 填，逐字复用）：**
- `FLOAT`（剑士/弩手默认）：The signature object floats in the air above the roof, clearly separated from the building by a visible empty gap; it must NOT touch, rest on, merge into, or form any part of the roof or walls. The building underneath has a complete ordinary sloped roof of its own.
- `LINTEL`（战象例外）：The signature object is mounted above the entrance on the front facade as a carved stone lintel ornament, integrated into the building facade.
```

> `{BUILDING}` / `{SIGNATURE}` 英文写法示例（基准批，逐字使用）：
> - 01: `low complete sloped-roof timber training shed` / `two giant crossed longswords with clearly visible crossguards and hilts, floating as one piece above the roof` — PLACEMENT: FLOAT
> - 17: `complete sloped-roof timber workshop` / `an oversized crossbow with visible limbs, string and loaded bolt, floating as one piece above the roof` — PLACEMENT: FLOAT
> - 21: `tall ice-spire mage tower with frosted stone base` / `a giant six-pointed ice crystal at the tower peak`
> - 36: `an elephant-rearing yard: a rough timber-and-stone gatehouse opening onto a half-open fenced corral, with a stone-rimmed mud wallow pool, a raised hay rack with hay stacks, tethering posts with hanging chains and a small shade canopy; wet muddy footprints and scattered hay on the ground, elephant saddles and hooks hanging on the posts; NO elephant animal present` / `a massive carved stone elephant head with a curled trunk, long ivory tusks and broad ears mounted above the gatehouse entrance, enlarged to about 40 percent of the building height` — PLACEMENT: LINTEL
> - 07（用户指定范例）: `small study hut with sloped roof` / `one giant open book resting on the roof ridge, pages and spine clearly readable`

### 段 3 · 画布与构图（固定）

```
Square 1:1 canvas, building centered slightly low, full building including the elliptical stone base fills about 82 percent of canvas width, 8 to 10 percent clean margin on all sides, no cropping, no perspective drift, flat even framing. The single signature object stays fully inside the frame, keeps a visible empty gap from the building when PLACEMENT is FLOAT, and is never hidden by flags, banners or roof decorations.
```

### 段 4 · 技术约束与禁忌（固定）

```
Pure solid magenta #FF00FF background only, no gradient, no floor shadow cast onto background, no background objects. No text, no letters, no numbers, no logo, no glow, no neon, no beam, no ray, no aurora, no hard black outline, no realistic photo texture, no pure white, no pure black. Sharp clean silhouette with at most 1px antialiasing, suitable for alpha keying. The whole building must be fully inside the frame with transparent-safe margins.
```

**Negative prompt（整段复用）**

```
text, letter, number, logo, glow, neon, beam, ray, aurora, hard outline, black lineart, realistic, photo, gradient background, floor shadow, white background, pure white, pure black, sci-fi, cyber, generic wooden hut, same building different color, tiny emblem, small ornament as main identifier, multiple competing focal objects, signature object hidden by flag, signature object merged into roof, signature object resting on roof, weapon forming the roof, crossbow forming the roof, cold grey, desaturated, bluish tone, washed out, weathered wood, dirty grime, thin flat cel shading, sketchy linework, visible plank gaps, dark cracks, orange clay roof tiles, farm barn
```

**出图路线（2026-11-25 用户拍板：纯文生图 B）**：不传任何参考图（上次 `input_fidelity=medium` 图生图把旧木屋骨架带回来了），纯靠提示词驱动形态。风格统一由「段 1 强化锚点 + Negative 排除冷灰」保证，4 张基准逐字复用同一风格段，只替换 `{BUILDING}` / `{SIGNATURE}` / `{MATERIAL}` / `{ACCENT}` / `{PROP}` 五个槽位。

**参考图（不用于本次出图）**：`assets/buildings/barracks_1.png`（风格标杆，仅供人工目检比对暖色厚涂是否到位；**不出图时不传入，避免带走木屋形态**）
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
3. **巨型特征物测试（最高优先级）**：每张有且只有一个特征物，高度 ≥ 建筑 35%、宽度 ≥ 画布 20%（≥62px/312），置于屋顶或正面上方，未被旗帜遮挡；40 张中有至少 36 张在 10% 缩略图（31×31px）下可凭特征物认出兵种。不达标者重画特征物，不允许靠加小挂件补。
4. **10% 缩略图测试**：40 张混排，2 秒内可指出至少 32 张的兵种类别；识别依据是巨型特征物 + 建筑主体，不是旗色。
5. **风格一致性**：底座形状、等距视角、光照方向、明度阶梯、无描边厚涂，40 张全部一致。
6. **特征对应**：巨型特征物与次要陈设均与 `config/deployables.json` 的 `_doc` / `special` 对应（例：学徒顶部打开的书、投石兵的投石臂、死灵法师的骷髅、蒸汽坦克的咬合齿轮）。
7. **禁忌复核**：无文字、无霓虹、无 beam/ray/aurora、无纯白纯黑、无品牌元素、无受版权保护形象。
8. **回归**：`node --test "tests/test-*.mjs"` 全量通过（当前基线 122/122）；430×932 + 安全区实拍，进场看至少 3 座不同兵营，确认棋盘实际显示尺寸下特征物可读。
9. **体积**：40 张合计 ≤ 7.6MB；超出则按第六节压缩口径处理并回报数字。

---

## 八、待确认项

**假设：推翻上一版 40 张图的形态，只保留风格语言与底座视角（待确认）**
**假设：按第四节 40 行映射表逐一重绘，建筑本体与兵种职能强绑定（待确认）**
**假设：每座建筑只有一个巨型特征物，尺寸 ≥ 建筑高 35% / 画布宽 20%，优先置于屋顶或正面上方（待确认）**
**假设：先出批次 A 的 4 张基准图，确认后再放量 36 张（待确认）**
**假设：文件名、manifest key、工程接线与测试全部不动，只替换 png（待确认）**
**假设：敌方兵营仍走 Lv1–4 通用图（ID 空间不同，强映射会错配）（待确认）**

---

## 九、已确认 / 待定分界

| 已确认（不得擅自改动） | 待定（本方案） |
|---|---|
| 2.5D 卡通厚涂、圆润无描边、暖木+石基风格语言 | 40 张建筑形态与巨型特征物映射表是否逐条采纳 |
| 战斗棋盘建筑显示面积小，需巨型特征物承担第一识别（用户 2026-11-25 明确） | 各兵种特征物具体选型的微调 |
| 等距视角、椭圆碎石底座、左上光照 | 识别色分配是否要按品质再分层 |
| 312×312 透明底规格与文件名 | 批次 A 的 4 个基准兵种选择 |
| `getUnitArtIndex()` 字符串 unitId 映射 | 体积上限与压缩策略 |
| 敌方兵营通用图兜底 | 是否要同步更新兵种小图的背景以呼应新兵营 |
