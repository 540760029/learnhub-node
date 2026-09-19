# LearnHub · 课程学习与 AI 出题平台

面向高校课程的在线学习平台：**教师**发布课程/知识点/作业/试题并查看学情，
**学生**加入课程、交作业、做模拟题看解析，并可按自己的**薄弱知识点**让 AI 自动出题。

> **运行环境：Cloudflare Workers + D1（SQLite）** · 免费版即可部署
> 前端零构建、后端零运行时依赖，本地开发无需 Cloudflare 账号。

---

## 一、最快上手（本地，不需要 Cloudflare 账号）

```bash
npm install          # 只装 wrangler（开发用），生产运行时零依赖
node server.js       # ← 内存数据库，自带演示数据
```

打开 **http://127.0.0.1:8787**

| 身份 | 邮箱 | 密码 |
|---|---|---|
| 管理员 | `admin@demo.edu` | `demo1234` |
| 教师 | `teacher@demo.edu` | `demo1234` |
| 学生 | `student@demo.edu` | `demo1234` |

课程邀请码 **`DEMO01`**

想要数据落盘不丢：`node server.js --file`（写入 `data/learnhub.db`，已在 .gitignore 里）

### 跑测试

```bash
npm test            # 63 项端到端断言（用内存 SQLite，无需网络）
```

---

## 二、本地按「真 Cloudflare 环境」跑

用 Wrangler 起本地 Workers 运行时 + 本地 D1，**和线上架构完全一致**：

```bash
# 1) 建本地 D1 并建表
npx wrangler d1 execute learnhub --local --file=./migrations/0001_schema.sql

# 2) 灌演示数据（含算好的密码哈希）
node scripts/make-seed-sql.js
npx wrangler d1 execute learnhub --local --file=./migrations/0002_seed.sql

# 3) 启动
npx wrangler dev          # → http://127.0.0.1:8787
```

---

## 三、部署到 Cloudflare（免费额度）

### 1. 登录并创建 D1

```bash
npx wrangler login
npx wrangler d1 create learnhub
```

把输出里的 `database_id` 填进 `wrangler.jsonc`（替换 `REPLACE_WITH_YOUR_D1_DATABASE_ID`）。

### 2. 建表 + 灌演示数据（远程）

```bash
npx wrangler d1 execute learnhub --remote --file=./migrations/0001_schema.sql
npx wrangler d1 execute learnhub --remote --file=./migrations/0002_seed.sql
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
也可以在 Cloudflare 控制台绑自定义域名。

### 5. 上线检查清单

- [ ] `LEARNHUB_SECRET` 已设为随机值（且**已备份**：换了之后用户已存的 Key 解不开）
- [ ] 演示账号要么改密码，要么删掉（`admin@demo.edu` / `teacher@demo.edu` / `student@demo.edu`）
- [ ] 平台 AI Key 由管理员登录后台「🔑 平台 AI Key」上传（加密存库，对所有用户生效）
- [ ] 不想要演示数据：跳过第 2 步的 `0002_seed.sql`，或部署后删掉演示账号
- [ ] 已跑过 `npm test` 且全绿

---

## 四、项目结构

```
learnhub-node/
├── src/
│   ├── worker.js        Cloudflare Workers 入口（fetch handler）
│   ├── app.js           全部 API 路由 + 权限 + AI 编排（Fetch 原生，运行时无关）
│   ├── router.js        极简 Fetch 路由器（零依赖，Workers/Node/Deno 通用）
│   ├── db.js            D1 数据访问层
│   ├── security.js      PBKDF2 密码 / HMAC 会话 / AES-GCM 加密 Key（WebCrypto）
│   ├── llm.js           6 家 OpenAI 兼容服务商 + 出题 + 资料→知识点 + 离线 Mock
│   ├── config.js        配置与 settings 键名
│   ├── bootstrap.js     装配（建库 + 种子 + 应用），server 与测试共用
│   ├── node-adapter.js  Node HTTP ↔ Fetch 适配（仅本地开发用）
│   └── dev-d1.js        用 node:sqlite 模拟 D1 接口（仅本地开发用）
├── public/              前端（零构建原生 HTML/CSS/JS，无 CDN 依赖）
├── migrations/
│   ├── 0001_schema.sql  建表
│   └── 0002_seed.sql    种子数据（由脚本生成）
├── scripts/
│   ├── make-seed-sql.js     生成种子 SQL（算好密码哈希）
│   └── hash-password.js     单独生成密码哈希
├── test/api.test.js     63 项端到端测试
├── server.js            本地开发服务器
└── wrangler.jsonc       Cloudflare 配置
```

### 为什么不用 Express

Express 依赖 `on-finished` 读取 `req.socket`，而 Workers 用的是 fetch 风格 `Request`
（**没有 socket**）。实测：**任何 Express 应用在 Workers 上都会 500**，
哪怕只是 `app.get('/', ...)` 也会挂在 `finalhandler`。

所以这里用 Fetch 标准 API 自己写了个 80 行的路由器：Workers 原生运行，
Node/Deno/Bun 也能直接跑，且**零运行时依赖**。

---

## 五、功能清单

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

## 六、AI 出题额度规则

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

## 七、可见性（scope）模型

知识点与试题都带 `scope`，三档：

| scope | 谁能看到 | 谁创建 |
|---|---|---|
| `course` | 全班（所有学生 + 教师） | 教师 |
| `teacher` | 仅教师（学生完全不可见） | 教师 |
| `private` | 仅创建者本人（教师可见以便答疑） | 学生（强制） |

学生**无法**把自己的知识点或试题设为公开——后端强制改写为 `private`，
绕过前端直接调 API 也会被拦（有测试覆盖）。

---

## 八、环境变量

非敏感项放 `wrangler.jsonc` 的 `vars`，密钥用 `wrangler secret put`。

| 变量 | 说明 |
|---|---|
| `LEARNHUB_SECRET` | **必设**。会话签名 + API Key 加密主密钥 |
| `LEARNHUB_DEFAULT_PROVIDER` | 默认服务商，默认 `deepseek` |
| `LEARNHUB_DAILY_AI_LIMIT` | 教师/学生每日出题套数，默认 3（管理员可后台改） |
| `LEARNHUB_PLATFORM_API_KEY` | 平台 Key 的容器初始化兜底；正常应在后台上传 |

---

## 九、免费额度够不够

D1 免费版：**每天 500 万次读、10 万次写**，存储 5 GB。
Workers 免费版：**每天 10 万次请求**，静态资源请求不计费。

自己/小圈子用完全够。上千学生同时高频答题时写入可能吃紧——
那时把 D1 换成付费档（$5/月）或改用 Hyperdrive + 外部 Postgres 即可，
数据层已经隔离在 `src/db.js`，替换成本很低。

> ⚠️ **国内访问提醒**：Cloudflare 免费版走海外节点，国内直连延迟可能较高。
> 主要用户在境内的话，上线前**先让学生实测**；必要时考虑国内云 + 域名备案。

---

## 十、许可证

[MIT License](LICENSE) · Copyright (c) 2026 李小凡 (Xiaofan Li)
