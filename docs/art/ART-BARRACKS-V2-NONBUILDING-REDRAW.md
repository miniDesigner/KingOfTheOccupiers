# 占地之王 · 兵营 V2「去房屋化 + 形态精确化」定向重绘方案

> 状态：**基准已确认（2026-11-25），放量中（2026-11-26）**。16 座定向重绘，5 张基准通过，剩余 7 张放量 + D 档 4 张补做。
> 需求原话：「弓箭手、骑士（改为马厩）、狂战士（北欧风格）、骷髅兵（完全舍弃砖瓦房屋表现）、长枪兵（改为类似驻扎营地）、海盗（改为船样式）、卫兵、战士、战车（移除轮盘的内容）、驯兽师（舍弃砖瓦房屋）、刽子手、十字军（十字添加盾牌）、凤凰（完全舍弃砖瓦房屋）、幼龙（完全舍弃砖瓦房屋）、战争泰坦（完全舍弃砖瓦房屋）、古龙（西方龙，完全舍弃砖瓦房屋）」
> 补充指令（2026-11-26）：「放剩余7张和D档的4张也要重做」——D 档 4 张由「保持不变」改为「补做」，按同一去房屋化标准执行。
> 日期：2026-11-25（2026-11-26 更新 D 档）
> 前置（已交付、风格锚点来源）：`docs/art/ART-BARRACKS-WESTERN-FANTASY-REDRAW.md`（西幻去中式，0198836）

---

## 一、结论先行

**上一轮解决了「中式→西幻」，这一轮要解决「建筑→场景」。** 现状评审拼版（`.workbuddy/art-staging/western-redraw/REVIEW-16-CURRENT.png`）显示：16 座里 15 座仍是「砖瓦房屋 + 屋顶」，骷髅/凤凰/幼龙/泰坦/古龙这些本该是骨场、巢穴、岩台、龙窟的兵种，全被画成了石砌小屋——这是「泛建筑默认」在作祟，和兵种身份脱节。

**本次三档改动，按用户原话分级执行**：

| 档 | 用户措辞 | 编号 | 做法 |
|---|---|---|---|
| **A 档 · 完全舍弃砖瓦房屋** | 「完全舍弃砖瓦房屋表现」 | 11 / 37 / 38 / 39 / 40 | 零砖墙、零瓦顶、零封闭房屋；改为纯自然场景（露天骨场/树枝巢/岩洞蛋窟/巨岩台/西方龙窟） |
| **B 档 · 舍弃房屋（保留围栏/构筑）** | 「舍弃砖瓦房屋」 | 24 | 去掉房屋，保留木栅+铁笼的野外兽栏 |
| **C 档 · 形态精确化** | 「改为马厩/营地/船样式/移除轮盘/十字加盾牌/北欧风格」 | 09 / 19 / 16 / 23 / 30 / 10 | 主体形态按用户字面重做 |
| **D 档 · 补做（2026-11-26 新增）** | 用户追加「D 档 4 张也要重做」 | 02 / 12 / 15 / 27 | 按同族冻结 + 去房屋化标准重做，形态升级为露天靶场/校场/岗哨门/刑台，不再是「保持不变」 |

**5 张跨档基准已出并通过**：40 古龙（A 档，西方龙窟）、11 骷髅兵（A 档，露天骨场）、16 海盗（C 档，完整船形）、19 长枪兵（C 档，驻扎营地）、38 幼龙（A 档，岩洞蛋窟）。2026-11-26 放量剩余 7 张 + D 档 4 张，共 11 张。

---

## 二、现状评审（可复核）

| 编号 | 兵种 | 当前形态 | 用户要求 | 差距 |
|---|---|---|---|---|
| 02 | 弓箭手 | 石砌箭塔+锥顶 | **补做：露天靶场** | 石塔+锥顶属封闭房屋，重做为露天箭术靶场（草靶+箭垛+巨型长弓） |
| 09 | 骑士 | 石砌马厩+马蹄铁马头 | 改为马厩 | 已有马厩元素但仍是封闭房屋感，需强化开放式马棚/马匹 |
| 10 | 狂战士 | 维京长屋+双刃斧 | 北欧风格 | 有维京感但金瓦过重，需强化龙骨饰/符文/兽皮/深木色 |
| 11 | 骷髅兵 | 骨白哥特教堂（石墙+尖顶+拱窗） | **完全舍弃砖瓦房屋** | 重做：封闭建筑→露天骨场 |
| 12 | 战士 | 木栅训练场 | **补做：露天校场** | 强化沙地校场+兵器架+木人桩阵，去封闭感 |
| 15 | 卫兵 | 石门楼+闸栅+长戟 | **补做：露天岗哨门** | 石门楼改开放式城门关卡+岗亭，无屋顶，巨型长戟更突出 |
| 16 | 海盗 | 翻覆船壳作顶+桅杆旗 | 改为船样式 | 重做：翻覆船顶→完整船身+桅杆+帆 |
| 19 | 长枪兵 | 方石塔+三矛尖 | 改为驻扎营地 | 重做：石塔→帐篷营栅+枪架 |
| 23 | 战车 | 罗马竞技场+巨型车轮 | 移除轮盘内容 | 保留竞技场，去掉巨型车轮，改用战车/旗帜为特征物 |
| 24 | 驯兽师 | 多层石木屋+铁栏兽笼 | 舍弃砖瓦房屋 | 重做：房屋→纯野外兽栏（保留铁笼） |
| 27 | 刽子手 | 高木台+暗红布幔+斧刃 | **补做：露天刑台** | 强化断头台+斧架+血色木台，归类露天场景，去小屋感 |
| 30 | 十字军 | 石堡+墙上十字盾浮雕 | 十字添加盾牌 | 强化：墙面浮雕→独立巨型十字盾牌 |
| 37 | 凤凰 | 石塔+火焰蛋 | **完全舍弃砖瓦房屋** | 重做：石塔→纯树枝巨巢 |
| 38 | 幼龙 | 石塔+绿蛋 | **完全舍弃砖瓦房屋** | 重做：石塔→纯岩洞蛋窟 |
| 39 | 战争泰坦 | 西式石屋+石拳 | **完全舍弃砖瓦房屋** | 重做：石屋→纯巨岩台+断柱+石拳 |
| 40 | 古龙 | 石砌龙殿+龙头石雕 | 西方龙 + **完全舍弃砖瓦房屋** | 重做：龙殿→纯龙窟（龙骨拱+龙蛋+西式龙头骸骨） |

**评审结论：A/B/C 档重做，D 档原判通过；2026-11-26 用户追加指令后 D 档 4 张一并补做。** 依据用户明确的形态指令，不做主观发挥。

---

## 三、冻结不变（保证同族）

| 维度 | 冻结值 |
|---|---|
| 视角 | 高位 2.5D 等距，顶面+正面+右侧面同框，无透视漂移 |
| 占画比例 | 主体含底座占画布宽 82%±4%，垂直居中偏下 |
| 底座 | 同一椭圆碎石台，米白石+暖灰缝（**A 档也保留底座**，保证同族） |
| 光照 | 统一左上主光，顶面最亮、正面中间、右侧面最暗 |
| 明度阶梯 | 顶面 L170–200 / 正面 L120–150 / 侧面 L85–110 |
| 笔触 | 圆润厚涂，软过渡，无硬描边、无线稿（Q 版卡通） |
| 巨型特征物 | 每座有且仅有一个占主体 ≥35% 高的特征物，缩略图可辨 |
| 尺寸 | 312×312 RGBA，透明底，四角 alpha=0 |
| 出图底 | 品红/深蓝紫底，连通域+色相清理抠图 |

**变化层**：仅建筑本体形制（去房屋化/形态精确化）+ 材质 + 巨型特征物。**已确认的西幻风格锚点、色板、底座全部冻结**。

---

## 四、提示词策略（逐字复用已有锚点 + 新增去房屋段）

### 段 1 · 风格锚点（逐字复用西幻版，不动）

```
Painterly 2.5D isometric game building, high three-quarter view showing roof, front and right side in one frame, chunky rounded volumes with soft thick-paint shading and smooth brush transitions, no hard outlines, no lineart. STRICTLY WESTERN FANTASY MEDIEVAL ARCHITECTURE: stone masonry walls, steep pitched roofs with slate or wooden shingles, pointed gables, rounded arches, Romanesque columns, timber-framed construction, thatch, crenellations, Gothic spires and buttresses. Warm sunny palette of honey timber, creamy ivory stone, golden highlights and warm brown shadows, with each unit's signature accent color. Consistently left-top key light: brightest roof plane, mid-tone front face, darker right side. The building sits on the same small elliptical crushed-stone pedestal used by the whole building family, made of warm cream stones. Premium hand-painted cartoon mobile game asset, thick rounded brushwork, plump soft forms, clean readable shapes, cheerful candy-like finish. ABSOLUTELY NO East Asian architecture.
```

> **A 档例外**：段 1 里的 "showing roof, front and right side" 与 "stone masonry walls, steep pitched roofs..." 与"无房屋"冲突。A 档把段 1 替换为下方「段 1A」，其余句子逐字保留，只删建筑语汇句。

### 段 1A · A 档专用（去房屋化，逐字复用）

```
Painterly 2.5D isometric game scene landmark, high three-quarter view, chunky rounded volumes with soft thick-paint shading and smooth brush transitions, no hard outlines, no lineart. STRICTLY WESTERN FANTASY natural landmark, OPEN-AIR and NO enclosed building of any kind. Warm sunny palette of honey timber, creamy ivory stone, golden highlights and warm brown shadows, with each unit's signature accent color. Consistently left-top key light: brightest top surfaces, mid-tone front, darker right side. The scene sits on the same small elliptical crushed-stone pedestal used by the whole building family, made of warm cream stones. Premium hand-painted cartoon mobile game asset, thick rounded brushwork, plump soft forms, clean readable shapes, cheerful candy-like finish. ABSOLUTELY NO East Asian architecture.
```

### 段 4 · 技术约束与禁忌（逐字复用西幻版，不动）

```
Pure solid magenta #FF00FF background only, no gradient, no floor shadow cast onto background, no background objects. No text, no letters, no numbers, no logo, no glow, no neon, no beam, no ray, no aurora, no hard black outline, no realistic photo texture, no pure white, no pure black. Sharp clean silhouette with at most 1px antialiasing, suitable for alpha keying. The whole building must be fully inside the frame with transparent-safe margins.
```

### Negative prompt（B/C/D 档逐字复用西幻版）

```
East Asian architecture, Chinese architecture, Japanese architecture, pagoda, Buddhist temple, Chinese roof, curved upturned eaves, flying eaves, tiled roof with ridge ornaments, dougong brackets, paifang gate, Chinese lattice windows, red lacquer pillars, paper lantern, Chinese dragon, Asian pavilion, torii gate, text, letter, number, logo, glow, neon, beam, ray, aurora, hard outline, black lineart, realistic, photo, gradient background, floor shadow, white background, pure white, pure black, sci-fi, cyber, generic hut, same building different color, tiny emblem, small ornament as main identifier, multiple competing focal objects, cold grey, desaturated, bluish tone, washed out, weathered wood, dirty grime, thin flat cel shading, sketchy linework, visible plank gaps, dark cracks
```

### Negative prompt · A/B 档专用（去房屋强排除，逐字复用）

```
house, building, cottage, cabin, brick wall, stone wall, masonry wall, pitched roof, tiled roof, shingled roof, roof tiles, closed structure, enclosed room, tower building, chimney, windows, door, wooden house, stone house, chapel, temple building
```

> **关键教训沿用**：上一轮 31 墓地/08 盾兵「偷偷长回中式卷檐」是放大才抓到的。本轮「偷偷长回房屋」同样是高风险——A 档出图必须放大检查是否混入了墙/屋顶，出现即打回重出。

---

## 五、16 座形态映射

> 槽位：`{SCENE}` 主体场景 / `{MAT}` 材质 / `{ACC}` 识别色 / `{SIG}` 巨型特征物 / `{PROP}` 次要道具。
> 模板归属按「形态本身是否露天」定，不严格按档位字母：
> - **段 1A 场景模板 + 去房屋 Negative**：11 / 16 / 19 / 24 / 37 / 38 / 39 / 40（8 座。含 C 档的 16 船、19 营地——船与帐篷营地本就是露天场景，不是 house）
> - **段 1 建筑模板 + 原 Negative**：09 马厩 / 10 北欧长屋 / 23 竞技场 / 30 石堡（4 座）
> - **D 档补做出图**：02 / 12 / 15 / 27（露天靶场/校场/岗哨门/刑台，走段 1A 场景模板）

| # | 兵种 | 档 | 主体场景（改写要点） | 巨型特征物 | 识别色 |
|---|---|---|---|---|---|
| 02 | 弓箭手 | D·补做 | **露天箭术靶场**：草靶+箭垛+箭筒，无石塔无屋顶 | 巨型长弓 | 深红 |
| 09 | 骑士 | C | 开放式木构马厩：马棚隔栏+拴马桩+草料槽+马匹，**保留石基** | 巨型马蹄铁+马头 | 骑士蓝 |
| 10 | 狂战士 | C | 北欧维京营地：深色粗木+龙骨屋脊饰+符文石+兽皮兽骨，去金瓦 | 巨型双刃战斧 | 暗红 |
| 11 | 骷髅兵 | A | **露天骨场**：无墙无顶，散落墓碑+骨堆+断剑，地面骨白碎石 | 巨型骷髅头（眼窝深凹） | 骨白 |
| 12 | 战士 | D·补做 | **露天校场**：沙地+兵器架+木人桩阵，无房屋 | 巨型木人桩（持剑盾） | 砖红 |
| 15 | 卫兵 | D·补做 | **露天岗哨门**：开放式城门关卡+岗亭+闸栅，无屋顶 | 巨型长戟+圆盾 | 石灰蓝 |
| 16 | 海盗 | C | **完整船形**：陆地上的大帆船（船身+桅杆+张开的风帆+船首像），非翻覆船顶 | 巨型船首像/主帆（去掉原船锚主特征） | 海蓝 |
| 19 | 长枪兵 | C | **驻扎营地**：军用帐篷群+木栅营墙+篝火+枪架，无石塔 | 一排竖立的巨型长枪（枪尖齐平） | 青铜 |
| 23 | 战车 | C | 罗马竞技场保留（沙地+看台+拱门），**移除巨型车轮** | 巨型罗马战车整车+高扬蓝旗 | 战红 |
| 24 | 驯兽师 | B | **纯野外兽栏**：木桩栅栏+铁笼+铁链+鞍具，无房屋无屋顶 | 巨型弯曲兽角 | 土橙 |
| 27 | 刽子手 | D·补做 | **露天刑台**：断头台+斧架+暗红木台，无房屋 | 巨型斧刃 | 暗酒红 |
| 30 | 十字军 | C | 石堡保留，**墙上十字浮雕改为独立巨型十字盾牌**立在堡前 | 巨型十字盾（白底红十字） | 圣白金+红 |
| 37 | 凤凰 | A | **纯树枝巨巢**：悬崖边巨巢+火焰羽饰+炭火，无石墙无瓦顶 | 巢中巨型火纹蛋+火焰羽冠 | 暖橙红 |
| 38 | 幼龙 | A | **纯岩洞蛋窟**：天然岩石凹窟+藤蔓+金光，无砖瓦无房屋 | 洞口巨型龙鳞蛋（翠绿带金纹） | 翠绿+金 |
| 39 | 战争泰坦 | A | **纯巨岩台地**：裸露巨岩+断裂石柱+石屑，无房屋 | 巨型石拳撑住岩台 | 花岗岩灰 |
| 40 | 古龙 | A | **西方龙窟**：天然黑岩深窟+龙骨拱+散落金币，**明确西方龙**（有角、张口、翼骨），非中式龙，无砖瓦房屋 | 巨型西方龙头骸骨/龙头雕塑 | 青铜+暗金 |

> **A 档实现要点**：巨型特征物比例从 ≥35% 提到 ≥40%（无建筑后特征物就是主体）。底座椭圆碎石台保留——这是全家族同族的锚，也是 A 档"场景"与"散落物"的视觉边界。

---

## 六、批次与预算

| 批次 | 数量 | 内容 | 校验 |
|---|---|---|---|
| 基准 | 5 | 40 龙窟 / 11 骨场 / 16 船 / 19 营地 / 38 蛋窟 | 出图→抠底→拼版→**用户确认去房屋化是否到位** |
| 放量 | 7 | 09 / 10 / 23 / 24 / 30 / 37 / 39 | 每批拼版 + 10% 缩略图 + 立绘呼应检查 |
| D 档补做 | 4 | 02 / 12 / 15 / 27（2026-11-26 用户追加） | 同上去房屋化验收 |

- 实际出图 5+7+4=16 张（16 座全量重做），成本 ≈ 80–160 积分。
- 体积：换图不换尺寸，40 张合计仍约 4.5MB，无预算风险。
- 工程零改动：文件名 / manifest key / 白名单 / 接线 / 测试全不动。
- 备份：覆盖前整目录备份到 `.workbuddy/backups/pre-v2-nonbuilding-YYYYMMDD/`。

---

## 七、验收标准

1. **A 档去房屋（最高优先级）**：11/37/38/39/40 五张放大检查，不得出现砖墙、瓦顶、封闭房屋、窗、门；必须是露天骨场/巢/岩窟/岩台/龙窟。
2. **西方龙明确**：40 号龙头必须有角、张口、翼骨等西式龙特征，非中式龙（沿用 Negative 的 Chinese dragon 排除）。
3. **C 档形态到位**：09 马厩（马匹元素）、16 完整船（帆+船身）、19 营地（帐篷）、23 无巨型车轮、30 独立十字盾、10 北欧深色木+龙骨饰。
4. **D 档补做到位**：02 露天靶场（无石塔）/12 露天校场（无房屋）/15 露天岗哨门（无屋顶）/27 露天刑台（无小屋），四张均放大确认去房屋化。
5. **去中式不回潮**（沿用上一轮）：任何图不得重新长出翘角飞檐/宝塔。
6. 规格 40/40、剪影可辨、缩略图、风格统一、无水印/背景残留。
7. 回归 123/123。

## 八、待确认项

**假设：仅用户点名的 16 座重绘，其余 24 座（含上一轮已交付的 14 座）保持不动（待确认）**
**假设：D 档 4 座按「露天场景化」补做——用户 2026-11-26 只说「也要重做」未给具体形态，沿用 V2 去房屋化主线（待确认）**
**假设：5 张基准已确认，剩余 7 张 + D 档 4 张一次性放量（已执行）**
**假设：A 档及 D 档补做保留椭圆碎石底座作为同族锚（待确认）**
**假设：文件名/manifest/接线/测试零改动，只换 PNG（待确认）**
