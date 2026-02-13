# Model Check

AI 模型 API 渠道可用性检测与统一代理平台。管理多个 AI API 渠道，定期检测各模型可用性，并提供兼容 OpenAI / Claude / Gemini 的统一代理接口。

## 功能特性

- **多渠道管理** — 集中管理多个 AI API 渠道，支持导入/导出、批量操作、公开上传
- **自动检测** — 定时检测所有渠道的模型可用性，支持 Cron 表达式自定义周期
- **多端点支持** — 覆盖 OpenAI Chat、Claude Messages、Gemini、Codex/Responses、Image 五种 API 格式
- **统一代理** — 一个入口转发所有渠道请求，兼容 `/v1/chat/completions`、`/v1/messages`、`/v1/responses`、`/v1beta/models` 等接口
- **智能路由** — 根据模型名自动匹配渠道，支持渠道前缀精确指定，多密钥轮询/随机负载均衡
- **多密钥权限** — 创建多个代理密钥，细粒度控制可访问的渠道和模型
- **实时监控** — SSE 实时推送检测进度，仪表盘展示健康率和历史热力图
- **模型同步** — 自动从渠道 `/v1/models` 获取模型列表，支持关键词过滤
- **WebDAV 同步** — 支持坚果云、NextCloud 等，多设备同步渠道配置
- **代理支持** — 全局/渠道级 HTTP/HTTPS/SOCKS5 代理
- **暗色主题** — 支持亮色/暗色切换

## 快速开始

### Docker 一键部署（推荐）

```bash
# 克隆项目
git clone https://github.com/chxcodepro/model-check.git
cd model-check

# 一键部署（全本地模式，自带 PostgreSQL + Redis）
bash deploy.sh --local
```

部署脚本支持多种模式：

| 命令 | 说明 |
|------|------|
| `bash deploy.sh --local` | 全本地模式 — PostgreSQL + Redis 本地运行 |
| `bash deploy.sh --cloud-db` | 云数据库模式 — 使用 Supabase/Neon，本地 Redis |
| `bash deploy.sh --cloud-redis` | 云 Redis 模式 — 本地 PostgreSQL，使用 Upstash |
| `bash deploy.sh --cloud` | 全云端模式 — 数据库和 Redis 均使用云服务 |
| `bash deploy.sh --quick` | 快速模式 — 跳过可选配置 |
| `bash deploy.sh --update` | 更新部署 — 拉取最新代码/镜像并迁移数据库 |
| `bash deploy.sh --status` | 查看服务运行状态 |

### Docker Compose 手动部署

```bash
# 复制并编辑环境变量
cp .env.example .env
# 编辑 .env，至少修改 ADMIN_PASSWORD 和 JWT_SECRET

# 启动服务
docker compose up -d

# 查看日志
docker logs -f model-check
```

### 本地开发（Windows + Docker）

```powershell
# 安装依赖
npm install

# 配置环境变量
Copy-Item .env.example .env

# 数据库环境DATABASE_URL:
# postgresql://modelcheck:modelcheck123456@localhost:5432/model_check

# 设置本地环境变量
$env:COMPOSE_PROFILES="local"

# 启动本地 PostgreSQL + Redis
docker compose up -d postgres redis

# 若 5432 被占用，先查实际映射端口，再更新 DATABASE_URL
docker compose port postgres 5432

# 同步数据库结构
npm run db:push

# 启动开发服务器
npm run dev
```

访问 `http://localhost:3000`，使用 `ADMIN_PASSWORD` 登录管理面板。

## 环境变量

复制 `.env.example` 为 `.env`，按需修改：

### 必须配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ADMIN_PASSWORD` | 管理员登录密码 | `change-this-password` |
| `JWT_SECRET` | JWT 签名密钥，建议用 `openssl rand -base64 32` 生成 | `change-this-secret-key` |
| `DATABASE_URL` | PostgreSQL 连接串 | 本地默认值 |
| `REDIS_URL` | Redis 连接串 | `redis://localhost:6379` |

### 可选配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `COMPOSE_PROFILES` | 部署模式：`local` / `redis` / `db` / 不设置 | `local` |
| `AUTO_DETECT_ENABLED` | 启动时自动开始检测 | `false` |
| `DETECT_PROMPT` | 检测用提示词 | `1+1=2? yes or no` |
| `CRON_SCHEDULE` | 检测周期（Cron 表达式） | `0 0,8,12,16,20 * * *` |
| `CRON_TIMEZONE` | 定时任务时区 | `Asia/Shanghai` |
| `CHANNEL_CONCURRENCY` | 单渠道最大并发 | `5` |
| `MAX_GLOBAL_CONCURRENCY` | 全局最大并发 | `30` |
| `GLOBAL_PROXY` | 全局代理（HTTP/HTTPS/SOCKS5） | — |
| `PROXY_API_KEY` | 代理接口固定密钥，不设置则自动生成 | — |
| `LOG_RETENTION_DAYS` | 检测日志保留天数 | `7` |

### WebDAV 同步（可选）

| 变量 | 说明 |
|------|------|
| `WEBDAV_URL` | WebDAV 服务器地址 |
| `WEBDAV_USERNAME` | WebDAV 用户名 |
| `WEBDAV_PASSWORD` | WebDAV 密码/应用密码 |
| `WEBDAV_FILENAME` | 同步文件路径，默认 `channels.json` |

## API 代理使用

部署后可作为统一 API 代理使用，兼容以下接口：

| 接口 | 方法 | 兼容 |
|------|------|------|
| `/v1/chat/completions` | POST | OpenAI Chat |
| `/v1/messages` | POST | Anthropic Claude |
| `/v1/responses` | POST | OpenAI Responses (GPT-5/Codex) |
| `/v1/models` | GET | OpenAI Models |
| `/v1beta/models/{model}:generateContent` | POST | Google Gemini |
| `/v1beta/models/{model}:streamGenerateContent` | POST | Google Gemini Streaming |

### 示例

```bash
# OpenAI 格式
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer your-proxy-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# 指定渠道（渠道名/模型名）
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer your-proxy-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-channel/gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Claude 格式
curl http://localhost:3000/v1/messages \
  -H "x-api-key: your-proxy-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

完整文档请访问部署后的 `/docs/proxy` 页面。

## 版本更新

新版本可能包含数据库字段变更。一条命令完成更新（拉取代码 + 镜像 + 自动迁移数据库）：

```bash
bash deploy.sh --update
```

脚本会自动执行：拉取最新代码 → 拉取最新镜像 → 重启服务 → 使用幂等 SQL 同步数据库结构。

<details>
<summary>手动更新 / 迁移失败排查</summary>

```bash
# 手动更新完整流程
git pull
docker compose pull app && docker compose up -d
docker compose exec -T postgres psql -U modelcheck -d model_check < prisma/init.postgresql.sql
```

如需手动同步数据库结构，可执行幂等 SQL 脚本（重复执行安全，不会破坏数据）：

```bash
# Docker 本地数据库
docker compose exec -T postgres psql -U modelcheck -d model_check < prisma/init.postgresql.sql

# 云数据库
psql "$DATABASE_URL" < prisma/init.postgresql.sql
```

</details>

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16、React 19、TypeScript、Tailwind CSS 4 |
| 后端 | Next.js App Router API Routes |
| 数据库 | PostgreSQL 16 + Prisma 7 |
| 队列 | Redis 7 + BullMQ |
| 定时任务 | cron |
| 认证 | JWT + bcryptjs |
| 部署 | Docker + Docker Compose |

## 常用命令

```bash
# 查看日志
docker logs -f model-check

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 更新部署
bash deploy.sh --update

# 查看状态
bash deploy.sh --status
```

## 许可证

[MIT](LICENSE)
