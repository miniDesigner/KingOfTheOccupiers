# 占地之王 · 服务器 + 运营后台（快速上手）

零 npm 依赖，Node.js ≥ 22.5 内置 `node:http` + `node:sqlite` + `node:crypto`，**无需 npm install**。

## 一、启动服务器

```bash
cd territory-king-developer-developer/server
node app.js
```

- API 根：`http://127.0.0.1:8891`
- 运营后台：`http://127.0.0.1:8891/admin`（浏览器打开）
- 数据库文件：`server/tk.db`（首次启动自动建表）

## 二、初始化超管账号

```bash
node scripts/init-admin.js
```

默认账号：`admin` / `admin123`（生产环境请用环境变量 `TK_ADMIN_USER` / `TK_ADMIN_PASS` 重建）。

## 三、浏览器版联调云同步

1. 启动本服务器（`node app.js`）。
2. 启动游戏预览（`preview-server.py`），地址加 `?cloud=1`：
   ```
   http://localhost:8890/preview/index.html?cloud=1
   ```
3. 打开后存档自动写入 `tk.db`；关掉重开，云端档读回覆盖本地。
4. 后台 `http://127.0.0.1:8891/admin` 登录即可检索/查看/改档/封禁。

> 默认 `?cloud` 关闭（纯本地存档）。`?cloud=1` 指向 `127.0.0.1:8891`，也可 `?cloud=http://host:port` 指定其他地址。

## 四、测试

```bash
node tests/test-e2e.mjs          # 服务端端到端（登录→推档→结算→后台改档/封禁）
node tests/test-cloudclient.mjs  # 客户端 CloudClient 对服务器功能测试（需先起服务）
```

## 五、环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TK_PORT` | `8891` | 监听端口 |
| `TK_DB_PATH` | `server/tk.db` | SQLite 文件路径 |
| `TK_JWT_SECRET` | 开发默认值 | JWT 签名密钥（生产必改） |
| `TK_ADMIN_USER` / `TK_ADMIN_PASS` | `admin` / `admin123` | 默认超管种子 |

## 六、目录结构

```
server/
├── app.js               # HTTP 入口（API + 静态托管后台）
├── config.js            # 配置（端口/DB/JWT/超管种子）
├── db/                  # index.js 建表 + dao.js 数据访问
├── shared/meta/         # LadderSystem.js 服务端权威结算纯函数副本
├── services/            # auth / profile / admin 业务
├── routes/              # 路由表 + 鉴权分发
├── middleware/auth.js   # JSON 读取 + token 鉴权
├── utils/               # token(JWT) / password(scrypt)
├── scripts/init-admin.js
├── admin/               # 运营后台前端（index.html + app.js + style.css）
├── tests/               # e2e / cloudclient 测试
└── tk.db                # SQLite 数据库（运行时生成）
```

详细设计见 `territory-king-developer/server-backend-design.md`，本地存档字段字典见 `admin-data-manual.md`。
