# Git 同步说明

> 《占地之王》King of the Occupiers
> 仓库：https://github.com/miniDesigner/KingOfTheOccupiers.git
> 本地目录：`E:\GitRep\KingOfTheOccupiers`
> 状态：**✅ 已于 2026-09-28 打通**

---

## ⚠️ 唯一限制

**沙箱无法访问 GitHub**（HTTPS 握手失败，已验证）。我这边没法 `push` / `pull`，
所以每次同步需要**你搬运一次**。你自己本机 → GitHub 是完全正常的。

```
[我的沙箱]  ──打包──>  [你的本机 E:\GitRep]  ──push──>  [GitHub]
                            ↑
                      同步的唯一枢纽
```

---

## ✅ 首次安装（已完成）

已于 2026-09-28 完成，记录备查：

```powershell
cd E:\GitRep\KingOfTheOccupiers
git remote add origin https://github.com/miniDesigner/KingOfTheOccupiers.git
git branch -M main
# 远程有 GitHub 自动生成的 Initial commit → 强推覆盖
git push -f origin main
```

结果：

```
d226984 (HEAD -> main, origin/main, origin/HEAD) docs: 补充 Git 同步说明
cc9cd89 feat: 初始化《占地之王》工程底座
```

> **踩坑记录**：`git push` 报 `non-fast-forward` 被拒，原因是 GitHub 建仓库时
> 自动生成了 `Initial commit`（README/LICENSE）。先用 `git fetch origin` +
> `git log --oneline origin/main` 确认远程只有一个空壳提交，再用 `-f` 强推。
> 不要用 `pull --allow-unrelated-histories`，因为两边都有 `README.md` 会直接冲突。

---

## 日常同步

### 方向 A：我改完 → 同步到你的本机

1. 我给出新的工程 zip（或上传共享盘 `占地之王/05-主工程`）
2. 你解压覆盖到 `E:\GitRep\KingOfTheOccupiers`
3. commit + push

两边都有 `.git`，覆盖后 git 自动识别变更，`git status` 能看到我改了哪些文件。

### 方向 B：你本机改完 → 同步给我

- **小改动**：直接把改的文件内容贴给我
- **大改动**：打包传到项目共享盘，我从网盘拉取

---

## `.gitignore` 排除清单

以下**不会**入库：

| 类型 | 文件 |
|---|---|
| 环境变量 | `.env.local` |
| 本地数据库 | `server/tk.db`（含真实数据）|
| 历史过期副本 | `.attic/`（占城先锋带来的三份旧代码）|
| 历史补丁脚本 | `scripts/p3*_*.py`（一次性脚本，已执行完）|
| 预览服务器日志 | `preview-server.err` / `.out` |
| 开发者工具私有配置 | `project.private.config.json` |
| Python / Node | `__pycache__/`、`node_modules/` |

> 注：`p3*_*.py` 虽然被 gitignore，但**文件仍在本地保留**（未删除）。
> 若要彻底清理：`rm scripts/p3*_*.py`

---

## 首次提交内容

```
cc9cd89 feat: 初始化《占地之王》工程底座
220 files changed, 68408 insertions(+)
```

- `src/` 47 个业务源码（约 2 万行）
- `config/` 16 个配置 JSON + 编译产物
- `tests/` 55 个测试脚本（46 个回归测试全绿）
- `preview/` 浏览器预览
- `cloudfunctions/` `server/` 后端（原型期未启用）
- `game.js` 微信真机入口
- `README.md` / `CHECKLIST.md` / `GIT-SYNC.md`

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

---

## 提交规范

参照首次提交风格，用 Conventional Commits 前缀：

| 前缀 | 场景 |
|---|---|
| `feat:` | 新功能 |
| `fix:` | 修 bug |
| `docs:` | 文档 |
| `refactor:` | 重构 |
| `test:` | 测试 |
| `chore:` | 构建/配置 |
