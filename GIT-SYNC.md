# Git 同步说明

> 《占地之王》King of the Occupiers
> 仓库：https://github.com/miniDesigner/KingOfTheOccupiers.git
> 本地目录：`E:\GitRep\KingOfTheOccupiers`

---

## ⚠️ 先说一个重要限制

**沙箱无法访问 GitHub**（HTTPS 握手失败，已验证）。所以我没法直接 `push` / `pull`，
Git 同步需要**你做一次搬运**，之后两边就能各自 commit / push。

```
[我的沙箱]  ──打包──>  [你的本机 E:\GitRep]  ──push──>  [GitHub]
                            ↑
                      同步的唯一枢纽
```

---

## 首次安装（做一次）

**1. 下载** `KingOfTheOccupiers-git.zip`（1.8 MB，已含完整 `.git`）

**2. 解压到** `E:\GitRep\KingOfTheOccupiers`

> 解压后目录层级应为 `E:\GitRep\KingOfTheOccupiers\src\...`
> 如果多出一层 `kingoftheoccupiers\`，把它里面的内容上移一级。

**3. 关联远端并推送**

```powershell
cd E:\GitRep\KingOfTheOccupiers
git remote add origin https://github.com/miniDesigner/KingOfTheOccupiers.git
git branch -M main
git push -u origin main
```

> 如果 GitHub 仓库已初始化过 README，先执行：
> `git pull origin main --allow-unrelated-histories` 再 push。

---

## 日常同步

### 方向 A：我改完 → 同步到你的本机

1. 我给出新的工程 zip（或上传共享盘 `05-主工程`）
2. 你解压覆盖到 `E:\GitRep\KingOfTheOccupiers`
3. 正常 commit + push

由于两边都有 `.git`，覆盖后 git 会自动识别文件变更，
`git status` 能看到我改了哪些文件。

### 方向 B：你本机改完 → 同步给我

因为我看不到你的本机、也拉不到 GitHub，请这样给我：

- **小改动**：直接把改的文件内容贴给我
- **大改动**：打个 zip 上传到项目共享盘，我从网盘拉取

---

## `.gitignore` 排除清单

以下**不会**入库，避免污染仓库：

| 类型 | 文件 |
|---|---|
| 环境变量 | `.env.local` |
| 本地数据库 | `server/tk.db`（含真实数据）|
| 历史过期副本 | `.attic/`（占城先锋带来的三份旧代码）|
| 历史补丁脚本 | `scripts/p3*_*.py`（一次性脚本，已执行完）|
| 预览服务器日志 | `preview-server.err` / `.out` |
| 开发者工具私有配置 | `project.private.config.json` |
| Python/Node | `__pycache__/`、`node_modules/` |

---

## 首次提交内容

```
cc9cd89 feat: 初始化《占地之王》工程底座
220 files changed, 68408 insertions(+)
```

包含：
- `src/` 47 个业务源码（约 2 万行）
- `config/` 16 个配置 JSON + 编译产物
- `tests/` 55 个测试脚本（46 个回归测试全绿）
- `preview/` 浏览器预览
- `cloudfunctions/` `server/` 后端（原型期未启用）
- `game.js` 微信真机入口
- `README.md` / `CHECKLIST.md` 项目文档

---

## 常用命令

```bash
python3 preview-server.py              # 浏览器预览 :8890
node --test "tests/test-*.mjs"         # 全量回归测试
node tests/check-imports.mjs           # 依赖完整性检查
node tools/build-config-js.mjs         # 改 config/*.json 后必跑
```

> **注意**：改完 `config/*.json` 必须跑 `build-config-js.mjs` 重新生成 `.js`，
> 否则微信真机读到的还是旧配置（浏览器走 fetch 读 JSON，不受影响，易漏）。
