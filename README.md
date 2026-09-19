# LearnHub · 课程学习与 AI 出题平台

面向高校课程的在线学习平台：**教师**发布课程/知识点/作业/试题并查看学情，
**学生**加入课程、交作业、做模拟题看解析，并可按自己的**薄弱知识点**让 AI 自动出题。

## 一套代码，两种部署

| | Cloudflare（推荐自用/海外） | 国内云（推荐给国内学生） |
|---|---|---|
| 运行时 | Workers（Serverless，免费额度大） | Node.js（阿里云/腾讯云学生机等） |
| 数据库 | **D1**（Cloudflare 托管 SQLite） | **MySQL**（云数据库或本机） |
| 成本 | 免费版够用 | 学生机约 ¥10/月 |
| 国内访问 | ⚠️ `*.workers.dev` 域名**可能不可达**（见第十一节实测） | ✅ 正常 |

切换只改一个环境变量 `LEARNHUB_DB_DRIVER`（`d1` / `mysql`），**业务代码一行不动**。
前端零构建，后端零强制依赖（MySQL 驱动是可选依赖，不用就不会被加载）。

---

## 一、最快上手（本地，不需要 Cloudflare 账号）

```bash
npm install          # 只装 wrangler（开发用）
node server.js       # ← 内存 SQLite，自带演示数据
```

打开 **http://127.0.0.1:8787**

| 身份 | 邮箱 | 密码 |
|---|---|---|
| 管理员 | `admin@demo.edu` | `demo1234` |
| 教师 | `teacher@demo.edu` | `demo1234` |
| 学生 | `student@demo.edu` | `demo1234` |

课程邀请码 **`DEMO01`**

其他本地模式：

```bash
node server.js --file     # 落盘 data/learnhub.db，重启不丢
node server.js --mysql    # 连 MySQL（需 LEARNHUB_DB_URL），与国内云同款
npm test                  # 63 项端到端测试（内存 SQLite，无需网络）
```

---

## 二、本地按「真 Cloudflare 环境」跑

用 Wrangler 起本地 Workers 运行时 + 本地 D1，**和线上架构完全一致**：

```bash
# 1) 建本地 D1 并建表
npm run db:local

# 2) 灌演示数据（含算好的密码哈希）
npm run db:seed:local

# 3) 启动
npm run dev:worker        # → http://127.0.0.1:8787
```

---

## 三、部署到 Cloudflare（D1，免费额度）

### 1. 登录并创建 D1

```bash
npx wrangler login
npx wrangler d1 create learnhub
```

把输出里的 `database_id` 填进 `wrangler.jsonc`。

### 2. 建表 + 灌演示数据（远程）

```bash
npm run db:remote
npm run db:seed:remote
```

### 3. 【必做】设置会话密钥

```bash
# 生成一个随机值
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# 写入 Worker secret（不会进代码库）
npx wrangler secret put LEARNHUB_SECRET
```

> ⚠️ **不设置会怎样**：代码里的默认值是公开的，任何知道它的人都能
> **伪造管理员登录令牌**、并**解密数据库里已保存的所有用户 API Key**。
> 上线前必须换成随机值。

### 4. 部署

```bash
npx wrangler deploy
```

部署后会得到 `https://learnhub.<你的子域>.workers.dev`。

### 5. 上线检查清单

- [ ] `LEARNHUB_SECRET` 已设为随机值（且**已备份**：换了之后用户已存的 Key 解不开）
- [ ] 演示账号要么改密码，要么删掉（`admin@demo.edu` / `teacher@demo.edu` / `student@demo.edu`）
- [ ] 平台 AI Key 由管理员登录后台「🔑 平台 AI Key」上传（加密存库，对所有用户生效）
- [ ] 不想要演示数据：跳过第 2 步的 `0002_seed.sql`，或部署后删掉演示账号
- [ ] 已跑过 `npm test` 且全绿

---

## 四、部署到国内云（Node + MySQL）

给国内学生用请走这条 —— 没有域名被墙问题，也不依赖 Cloudflare。

### 1. 准备 MySQL

任选其一：
- 云厂商的云数据库 MySQL（阿里云 RDS / 腾讯云 CDN 等）
- 直接在服务器上装：`apt install mysql-server`，建库建账号：

```sql
CREATE DATABASE learnhub DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'learnhub'@'%' IDENTIFIED BY '你的强密码';
GRANT ALL PRIVILEGES ON learnhub.* TO 'learnhub'@'%';
FLUSH PRIVILEGES;
```

### 2. 生成并执行建表脚本

MySQL 版 schema 是**从 SQLite schema 自动翻译**出来的（唯一事实来源只有一份）：

```bash
npm run sql:mysql      # 生成 migrations/mysql/0001_schema.sql（含种子数据）
mysql -h 主机 -u learnhub -p learnhub < migrations/mysql/0001_schema.sql
```

> 脚本生成后自带自检：若残留 `AUTOINCREMENT` / `PRAGMA` / `ON CONFLICT` 会报错退出。

### 3. 安装依赖并启动

```bash
npm install --omit=dev          # 只装运行期依赖（可选依赖 mysql2 会被装上）
npx wrangler --version >nul 2>&1 || true     # 服务器上不需要 wrangler

# 配置环境变量（建议写进 systemd 或 .env 后 export）
set LEARNHUB_DB_DRIVER=mysql
set LEARNHUB_DB_URL=mysql://learnhub:密码@127.0.0.1:3306/learnhub
set LEARNHUB_SECRET=换成随机值
set PORT=8080
set HOST=0.0.0.0

node server.js                  # → http://服务器IP:8080
```

> `LEARNHUB_DB_DRIVER=mysql` 时启动不会自动建表（表应由上面的 SQL 建立），
> 所以先跑第 2 步。

### 4. 用 systemd 常驻（推荐）

```ini
# /etc/systemd/system/learnhub.service
[Unit]
Description=LearnHub
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/learnhub
Environment=LEARNHUB_DB_DRIVER=mysql
Environment=LEARNHUB_DB_URL=mysql://learnhub:密码@127.0.0.1:3306/learnhub
Environment=LEARNHUB_SECRET=换成随机值
Environment=HOST=0.0.0.0
Environment=PORT=8080
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now learnhub
```

### 5. 前面挂 Nginx + HTTPS

```nginx
server {
  listen 443 ssl;
  server_name learn.你的域名.com;
  # ssl_certificate ...（用 certbot 免费签）

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

> ⚠️ **国内服务器绑域名必须备案**（否则 80/443 会被拦）。没备案的话先用 IP:端口 访问。

---

## 五、项目结构

```
learnhub-node/
├── src/
│   ├── worker.js        Cloudflare Workers 入口（fetch handler）
│   ├── app.js           全部 API 路由 + 权限 + AI 编排（运行时无关）
│   ├── router.js        极简 Fetch 路由器（零依赖，Workers/Node/Deno 通用）
│   ├── drivers.js       数据库驱动层：D1 / SQLite / MySQL，接口一致
│   ├── db.js            数据访问层（面向驱动接口，方言无关的 upsert）
│   ├── security.js      PBKDF2 密码 / HMAC 会话 / AES-GCM 加密 Key（WebCrypto）
│   ├── llm.js           6 家 OpenAI 兼容服务商 + 出题 + 资料→知识点 + 离线 Mock
│   ├── sql-dialect.js   SQLite → MySQL 方言转换
│   ├── config.js        配置与 settings 键名
│   ├── bootstrap.js     装配（建库 + 种子 + 应用），server 与测试共用
│   └── node-adapter.js  Node HTTP ↔ Fetch 适配（本地/国内云用）
├── public/              前端（零构建原生 HTML/CSS/JS，无 CDN 依赖）
├── migrations/
│   ├── 0001_schema.sql       建表（SQLite/D1 方言，唯一事实来源）
│   ├── 0002_seed.sql         种子数据（由脚本生成）
│   └── mysql/0001_schema.sql MySQL 版（由 npm run sql:mysql 自动生成）
├── scripts/
│   ├── make-seed-sql.js     生成种子 SQL（算好密码哈希）
│   ├── make-mysql-sql.js    生成 MySQL 建库脚本
│   └── hash-password.js     单独生成密码哈希
├── test/api.test.js     63 项端到端测试
├── server.js            本地开发 / 国内云服务器入口
└── wrangler.jsonc       Cloudflare 配置
```

### 为什么不用 Express

Express 依赖 `on-finished` 读取 `req.socket`，而 Workers 用的是 fetch 风格 `Request`
（**没有 socket**）。实测：**任何 Express 应用在 Workers 上都会 500**，
哪怕只是 `app.get('/', ...)` 也会挂在 `finalhandler`。

所以这里用 Fetch 标准 API 自己写了个约 150 行的路由器：Workers 原生运行，
Node/Deno/Bun 也能直接跑。业务代码只依赖 `Request`/`Response`，
因此同一份代码能同时跑在 Cloudflare 和国内 Node 服务器上。

### 数据库差异怎么处理的

| 差异点 | 处理方式 |
|---|---|
| D1 是 binding、MySQL 是连接池 | `src/drivers.js` 统一成 `all/first/run/batch/execScript` 接口 |
| `ON CONFLICT ... excluded.x` vs `ON DUPLICATE KEY ... VALUES(x)` | 改用**先 UPDATE、没命中再 INSERT** 的通用写法（`db.upsert`），两边语义一致 |
| `AUTOINCREMENT` / `PRAGMA` / `TEXT` 索引 | `src/sql-dialect.js` 机械翻译，`npm run sql:mysql` 生成 MySQL schema |
| 唯一约束错误码不同 | 驱动各自实现 `isDuplicateError`，业务层只调 `db.isDuplicate(err)` |

---

## 六、功能清单

### 管理员（平台级）
- **🔑 平台 AI Key**：上传/更新平台默认 Key（AES-GCM 加密存库，**对全体用户生效**）
  - 选服务商（DeepSeek / OpenAI / 通义 / 智谱 / Kimi / 自定义）、自定义模型与 Base URL
  - 调整教师/学生每日额度；启用/停用；留空不覆盖；一键测试连通性；清除 Key
- **总览**：用户/教师/学生/管理员数、课程、知识点、试题、题目、作业、提交、答题记录、今日 AI 调用
- **用户管理**：搜索、改角色、设为/取消管理员、停用/启用、删除
- **课程管理**：全部课程列表、进入任意课程、删除课程

### 教师
- 建课 → 自动生成**邀请码**；发布知识点（全班可见 / 仅教师可见）
- **上传资料自动整理知识点**：`.txt / .md / .csv` → AI 切分 → 预览可逐条编辑 → 选可见范围入库
- 发布作业、查看提交、打分写评语
- 手工组卷（单选/多选/判断，**缺解析会被拒绝**）
- **试题列表与详情**：答案解析 + 每题正确率 + 作答人次/人数/均分 + 学生明细与错题号
- 随时切换试卷可见性；**学情分析看板**（班级薄弱知识点排行、学生明细、答题趋势）

### 学生
- 凭邀请码加入课程；看知识点、交作业（可反复更新直到被打分）
- 做模拟题 → **提交前校验完成度**（没做完不允许提交，可点题号跳过去继续做）
  → 交卷后**逐题标绿正确选项 + 详细解析** → 可**重新作答**（历史成绩保留）
- **AI 智能出题**：按薄弱知识点出题，生成的题**仅自己可见**
- **添加自己的课程笔记**（强制仅本人可见；教师可见以便答疑，同学看不到）

---

## 七、AI 出题额度规则

平台默认 Key 由管理员在后台配置，**对全体用户生效**；额度上限也可随时调整。

| 角色 / 用谁的 Key | 额度 |
|---|---|
| 任何角色**用自己的 Key** | **不限次数** |
| **管理员**（用平台默认 Key） | **不限次数** |
| 教师（用平台默认 Key） | 每日 **N** 套（默认 3，管理员可改） |
| 学生（用课程教师 / 平台默认 Key） | 每日 **N** 套 |
| 平台 Key 未配置或已停用 | 降级为**离线模拟题**，流程照常可演示 |

Key 优先级：**自己的 Key → 管理员配置的平台 Key → 课程教师的 Key → 平台 Key（限次）**

- 生成**失败不扣额度**（只在成功落库后才计数）
- API Key 用 **AES-256-GCM** 加密入库，接口只回显**后 4 位**，连管理员也取不回明文

---

## 八、可见性（scope）模型

知识点与试题都带 `scope`，三档：

| scope | 谁能看到 | 谁创建 |
|---|---|---|
| `course` | 全班（所有学生 + 教师） | 教师 |
| `teacher` | 仅教师（学生完全不可见） | 教师 |
| `private` | 仅创建者本人（教师可见以便答疑） | 学生（强制） |

学生**无法**把自己的知识点或试题设为公开——后端强制改写为 `private`，
绕过前端直接调 API 也会被拦（有测试覆盖）。

---

## 九、环境变量

Cloudflare 用 `wrangler.jsonc` 的 `vars` + `wrangler secret put`；
国内云直接 `export` 或用 systemd 的 `Environment=`。

| 变量 | 说明 | 适用 |
|---|---|---|
| `LEARNHUB_SECRET` | **必设**。会话签名 + API Key 加密主密钥 | 两者 |
| `LEARNHUB_DB_DRIVER` | `d1` / `mysql` / 留空（本地 SQLite） | 国内云必填 `mysql` |
| `LEARNHUB_DB_URL` | `mysql://user:pass@host:3306/db` | 国内云必填 |
| `PORT` / `HOST` | 监听地址，默认 `8787` / `127.0.0.1` | 国内云建议 `0.0.0.0` |
| `LEARNHUB_DEFAULT_PROVIDER` | 默认 AI 服务商，默认 `deepseek` | 两者 |
| `LEARNHUB_DAILY_AI_LIMIT` | 教师/学生每日出题套数，默认 3（管理员可后台改） | 两者 |
| `LEARNHUB_PLATFORM_API_KEY` | 平台 Key 的初始化兜底；正常应在管理员后台上传 | 两者 |

> 数据库驱动选择优先级：**显式传入的 D1 绑定 > `LEARNHUB_DB_DRIVER` > 本地 SQLite**。
> 所以同一份代码在 Cloudflare 上自动用 D1，在服务器上设 `mysql` 就切到 MySQL。

---

## 十、免费额度与国内访问实测

**Cloudflare**：D1 免费版每天 500 万次读 / 10 万次写（存储 5 GB）；
Workers 免费版每天 10 万次请求，静态资源不计费。自己/小圈子用完全够。

**国内云**：学生机约 ¥10/月，无请求数限制，国内访问快。

### ⚠️ 关于 `*.workers.dev` 的实测结论

我在本机（国内网络）对已部署的 Cloudflare 版本做过完整测试：

| 检查项 | 结果 |
|---|---|
| DNS 解析 `learnhub.540760029.workers.dev` | ✅ 正常（→ 50.87.93.246） |
| TCP 连接 443 | ❌ **超时**（21 秒无响应） |
| 换 Cloudflare 边缘 IP 重试 | ❌ **连接被重置** |
| 对照：`www.cloudflare.com` | ✅ HTTP 200（2.0 秒） |
| 对照：`dash.cloudflare.com` | ✅ HTTP 403（1.8 秒，正常响应） |

**Cloudflare 本身在国内是通的**（登录、建库、部署都成功），
但 **`workers.dev` 这个共享域名被按 SNI 拦截了** —— 换 IP 也被重置，
说明不是 IP 层问题。

**所以给国内学生用，请走第四节（国内云 + MySQL）。**
如果只是想自己/海外访问，Cloudflare 版本可以绑一个自己的域名
（Cloudflare 控制台 → Workers → Settings → Domains & Routes → Add Custom Domain），
自建域名通常不会被拦。

---

## 十一、许可证

[MIT License](LICENSE) · Copyright (c) 2026 李小凡 (Xiaofan Li)
