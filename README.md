# Model Check

AI 模型多渠道可用性检测与代理转发平台。支持 OpenAI / Claude / Gemini / Codex 等多种 API 格式，提供定时自动检测、多密钥管理、WebDAV 同步等功能。

## 功能特性

- **多渠道管理** - 添加和管理多个 API 渠道，支持独立代理配置
- **自动检测** - 定时批量检测模型可用性，支持 Cron 表达式和自定义检测范围
- **多协议代理** - 兼容 OpenAI Chat / Anthropic Messages / Google Gemini / OpenAI Responses 四种 API 格式
- **多密钥轮询** - 单渠道支持多 API Key，按 Round-Robin 策略轮询分发
- **代理密钥管理** - 创建多个代理密钥，支持按渠道/模型维度的细粒度权限控制
- **WebDAV 同步** - 渠道配置自动同步到坚果云/NextCloud 等 WebDAV 服务
- **模型关键词** - 通过关键词自动匹配筛选模型，自定义检测范围
- **实时进度** - SSE 推送检测进度，前端实时更新状态
- **并发控制** - 支持单渠道和全局两级并发限制，防止 API 限流
- **日志清理** - 自动定时清理过期检测日志

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router, RSC) |
| 语言 | TypeScript |
| 数据库 | PostgreSQL + Prisma 7 |
| 队列 | BullMQ + Redis (IORedis) |
| 前端 | React 19 + Tailwind CSS 4 + shadcn/ui |
| 部署 | Docker + Docker Compose |

## 快速开始

### 一键部署（推荐）

```bash
# 克隆项目
git clone https://github.com/chxcodepro/model-check.git
cd model-check

# 全本地部署（PostgreSQL + Redis 本地运行）
bash deploy.sh --local

# 使用云数据库（Supabase/Neon）
bash deploy.sh --cloud-db

# 快速模式（跳过可选配置）
bash deploy.sh --quick
```

部署完成后访问 `http://localhost:3000`，使用你设置的管理员密码登录。

### 部署模式

| 模式 | 命令 | 说明 |
|------|------|------|
| 全本地 | `--local` | PostgreSQL + Redis 本地容器运行（默认） |
| 云数据库 | `--cloud-db` | 使用 Supabase/Neon 等云数据库，Redis 本地运行 |
| 云 Redis | `--cloud-redis` | 本地数据库，使用 Upstash 等云 Redis |
| 全云端 | `--cloud` | 数据库和 Redis 全部使用云服务 |

### 更新部署

```bash
bash deploy.sh --update
```

该命令会拉取最新代码、重建镜像、自动执行数据库增量迁移。

### 本地开发

```bash
# 安装依赖
npm install

# 复制环境变量（按需修改 .env 中的 DATABASE_URL 等）
copy .env.example .env

# 启动数据库（需已安装 Docker）
docker compose --profile local up -d postgres redis

# 初始化数据库表结构
npm run db:sync

# 启动开发服务器
npm run dev
```

## 环境变量

复制 `.env.example` 为 `.env` 并修改：

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `ADMIN_PASSWORD` | 是 | `admin123` | 管理面板登录密码 |
| `JWT_SECRET` | 是 | - | JWT 签名密钥，不设置则重启后会话失效 |
| `DATABASE_URL` | 是 | 本地 PostgreSQL | 数据库连接字符串 |
| `REDIS_URL` | 是 | `redis://localhost:6379` | Redis 连接字符串 |
| `COMPOSE_PROFILES` | - | `local` | Docker 部署模式：`local` / `redis` / `db` |
| `CRON_SCHEDULE` | - | `0 0,8,12,16,20 * * *` | 检测计划（Cron 格式） |
| `CRON_TIMEZONE` | - | `Asia/Shanghai` | 定时任务时区 |
| `CHANNEL_CONCURRENCY` | - | `5` | 单渠道最大并发 |
| `MAX_GLOBAL_CONCURRENCY` | - | `30` | 全局最大并发 |
| `GLOBAL_PROXY` | - | - | 全局代理（HTTP/HTTPS/SOCKS5） |
| `PROXY_API_KEY` | - | 自动生成 | 代理接口密钥，不设置则每次重启变化 |
| `WEBDAV_URL` | - | - | WebDAV 服务地址 |
| `WEBDAV_USERNAME` | - | - | WebDAV 用户名 |
| `WEBDAV_PASSWORD` | - | - | WebDAV 密码/应用密码 |
| `LOG_RETENTION_DAYS` | - | `7` | 检测日志保留天数 |

完整变量列表见 [`.env.example`](.env.example)。

## API 代理

部署后可作为 API 代理使用，兼容以下格式：

| 端点 | 兼容协议 |
|------|----------|
| `POST /v1/chat/completions` | OpenAI Chat API |
| `POST /v1/messages` | Anthropic Claude Messages API |
| `POST /v1/responses` | OpenAI Responses API |
| `POST /v1beta/models/{model}:generateContent` | Google Gemini API |
| `POST /v1beta/models/{model}:streamGenerateContent` | Google Gemini Streaming |

请求时在 `Authorization` 头携带代理密钥：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-proxy-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'
```

代理密钥可在管理面板创建和管理，支持按渠道/模型维度限制访问权限。

详细文档见部署后的 `/docs/proxy` 页面。

## 项目结构

```
model-check/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API 路由
│   │   │   ├── channel/        # 渠道管理 CRUD
│   │   │   ├── detect/         # 手动检测触发
│   │   │   ├── scheduler/      # 定时任务管理
│   │   │   ├── proxy-keys/     # 代理密钥管理
│   │   │   └── ...
│   │   ├── v1/                 # API 代理端点
│   │   │   ├── chat/completions/
│   │   │   ├── messages/
│   │   │   └── responses/
│   │   ├── v1beta/             # Gemini API 代理
│   │   └── docs/proxy/         # 代理文档页面
│   ├── components/             # React 组件
│   ├── lib/
│   │   ├── detection/          # 检测执行逻辑
│   │   ├── proxy/              # 代理转发核心
│   │   ├── queue/              # BullMQ 队列与 Worker
│   │   ├── scheduler/          # Cron 定时调度
│   │   └── webdav/             # WebDAV 同步
│   └── hooks/                  # React Hooks
├── prisma/
│   ├── schema.prisma           # 数据库模型定义
│   └── init.postgresql.sql     # 数据库初始化 & 增量迁移（幂等）
├── deploy.sh                   # 一键部署脚本
├── docker-compose.yml          # Docker Compose 配置
├── Dockerfile                  # 多阶段 Docker 构建
└── .env.example                # 环境变量模板
```

## 常用命令

```bash
# 查看服务状态
bash deploy.sh --status

# 查看应用日志
docker logs -f model-check

# 重启服务
docker compose restart

# 停止所有服务
docker compose down
```

### 版本更新后同步数据库

更新代码后如果数据库表结构有变动（新增字段、索引等），需要执行一次同步。脚本幂等，重复执行不会丢失数据。

```bash
# Docker 部署：deploy.sh 更新时会自动同步
bash deploy.sh --update

# 本地开发 / 云数据库：一条命令搞定（读取 .env 中的 DATABASE_URL）
npm run db:sync
```

## 云服务推荐

| 服务 | 推荐平台 |
|------|----------|
| PostgreSQL | [Supabase](https://supabase.com)（免费）、[Neon](https://neon.tech)（免费） |
| Redis | [Upstash](https://upstash.com)（免费）、[Redis Cloud](https://redis.com/cloud/) |

## License

MIT
