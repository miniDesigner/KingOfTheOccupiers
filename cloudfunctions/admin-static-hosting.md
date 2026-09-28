# admin 后台前端上云改造说明（#349）

> 目标：把 `server/admin/` 的三个静态文件（index.html / app.js / style.css）改造成走云函数接口，
> 部署到云开发静态托管，实现后台远程可访问。
>
> 状态：**代码改造已完成**（云函数 HTTP 触发适配 + 前端云函数调用封装 + 字段命名映射），
> 本文档提供剩余的上云部署步骤。

---

## 一、已完成的代码改造

### 1. 云函数加 HTTP 触发入口（双通道兼容）

`cloudfunctions/adminLogin/index.js` 和 `cloudfunctions/adminRouter/index.js` 都加了 `isHttpEvent` 判断：
- **HTTP 触发**（`event.httpMethod` 存在）→ 解析 `event.body`（JSON 字符串）→ 返回 `{statusCode, headers(CORS), body}`
- **wx.cloud.callFunction**（无 `httpMethod`）→ 原逻辑不变

### 2. 字段命名映射（驼峰 → 下划线）

云数据库 `accounts`/`operationLogs` 是驼峰字段，前端 `server/admin/app.js` 渲染层沿用本地 SQLite 的下划线字段。
在 `adminRouter` 里加了 `mapAccount` / `mapLog` / `mapAdmin` 三个映射函数，返回前统一转下划线，**前端渲染层零改动**。

关键映射（在 `mapAccount` 里）：
- `accountId` → `uid`（**云版主键是 accountId，本地 SQLite 主键是 uid**，前端 onclick 传参走主键，映射后查询才能命中）
- `createdAt` → `created_at`、`lastLoginAt` → `last_login_at`、`pvpWins` → `pvp_wins`、`totalGames` → `total_games`、`banReason` → `ban_reason`

### 3. 前端云函数调用封装

`server/admin/app.js` 顶部：
```js
const API_BASE = ''; // 空 = 本地 REST 模式；填云函数地址 = 云模式
const CLOUD_MODE = API_BASE !== '';
```
- `api(method, path, body)` 统一入口：`CLOUD_MODE=false` 走原同源 REST（开发态不变），`true` 走云函数 HTTP 触发
- 内部 `pathToAction` 把 method+path 映射成 `{action, token, ...}` 调 `adminRouter`
- 登录特判走独立 `adminLogin` 云函数
- `listAnnouncements`/`listAdmins` 返回裸数组（与本地 REST 一致）

---

## 二、上云部署步骤（✅ 已完成）

> 实际部署时发现域名格式与文档初稿不同，以实际返回为准。

### 实际部署结果

| 项 | 值 |
|---|---|
| HTTP 访问服务（云函数）域名 | `https://minigame-prod-d5g02fq8e40658692-1463521202.ap-shanghai.app.tcloudbase.com` |
| 静态托管域名 | `https://minigame-prod-d5g02fq8e40658692-1463521202.tcloudbaseapp.com` |
| 后台访问地址 | `https://minigame-prod-d5g02fq8e40658692-1463521202.tcloudbaseapp.com/admin/index.html` |
| HTTP 触发器（必开） | `/adminLogin`（登录）+ `/adminRouter`（所有管理接口）|
| 登录账号 | `admin` / `admin123`（懒种子自动创建） |

### 部署命令（已执行）

```bash
# 1. 创建 HTTP 访问服务（绑定云函数，一条命令同时开通服务+绑定函数）
tcb service create -e <envId> -p adminRouter -f adminRouter
tcb service create -e <envId> -p adminLogin -f adminLogin

# 2. 部署静态托管（上传 3 个静态文件到 /admin/）
tcb hosting deploy server/admin/index.html admin/index.html -e <envId>
tcb hosting deploy server/admin/app.js admin/app.js -e <envId>
tcb hosting deploy server/admin/style.css admin/style.css -e <envId>
```

> ⚠️ 关键：`tcb service create`（而非 `tcb routes add`）才是开通 HTTP 访问服务的正确命令。
> `tcb routes add` 会报「system internal domain 不支持手动创建」。
> 域名是 `...app.tcloudbase.com`（云函数）和 `...tcloudbaseapp.com`（静态托管），
> 不是文档初稿里的 `tcb.qcloud.la`。

### CORS 说明

云开发 HTTP 访问服务**自动处理 CORS 预检**（OPTIONS 返回 `access-control-allow-origin: <源域>`），
静态托管域跨域调云函数域无需额外配置。云函数里手动加的 `Access-Control-Allow-Origin: *`
在预检时被服务层覆盖，实际请求时以服务层为准，两者兼容。

---

## 三、种子超管账号（已内置懒种子逻辑）

**已解决**：`adminLogin` 和 `adminRouter` 都加了 `ensureDefaultAdmin` / 懒种子逻辑——
首次调用时若 `admin_users` 集合为空，自动创建 `admin` / `admin123`（superadmin）。
无需手动操作云数据库，首次部署即可登录。

> 注意：懒种子依赖 `admin_users` 集合已创建（`initCollections` 云函数已建 6 个集合）。
> 若集合未建，`countAdmins` 会报错，但会被 try/catch 吞掉不阻塞登录主流程。

---

## 四、旧调用 vs 新调用对照

| 旧调用（本地 REST） | 新调用（云函数 HTTP 触发） |
|---|---|
| `POST /api/admin/login` | `POST /adminLogin {username, password}` |
| `GET /api/admin/players?keyword=...` | `POST /adminRouter {action:'players', token, keyword, ...}` |
| `GET /api/admin/players/:id` | `POST /adminRouter {action:'playerDetail', token, id}` |
| `PUT /api/admin/players/:id` | `POST /adminRouter {action:'updatePlayer', token, id, patch}` |
| `POST /api/admin/players/:id/ban` | `POST /adminRouter {action:'banPlayer', token, id, status, reason, until}` |
| `GET /api/admin/stats/overview` | `POST /adminRouter {action:'stats', token}` |
| `GET /api/admin/logs` | `POST /adminRouter {action:'logs', token, ...}` |
| `GET/POST/PUT/DELETE /api/admin/announcements...` | `POST /adminRouter {action:'listAnnouncements'/'createAnnouncement'/..., token}` |
| `GET/POST/DELETE /api/admin/users...` | `POST /adminRouter {action:'listAdmins'/'createAdmin'/'deleteAdmin', token}` |

> 前端 `app.js` 的 `api()` 已经封装了这层映射，业务代码无需感知。

---

## 五、本地 SQLite 保留

`server/` 本地服务继续可跑（开发态/测试态），与云函数版并存，互不影响。
`server/tests/test-e2e.mjs` 继续验证本地链路；云函数侧用 `test-cloud-settle-core.mjs` 验证纯函数。

---

## 六、待办清单

- [x] 开通 HTTP 访问服务（`tcb service create`，已完成）
- [x] 绑定 `/adminRouter` + `/adminLogin` 两条云函数（`tcb service create` 同时完成）
- [x] 种子默认超管 `admin/admin123`（已内置懒种子逻辑）
- [x] 部署静态托管（index.html / app.js / style.css 到 `/admin/`）
- [x] 改 `API_BASE` 为真实云函数地址并重新上传 app.js
- [x] 端到端验证：登录 / stats / players（字段映射）/ listAnnouncements 全通过
- [ ] （可选）浏览器打开后台做一次完整 UI 人工验收（登录 → 各功能页）
