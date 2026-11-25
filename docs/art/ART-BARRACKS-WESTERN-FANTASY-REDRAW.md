# 占地之王 · 兵营「西方奇幻去中式 + 立绘母题重绘」方案

> 状态：**已交付（2026-11-25）**。5 张基准确认后放量 21 张，26 座全部重绘完成并覆盖 assets。详见 `.workbuddy/artifacts/兵营26座西幻去中式重绘交付-2026-11-25.md`。
> 需求原话：「1、重绘以下建筑，从兵种立绘中汲取灵感：弓箭手、斥候、民兵、盾兵、骑士、狂战士、骷髅兵、战士、牧师（类似教堂）、卫兵、海盗、游侠（房屋改为帐篷）、长枪兵、神射手（改为类似靶场）、战车（类似罗马跑场）、驯兽师（突出兽笼表现）、刽子手、战斗法师、十字军、死灵法师（房屋改为类似墓地）、吸血鬼（哥特式城堡）、风暴法师（突出雷电）、凤凰（类似鸟类巢穴）、幼龙（突出蛋的表现）、战争泰坦、古龙。2、我们这是西方奇幻题材，完全去除中式建筑表现」
> 日期：2026-11-25
> 前置：`docs/art/ART-BARRACKS-FULL-REDRAW-PROPOSAL.md`（当前 40 张的上一版方案）

---

## 一、结论先行

**当前 26 座兵营的最大问题不是细节，是建筑语汇跑到了东方。** 上一版提示词只写「fantasy barracks / warm wood」，模型默认回落成**金色宝塔、翘角亭、飞檐瓦顶、东方楼阁**——这是"泛东方卡通"的默认输出，与游戏的西方奇幻题材冲突。对照图（`.workbuddy/art-staging/barracks-textonly-v3/UNIT-BARRACKS-COMPARE.png`）可复核：斥候/狂战士/卫兵/刽子手/古龙是重灾区。

**本次两项硬改动**：① **把建筑语汇锁死在西方奇幻**——正向写死石砌/尖顶/石板瓦/拱门/哥特/罗马柱/木构架/茅草，Negative 明确排除 pagoda / Chinese roof / upturned eaves / 斗拱 / 牌坊 / 中式窗棂 / 宫灯；② **从立绘提取每兵种的识别母题**（配色 + 武器 + 头部/坐骑特征）反哺建筑，让兵营和立绘是"同一套东西"。用户点名的 10 处特殊形态（帐篷/靶场/罗马跑场/兽笼/教堂/墓地/哥特城堡/雷电/鸟巢/蛋）逐条落实。

**先出 5 张跨类型基准**（游侠帐篷 / 神射手靶场 / 死灵墓地 / 吸血鬼哥特城堡 / 古龙西幻龙殿），覆盖所有特殊形态类型 + 最严重的去中式验证点，确认后再放量 21 张。

---

## 二、现状评审（可复核）

对照图 `UNIT-BARRACKS-COMPARE.png`，26 座中：

| 类型 | 编号 | 问题 |
|---|---|---|
| **中式重灾区** | 04 斥候 / 10 狂战士 / 15 卫兵 / 27 刽子手 / 40 古龙 | 金色多层塔 + 翘角飞檐 + 宝顶，读成东方楼阁/宝塔 |
| **泛东方瓦顶** | 02 弓箭手 / 08 盾兵 / 12 战士 / 19 长枪兵 / 23 战车 / 24 驯兽师 / 28 战斗法师 / 35 风暴法师 | 弧形瓦顶 + 金色檐口 + 东方屋脊装饰 |
| **形态与立绘脱节** | 全 26 座 | 立绘有明确的橙红狂战士/白袍牧师/紫袍死灵/黑红吸血鬼/火凤凰/蓝幼龙，但兵营一律"金瓦木屋 + 一个标志物"，没有从立绘汲取配色与母题 |

**评审结论：重做**（形态 + 建筑语汇双不过关）。不是加个十字架/拱门能救，必须从提示词层把"东方默认"替换为"西幻默认"。

---

## 三、冻结不变（保证同族，与上一版一致）

| 维度 | 冻结值 |
|---|---|
| 视角 | 高位 2.5D 等距，顶面 + 正面 + 右侧面同框，无透视漂移 |
| 占画比例 | 主体含底座占画布宽 82% ± 4%，垂直居中偏下 |
| 底座 | 同一椭圆碎石台，米白石 + 暖灰缝 |
| 光照 | 统一左上主光，顶面最亮、正面中间、右侧面最暗 |
| 明度阶梯 | 顶面 L170–200 / 正面 L120–150 / 侧面 L85–110 |
| 笔触 | 圆润厚涂，软过渡，无硬描边、无线稿（Q 版卡通，不写实） |
| 巨型特征物 | 每座有且只有一个占主体 ≥35% 高的特征物，缩略图可辨 |
| 出图底 | 品红/深蓝紫底（混元实出色不固定），连通域 + 色相清理抠图 |
| 尺寸 | 312×312 RGBA，透明底，四角 alpha=0 |

**变化层**：建筑本体形制（西幻化）+ 材质（石/木/铁/骨）+ 识别色（跟立绘）+ 巨型特征物（跟立绘母题）。

---

## 四、去中式 · 风格锚点（新增，逐字复用）

> 这是本轮最关键的段。上一版只有「warm palette」没有建筑风格锁定，导致模型默认回东方。本版正向写死西幻要素 + 强 Negative 排除东方要素。

### 段 1 · 风格锚点（新，替换上一版）

```
Painterly 2.5D isometric game building, high three-quarter view showing roof, front and right side in one frame, chunky rounded volumes with soft thick-paint shading and smooth brush transitions, no hard outlines, no lineart. STRICTLY WESTERN FANTASY MEDIEVAL ARCHITECTURE: stone masonry walls, steep pitched roofs with slate or wooden shingles, pointed gables, rounded arches, Romanesque columns, timber-framed construction, thatch, crenellations, Gothic spires and buttresses. Warm sunny palette of honey timber, creamy ivory stone, golden highlights and warm brown shadows, with each unit's signature accent color. Consistently left-top key light: brightest roof plane, mid-tone front face, darker right side. The building sits on the same small elliptical crushed-stone pedestal used by the whole building family, made of warm cream stones. Premium hand-painted cartoon mobile game asset, thick rounded brushwork, plump soft forms, clean readable shapes, cheerful candy-like finish. ABSOLUTELY NO East Asian architecture.
```

### 段 4 · 技术约束与禁忌（新，加强东方排除）

```
Pure solid magenta #FF00FF background only, no gradient, no floor shadow cast onto background, no background objects. No text, no letters, no numbers, no logo, no glow, no neon, no beam, no ray, no aurora, no hard black outline, no realistic photo texture, no pure white, no pure black. Sharp clean silhouette with at most 1px antialiasing, suitable for alpha keying. The whole building must be fully inside the frame with transparent-safe margins.
```

### Negative prompt（新，逐字复用）

```
East Asian architecture, Chinese architecture, Japanese architecture, pagoda, Buddhist temple, Chinese roof, curved upturned eaves, flying eaves, tiled roof with ridge ornaments, dougong brackets, paifang gate, Chinese lattice windows, red lacquer pillars, paper lantern, Chinese dragon, Asian pavilion, torii gate, text, letter, number, logo, glow, neon, beam, ray, aurora, hard outline, black lineart, realistic, photo, gradient background, floor shadow, white background, pure white, pure black, sci-fi, cyber, generic hut, same building different color, tiny emblem, small ornament as main identifier, multiple competing focal objects, cold grey, desaturated, bluish tone, washed out, weathered wood, dirty grime, thin flat cel shading, sketchy linework, visible plank gaps, dark cracks
```

> **战象 36 号不在本轮重绘清单**，其石板象灰色相特例继续保留，不套用本段。

---

## 五、26 座形态映射（立绘母题 + 用户指定）

> `{BUILDING}` / `{SIGNATURE}` / `{ACCENT}` 三槽位。MATERIAL/PROP 按行内补充。
> 用户明确指定的 10 处特殊形态用 ★ 标注。

| # | 兵种 | 立绘母题 | 新建筑本体（西幻） | 巨型特征物 | 识别色 |
|---|---|---|---|---|---|
| 02 | 弓箭手 | 红衣女弓手、木弓 | 石砌箭塔 + 木构箭窗 + 锥顶 | 巨型长弓跨塔顶，弓弦作脊线 | 深红 |
| 04 | 斥候 | 绿兜帽、轻装 | 细腿木岗哨 + 帆布小顶（**去金瓦宝塔**） | 巨型黄铜罗盘带指针 | 苔绿 |
| 05 | 民兵 | 褐衣草叉、农夫 | 歪斜木架草棚 + 麻绳捆扎 | 巨型圆木盾宽于门洞 | 麻褐 |
| 08 | 盾兵 | 重甲大盾、蓝灰 | 矮石堡 + 正面盾墙 | 巨型塔盾占正立面 80% | 铁灰 |
| 09 | 骑士 | 银甲蓝缨、剑 | 石砌马厩 + 双坡顶 + 拴马桩（**去翘角**） | 巨型马蹄铁 + 马头石雕 | 骑士蓝 |
| 10 | 狂战士 | 橙红络腮胡、双手斧、兽皮 | 维京长屋 + 兽皮兽骨饰（**去金瓦亭**） | 巨型双刃战斧 | 暗红 |
| 11 | 骷髅兵 | 白骨、剑、破布 | 肋骨拱顶骨屋 + 骨白墙 | 巨型骷髅头眼窝深凹 | 骨白 |
| 12 | 战士 | 银甲剑盾、红缨 | 木栅栏训练场 + 中央木桩 | 巨型带臂木人桩 | 砖红 |
| 14 | 牧师 ★ | 白袍白须、金边圣书 | **白石小教堂**：尖顶钟楼 + 拱窗 + 十字架 | 巨型铜钟 | 奶白+金 |
| 15 | 卫兵 | 蓝甲、剑、头盔 | 西式石砌门楼 + 垛口 + 城门闸栅（**去东方城楼**） | 巨型长戟 | 石灰蓝 |
| 16 | 海盗 | 红头巾、弯刀、条纹衫 | 翻覆船体作顶 + 桅杆旗 | 巨型船锚 | 海蓝 |
| 18 | 游侠 ★ | 金发绿斗篷、长弓 | **林间帐篷**：绿色帆布帐篷 + 木杆 + 藤蔓（**房屋改帐篷**） | 巨型长弓 + 斜挂箭袋 | 森绿 |
| 19 | 长枪兵 | 蓝甲、长枪、盾 | 方石塔 + 枪林尖顶（**去金檐**） | 三支巨型枪尖扇形排列 | 青铜 |
| 20 | 神射手 ★ | 蓝白装、蓝头巾、长弓 | **靶场**：木栅栏 + 多层箭靶 + 射击棚（**改靶场**） | 巨型红白同心圆靶心 | 亮金 |
| 23 | 战车 ★ | 棕马战车、蓝旗 | **罗马跑场**：椭圆形沙地赛道 + 石看台 + 拱门（**类似罗马跑场**） | 巨型带辐战车轮 + 蓝旗 | 战红 |
| 24 | 驯兽师 ★ | 橙棕兽皮、圆盾、长矛 | 木栅栏围场 + **突出兽笼**（铁栏兽笼 + 鞍具） | 巨型弯曲兽角 | 土橙 |
| 27 | 刽子手 | 黑红甲、大斧 | 高木台 + 暗红布幔 + 巨刃砧（**去金瓦塔**） | 巨型斧刃 | 暗酒红 |
| 28 | 战斗法师 | 蓝紫法袍、法杖 | 符文熔炉工坊 + 铁烟囱 + 拱门 | 巨型符文法杖 | 熔橙 |
| 30 | 十字军 | 白金甲、十字盾 | 十字军石堡 + 盾墙 + 十字旗（**去翘角**） | 巨型十字盾 | 圣白金+红 |
| 31 | 死灵法师 ★ | 紫袍骷髅面具、绿魂灯 | **墓地**：歪斜墓碑群 + 铁栅栏 + 石棺小教堂（**房屋改墓地**） | 巨型骷髅 + 倾倒墓碑 | 暗紫 |
| 32 | 吸血鬼 ★ | 白面尖耳、黑红燕尾服 | **哥特城堡**：尖塔 + 飞扶壁 + 铁栅门 + 石棺（**哥特式**） | 巨型展翼蝙蝠 | 暗酒红 |
| 35 | 风暴法师 ★ | 白须紫袍、双手雷电 | 层叠旋涡石塔 + 铜风铃 + **突出雷电** | 巨型四叶风车 + 缠绕闪电 | storm 青灰 |
| 37 | 凤凰 ★ | 火红金羽展翼 | **鸟类巢穴**：巨型树枝鸟巢 + 火焰形羽饰（**类似鸟巢**） | 巢中巨型火纹蛋 + 火焰羽冠 | 暖橙红 |
| 38 | 幼龙 ★ | 蓝紫圆润小龙 | 山洞石窟 + 龙鳞石瓦 + **突出蛋** | 洞口巨型龙鳞蛋（**突出蛋**） | 翠绿+金 |
| 39 | 战争泰坦 | 岩甲巨人、巨力 | 巨岩基座 + 巨足石阶（非人像） | 巨型石拳撑住平台 | 花岗岩灰 |
| 40 | 古龙 ★ | 红鳞巨翼龙 | **西幻龙殿**：巨石神殿 + 龙骨尖顶 + 石翼浮雕（**去中式宫殿**） | 巨型龙首石雕 | 青铜+暗金 |

---

## 六、批次与预算

| 批次 | 数量 | 内容 | 校验 |
|---|---|---|---|
| 基准 | 5 | 14 教堂 / 18 帐篷 / 31 墓地 / 32 哥特城堡 / 40 龙殿 | 出图→抠底→拼版→**用户确认西幻化是否到位** |
| 放量 | 21 | 其余 21 座 | 每批拼版 + 10% 缩略图 + 对照立绘检查 |

- 成本：26 张 × 5–10 积分 ≈ 130–260 积分（基准 5 张约 25–50）。
- 体积：换图不换尺寸，40 张合计仍约 4.5MB，无预算风险。
- 工程零改动：文件名 / manifest key / 白名单 / 接线 / 测试全不动。

## 七、验收标准

1. **去中式（本轮最高优先级）**：26 张不得出现翘角飞檐 / 宝塔 / 宫灯 / 斗拱 / 牌坊 / 中式窗棂；对照图与上一版比对确认东方语汇清除。
2. **西幻成立**：石砌/尖顶/拱门/哥特/罗马等西幻要素清晰可辨。
3. **立绘母题呼应**：每座兵营的识别色/特征物能与对应兵种立绘对上（如狂战士斧、死灵骷髅灯、吸血鬼蝙蝠、幼龙蛋）。
4. **用户指定 10 处形态**逐条落实（帐篷/靶场/罗马跑场/兽笼/教堂/墓地/哥特城堡/雷电/鸟巢/蛋）。
5. 规格 40/40、剪影可辨、缩略图、风格一致性、禁忌复核同上一版。
6. 回归 123/123。

## 八、待确认项

**假设：26 座全部重绘，其余 14 座（01/03/06/07/13/17/21/22/25/26/29/33/34/36）保持现状不动（待确认）**
**假设：先出 5 张基准确认去中式效果，再放量 21 张（待确认）**
**假设：10 处特殊形态按第五节字面执行（待确认）**
**假设：文件名/manifest/接线/测试零改动，只换 PNG（待确认）**
