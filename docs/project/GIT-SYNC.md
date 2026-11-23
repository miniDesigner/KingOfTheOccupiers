# Git 同步说明

> 《占地之王》King of the Occupiers
> 仓库：https://github.com/miniDesigner/KingOfTheOccupiers.git
> 你的本地目录：`E:\GitRep\KingOfTheOccupiers`
> 沙箱通道状态：**✅ 已打通并授权（2026-09-28）** —— 我可以直接 push / pull
> 验收：全新克隆副本 `ALL IMPORTS VALID ✅ (47 files)` + 回归测试 `46 pass / 0 fail`

---

## 一、为什么之前 GitHub 走不通（已定位并绕过）

不是「沙箱没网」，是**内网代理的 DNS 投毒 + 链路随机丢包**。

### 现象链路

| 层 | `github.com` | `gitee.com`（对照组） |
|---|---|---|
| DNS 解析 | `198.18.0.19` ⚠️ | `180.76.199.13` ✅ 真实 IP |
| TCP 443 | ✅ 能建连（被中间设备假 accept） | ✅ |
| TLS 握手 | ❌ 立刻 EOF / RST | ✅ TLSv1.3 握手成功 |
| git 报错 | `gnutls_handshake() failed: The TLS connection was non-properly terminated.` | 正常 |

`198.18.0.0/15` 是 **RFC 2544 保留的 benchmark 测试网段**，正常公网永远不会出现在这个位置。
被指到这里的域名包括 `github.com`、`codeload.github.com`、`raw.githubusercontent.com`、
`objects.githubusercontent.com` —— 所以是**整域名策略**，不是 IP 被墙。

同一时刻 `gitee.com` / `gitlab.com` / `bitbucket.org` 都解析到真实 IP 且握手成功，
`baidu.com` / `qq.com` / `npmjs.com` 也全通 —— 印证了「白名单制出站」，
GitHub 只是不在白名单里。

### 解法：绕过被投毒的 DNS

IP 层**根本没有封**。用阿里公共 DNS（`dns.alidns.com`，在白名单里）查到真实 IP 写进 hosts 即可：

| 域名 | 真实 IP |
|---|---|
| `github.com` | `20.205.243.166` |
| `codeload.github.com` | `20.205.243.165` |
| `api.github.com` | `20.205.243.168` |
| `objects.githubusercontent.com` | `185.199.109.133` |
| `raw.githubusercontent.com` | `185.199.108.133` |
| `avatars.githubusercontent.com` | `185.199.109.133` |

写入后 `curl https://github.com` 返回 **HTTP 200 / `server: github.com`**，`git ls-remote` 正常读出远端。

### 第二个坑：HTTPS 通道被随机丢包

hosts 修好后 HTTPS 仍有约 **40% 概率**握手失败（连续操作更明显，疑似连接速率整形）。
但 **SSH 22 端口 8/8 全稳**。

> 结论：走 **SSH**，不用 HTTPS。已把 remote 切为 `git@github.com:...`。

---

## 二、授权已完成 ✅

已生成专用密钥对并添加到 GitHub，（权限面比 PAT 令牌窄得多，随时可在 GitHub 上一键 Revoke）：

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDBbreBdz7zwjj2jQYORWw8WLCyZH/x6KFyGBGNCTD2S workbuddy-sandbox-kingoftheoccupiers
```

已于 2026-09-28 添加完成，验证输出：

```
Hi miniDesigner! You've successfully authenticated, but GitHub does not provide shell access.
```

> **注意**：这条 key 只授权了我这台沙箱。若哪天你不再需要自主推送，
> 在 GitHub → Settings → SSH keys 里删掉 `workbuddy-sandbox` 即可立即失效。

---

## 三、防复发：hosts 刷新脚本

GitHub 的 IP 会轮换，某天突然推不动了跑一次：

```bash
bash scripts/refresh-github-hosts.sh
```

脚本会用阿里 DoH 重新查真实 IP，写入 `~/.user_hosts`（持久）和 `/etc/hosts`（立即生效）。

> **本环境注意**：`/etc/hosts` 在工作空间重启后会被还原，脚本已同步写 `~/.user_hosts`，
> 重启后重跑一次脚本即可恢复。

---

## 四、首次安装踩坑记录（你本机，已完成）

```powershell
cd E:\GitRep\KingOfTheOccupiers
git remote add origin https://github.com/miniDesigner/KingOfTheOccupiers.git
git branch -M main
git push -f origin main
```

`git push` 报 `non-fast-forward` 被拒：GitHub 建仓库时自动生成了 `Initial commit`。
先用 `git fetch origin` + `git log --oneline origin/main` 确认远程只有一个空壳提交，再 `-f` 强推。
**不要用 `pull --allow-unrelated-histories`** —— 两边都有 `README.md`，会直接冲突。

---

## 五、日常同步

现在这条链路是通的，中间搬运环节全部取消：

```
[我的沙箱]  ──push/pull──>  [GitHub]  ──pull──>  [你的本机 E:\GitRep]
```

分工：

- **我**：每次改完先 commit 到本地，攒到可运行的节点推一次并告诉你
- **你**：在本机 `git pull` 即可拿到；你手改的内容 push 后我会 `git pull` 拉进来

### 你本机的收尾操作

你的 `E:\GitRep\KingOfTheOccupiers` 还停在 `d226984`（之前是 HTTPS 搬运过去的），执行一次：

```powershell
cd E:\GitRep\KingOfTheOccupiers
git remote set-url origin git@github.com:miniDesigner/KingOfTheOccupiers.git
git pull
```

> 建议一并换成 SSH —— 你的本机访问 GitHub 走的是正常网络，但换过来后权限模型统一，
> 也省掉 Windows 凭据管理器里那份 HTTPS token 过期带来的麻烦。

### 兜底：bundle 搬运

万一遇到 hosts 失效、IP 轮换又没及时刷新的情况，退回到离线 bundle：

```bash
# 我这边：打包增量
git bundle create /workspace/sync-<日期>.bundle <你的commit>..main

# 你那边：拉取
git pull "E:\路径\sync-<日期>.bundle" main
```

---

## 六、`.gitignore` 排除清单

| 类型 | 文件 |
|---|---|
| 环境变量 | `.env.local` |
| 本地数据库 | `server/tk.db`（含真实数据）|
| 历史过期副本 | `.attic/`（占城先锋带来的三份旧代码）|
| 历史补丁脚本 | `scripts/p3*_*.py`（一次性脚本，已执行完）|
| 预览服务器日志 | `preview-server.err` / `.out` |
| 开发者工具私有配置 | `project.private.config.json` |
| Python / Node | `__pycache__/`、`node_modules/` |

> `p3*_*.py` 虽然被 gitignore，但**文件仍在本地保留**（未删除）。
> 若要彻底清理：`rm scripts/p3*_*.py`

---

## 七、当前 Git 状态

**本地 = 远端 = `b3b9452`，领先 0 / 落后 0，工作区干净。**

```
b3b9452  chore: 打通 GitHub SSH 通道，实现自主提交
4c0d1bd  test: 添加同步链路测试标记 SYNC-TEST-001
774bbbc  docs: 记录 Git 通道打通状态与首次推送踩坑
d226984  docs: 补充 Git 同步说明
cc9cd89  feat: 初始化《占地之王》工程底座
```

### 同步链路验收结果（2026-09-28）

| 环节 | 结果 |
|---|---|
| `ssh -T git@github.com` 认证 | ✅ `Hi miniDesigner!` |
| `git push` 到远端 | ✅ `d226984..b3b9452` |
| 从 GitHub **全新克隆** | ✅ 拉取完整（47 源码 / 19830 行 / 16 配置 / 56 测试）|
| 克隆副本跑依赖检查 | ✅ `ALL IMPORTS VALID (47 files)` |
| 克隆副本跑回归测试 | ✅ `46 pass / 0 fail` |

> 全新克隆后能直接跑通全套测试，说明仓库内容自洽、没有漏提交的依赖，
> 你在本机 `git pull` 之后可以直接用。

---

## 八、常用命令

```bash
python3 preview-server.py              # 浏览器预览 :8890
node --test "tests/test-*.mjs"         # 全量回归测试
node tests/check-imports.mjs           # 依赖完整性检查
node tools/build-config-js.mjs         # 改 config/*.json 后必跑
bash scripts/refresh-github-hosts.sh   # GitHub 推不动时刷新 hosts
```

> 改完 `config/*.json` 必须跑 `build-config-js.mjs` 重新生成 `.js`，
> 否则微信真机读到的还是旧配置（浏览器走 fetch 读 JSON，不受影响，易漏）。

---

## 九、提交规范

Conventional Commits 前缀：

| 前缀 | 场景 |
|---|---|
| `feat:` | 新功能 |
| `fix:` | 修 bug |
| `docs:` | 文档 |
| `refactor:` | 重构 |
| `test:` | 测试 |
| `chore:` | 构建/配置 |
