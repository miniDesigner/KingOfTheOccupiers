# 占地之王 · 山脉障碍格 2.5D 卡通化提案（待确认）

> 状态：**方案待用户确认，未生成任何图片**。按项目铁律「任何图片生成/重绘/批量出图，必须先给方案等用户确认再执行」。
> 需求原话：「山脉贴图表现改为 2.5D 的卡通山脉表现，风格参考兵营」。
> 日期：2026-11-25

---

## 一、结论先行

**当前山脉图不符合已定美术规格，需要重出。** 建议采用 **方案 B（换单图 + 障碍格染色降权）**：重绘 `assets/tiles/mountain.png` 为「同款石砖 + 2–3 座圆润雪顶卡通山峰」，同时把障碍格染色 alpha 从 0.45 降到 0.18。改动量 = 1 张贴图 + 1 个参数，卡通厚涂感能保留 ~82%，且不破坏上一轮「障碍格与翻开格同族」的修复。

**参考兵营只借「造型语言」，不借「暖木配色」。** 当前兵营（`barracks_1/3`）是暖木棕 + 橙红旗 + 米白石基；山脉是石质障碍，棋盘整体是青灰冷调。若把山体刷成暖木棕，会像一块木头贴在石头棋盘上——拼凑感。所以只学它的**体积厚涂、圆润无描边、顶面受光/侧面背光、柔和环境色、接地投影**，颜色仍留在石质冷灰家族，仅取兵营 `#E4BF71` 的降饱和版做 <8% 暖光点缀。

---

## 二、现状诊断（问题 → 为什么是问题 → 怎么改）

| # | 问题 | 为什么是问题 | 具体怎么改 |
|---|---|---|---|
| 1 | 当前 `mountain.png` 顶面上是一个扁平的 "M" 形尖三角刻线 | `ART-BOARD-ART-PLAN.md` §2.4 / `ART-BOARD-ART-PLAN-V3.md` §2.1 早已定规格：「石砖上立 2–3 座 **Q 版圆润雪顶山峰（不是尖三角）**，带柔和阴影，**不要画硬描边**」。当前实现一直在违反已确认规格 | 山峰改为 2–3 座有顶面/侧面/雪顶渐变的圆润体块，彻底去掉刻线三角 |
| 2 | 障碍格叠了 alpha 0.45 的中性灰染 `_drawTileOwnerTint(..., '#64748b')` | 该染色是为「敌我蓝红一眼可辨」设计的。障碍格没有阵营，却吃了同样的 45% 覆盖——`result = 0.55·src + 0.45·#64748b`，把暗部提亮、亮部压暗，明暗对比被压缩 45%，厚涂体积直接发闷 | 给染色函数加可选 `alpha` 参数，障碍格传 0.18；翻开格仍 0.45，不受影响 |
| 3 | 石砖几何与 `hex_bright` 必须严格对齐 | `_artHex()` 对 `SOLID_BOARD_KEYS` 走「整图不裁剪 + 1:1 尺寸标定」（`SOLID_BOARD_BODY_RATIO=0.98`）。石砖轮廓/厚度/透视一旦漂移，障碍格就会在棋盘上错位、溢出邻格 | 图生图以 `hex_bright.png` 为参考图，提示词明确「石砖逐像素不变，只重画顶面山峰」；后处理用 `tools/refine-old-tile.py` 保证 312² 紧裁 |

---

## 三、风格锚点（从兵营提取，可执行）

| 维度 | 兵营参考特征（实测） | 山脉落地口径 |
|---|---|---|
| 视角 | 固定高位 2.5D 等距，顶面+侧面同框 | 沿用石砖既有等距角，**零漂移** |
| 体积 | 圆润厚涂，无硬描边；顶面暖亮、侧面冷暗 | 山峰顶面受光、右侧背光，雪→岩柔和过渡 |
| 边缘 | 圆角、无描边线；转角靠明暗断层 | 山脊圆润，**禁硬描边**（规格硬要求） |
| 高光 | 顶面柔和块状高光 `#E4BF71`，非镜面反光 | 雪顶块状高光 + 山脊柔光，禁镜面/发光 |
| 环境色 | 暗部染环境冷色，不是纯黑 | 山体暗面染石板蓝 `#3E4E63`，禁纯黑 |
| 接地 | 米白石基 + 柔和投影，主体"坐"在地上 | 山峰要有落在石砖顶面的柔影，禁悬空贴纸感 |
| 质感 | 卡通厚涂，笔触柔和，非写实非扁平矢量 | 同左；禁写实岩石裂纹与细密噪点 |

---

## 四、色彩板（6 色，石质冷灰家族）

| 槽位 | 色号 | 灰度 L | 用途 | 来源 |
|---|---|---|---|---|
| 雪顶高光 | `#EAF2F6` | 236 | 圆润雪顶最亮点，块状柔光 | 冷白，不用纯白 `#FFF`（会刺眼） |
| 山脊过渡 | `#A8BCCB` | 184 | 雪→岩过渡带 | 自 `hex_bright` 高光降饱和 |
| 山体主色 | `#6B7E96` | 124 | 山峰受光面主体 | 承 `hex_bright #7D909A` 同族，微冷 |
| 石砖底座 | `#7D909A` | 138 | **原样保留，零改动** | `hex_bright` 实测主色 |
| 山体暗面 | `#3E4E63` | 76 | 背光面/谷地，压出体积 | 承现 `mountain #2C3644` 提亮 |
| 暖光渗透 | `#D9B98A` | 192 | 仅山脊受光面点缀，**占比 <8%** | 兵营 `#E4BF71` 降饱和，提供"卡通温度" |

**明度阶梯（自上而下）**：雪顶 236 → 山脊 184 → 山体 124 → 石砖 138（底座略亮于山体，山峰才能从石砖上"立"起来）→ 暗面 76 → 接地投影 42–55。
**整体主体中位 L 目标 90–130**，符合 `ART-BOARD-ART-PLAN.md` 对 mountain 的规格（主体 L 90–120，允许染色后 +10 容差）。

---

## 五、几何与规格硬约束（不可协商）

| 项 | 规格 |
|---|---|
| 输出尺寸 | **312×312 px**，RGBA 透明底（与 `hex_bright.png` / 现 `mountain.png` 一致） |
| 石砖底座 | 轮廓、厚度侧面、透视角度、裂纹纹理、接地投影 **逐像素级不变** |
| 山峰数量 | 2–3 座，主峰居中略偏后，次峰左右错落 |
| 山峰占幅 | 顶面宽度的 55–70%；高度 ≤ 石砖总高 45%（不得盖住侧面厚度） |
| alpha | 四角 = 0，实心主体 = 255，边缘过渡 ≤ 1px |
| 水印 | 无水印、无签名、无 UI、无边框 |
| 命名 | 同名覆盖 `assets/tiles/mountain.png`（manifest 无需重生成）；候选期落 staging 带 `_v1` 后缀 |

---

## 六、染色管线解法（三方案对比）

| 方案 | 做法 | 改动量 | 卡通感保留 | 一致性 | 评价 |
|---|---|---|---|---|---|
| **B（推荐）** | 换单图 + 障碍格染色 alpha 0.45→0.18 | 1 图 + 1 参数 | ~82% | 石砖与描边仍走同一管线，仅按语义差异化染色深浅 | 性价比最高，不动玩法 |
| A（升级路径） | 新增 `mountain_peak.png` 峰层，在染色后叠加 | 1 图 + 1 接线 + 每障碍格多 1 次 draw | 100% | 石砖仍走染色管线 | B 实拍后若卡通感仍不够再上 |
| C（不推荐） | 只换图，山体明暗硬拉到 L 60–245 硬扛染色 | 1 图 | ~50% | 零 | 最省但厚涂体积被压平，白做 |

**方案 B 实现**：`_drawTileOwnerTint(x, y, color, alpha = 0.45)`，障碍格调用改 `_drawTileOwnerTint(x, y, '#64748b', 0.18)`；翻开格不传第 4 参，行为完全不变。

---

## 七、提示词包（逐字复用，英文出图）

> 槽位表：`{{PEAK_COUNT}}` = 2–3（本次固定 3）；`{{SNOW_RATIO}}` = 25–35%（本次固定 30%）。**一次只变一个变量。**
> 段 1 风格锚点为**固定段**，同系列每张完全一致，不得改写。

**段 1 · 风格锚点（固定）**
```
Painterly 2.5D isometric game art, chunky rounded volumes, soft thick-paint shading with smooth brush transitions, no outline strokes, gentle ambient color bleeding, clean soft contact shadow, premium casual mobile game tile art, matching the hand-painted cartoon barracks building style: rounded volumes, soft golden highlights on top faces, cool shadowed sides, no outlines.
```

**段 2 · 主体描述**
```
A solid hexagonal stone tile with a thick visible side wall and a soft ground shadow, viewed from a fixed elevated isometric angle. On the top face sit 3 rounded chubby cartoon mountain peaks with soft snow caps and smooth rounded ridges, NOT sharp triangles, NOT flat engraved symbols. The main peak is centered slightly toward the back, two smaller peaks offset left and right. Each peak has a clearly lit upper-left face, a cooler shadowed right face, and a soft snow-to-rock gradient; snow covers 30 percent of each peak height. The stone tile geometry, thickness, perspective, cracks and contact shadow must remain pixel-identical to the reference image; ONLY the mountain peaks on the top face are newly painted.
```

**段 3 · 约束与禁忌**
```
Do NOT change the hexagon silhouette, tile thickness, camera angle, or lighting direction. Do NOT draw hard black outlines, thin line-art, flat vector shapes, engraved M-shaped zigzag symbols, realistic rock textures, jagged sharp peaks, glowing beams, rays, aurora, or neon effects. Do NOT add flags, buildings, trees, characters, or text. Do NOT use warm wood-brown as the mountain body color; keep cool slate-blue-grey stone tones with creamy pale snow caps and only a tiny warm highlight accent. No watermark, no signature, no UI, no border.
```

**段 4 · 输出规格**
```
Square 1:1 canvas, transparent alpha background, the stone tile tightly cropped and centered filling the canvas edge-to-edge like the reference, mountain peaks fully contained within the tile top face with no clipping. High resolution, clean alpha edges with at most 1px antialiasing, four corners fully transparent.
```

**Negative prompt（整段复用）**
```
sharp triangle, flat engraved symbol, hard outline, black line art, realistic rock, jagged peak, neon, glow, beam, ray, aurora, flag, building, text, watermark, warm brown wood, pure white snow, cropped tile, changed perspective
```

**参考图**：`assets/tiles/hex_bright.png`（石砖几何锚点，图生图参考强度高）；风格参考 `assets/buildings/barracks_1.png`（仅造型语言，不作为几何输入）。

---

## 八、生成与后处理流程

```bash
# 1) 生成候选（图生图，参考 hex_bright.png）——产物只落 staging，不进 assets/
#    候选图：.workbuddy/art-staging/board-art/mountain_2.5d_v1_raw.png

# 2) 连通域抠底（勿用 remove-bg-building.py 的全局阈值 —— 会把奶油白雪顶
#    当成棋盘格背景挖掉，形成黑洞；连通域只挖与画布边缘连通的背景）
python3 tools/remove-bg-connected.py \
  .workbuddy/art-staging/board-art/mountain_2.5d_v1_raw.png \
  .workbuddy/art-staging/board-art/mountain_v1.png 312

# 3) 合规校验 + 接触表（与 hex_bright 拼版目检）
python3 tools/audit-art-placeholders.py .workbuddy/art-staging/board-art/

# 4) 用户确认 staging 拼版后，才同名覆盖
cp .workbuddy/art-staging/board-art/mountain_v1.png assets/tiles/mountain.png
```

> 同名覆盖，**不需要**重跑 `tools/gen-art-manifest.mjs`（manifest 只记录路径/key）。
> 渲染层改动只有方案 B 那一处 alpha 参数；不改坐标、不改点击命中、不改玩法。

---

## 九、验收标准（逐项打勾）

- [ ] 312×312 RGBA，四角 alpha=0，实心主体 alpha=255，边缘过渡 ≤1px
- [ ] 石砖 alpha 掩膜与 `hex_bright.png` 轮廓 IoU ≥ 0.95（几何零漂移）
- [ ] 山峰为 2–3 座圆润雪顶体块，非尖三角/刻线；无硬描边
- [ ] 山峰不遮住石砖侧面厚度；整体主体中位 L 落在 90–130
- [ ] 缩到 10%（31px）仍能读出「山」
- [ ] 无 watermark、无签名、无棋盘格噪点、无白底
- [ ] 430×932 + 安全区实拍：障碍格与翻开格同明度带，山体无贴纸感，屋顶/山峰体积可辨
- [ ] 全量回归 110/110

---

## 十、待确认项

**假设：参考兵营只取造型语言（厚涂/圆润/无描边/接地投影），山脉仍用石质冷灰配色，不刷成暖木棕（待确认）**
**假设：采用方案 B（换单图 + 障碍染色 alpha 0.45→0.18），方案 A 留作升级路径（待确认）**
**假设：山峰数量固定 3 座、雪顶覆盖 30%，石砖底座逐像素不变（待确认）**
**假设：候选图先落 staging 出拼版给你确认，确认后才覆盖 `assets/tiles/mountain.png`（待确认）**
**假设：`_drawTileOwnerTint` 加可选 alpha 参数，翻开格行为完全不变（待确认）**

---

## 十一、已确认 / 待定分界

| 已确认（不得擅自改动） | 待定（本次提案） |
|---|---|
| 石砖几何、透视、厚度（`hex_bright` 锚点） | 山峰数量与雪顶比例 |
| 312×312 尺寸、透明底、命名与 manifest key | 染色 alpha 0.18 的具体值（实拍后微调） |
| 障碍格不可翻转/不可占据的玩法语义 | 是否需要升级到分层方案 A |
| 兵营等已有建筑贴图 | 山脉本身的配色与厚涂表现 |
