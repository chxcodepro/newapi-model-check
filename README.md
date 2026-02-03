# NewAPI Model Check

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org/)
[![TiDB](https://img.shields.io/badge/TiDB-Supported-red)](https://www.pingcap.com/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED)](https://www.docker.com/)

API 渠道可用性检测系统 - 实时监控多个 API 渠道的模型可用性状态，并提供统一的 API 代理服务。

## 功能特性

### 监控功能
- **多端点检测** - 支持 OpenAI Chat、Claude、Gemini、Codex 等多种 API 格式
- **实时监控** - SSE 实时推送检测进度和结果
- **定时任务** - 可配置的周期性检测（默认每天 0/8/12/16/20 点）
- **数据清理** - 自动清理过期日志（默认保留 7 天）
- **热力图** - 可视化展示模型历史检测状态

### 代理功能
- **统一入口** - 一个 API 地址访问所有渠道的模型
- **智能路由** - 根据模型名自动路由到对应渠道
- **渠道分组** - 模型 ID 格式为 `渠道名/模型名`，便于客户端分组显示
- **多协议支持** - 兼容 OpenAI / Claude / Gemini API 格式
- **流式响应** - 完整支持 SSE 流式输出

### 管理功能
- **渠道管理** - 支持 WebDAV 同步、批量导入导出
- **WebDAV 同步** - 支持坚果云、NextCloud 等，多设备同步渠道配置
- **多数据库** - 支持 PostgreSQL（默认）、TiDB、MySQL
- **深色模式** - 支持浅色/深色主题切换
- **一键部署** - Docker 一键部署（Linux / macOS）

## 快速开始

### 一键部署（Linux / macOS）

无需手动安装 Docker，脚本会自动检测并安装：

```bash
git clone https://github.com/chxcodepro/newapi-model-check.git
cd newapi-model-check
chmod +x deploy.sh && ./deploy.sh
```

部署脚本会自动完成：
1. 检测并安装 Docker
2. 生成安全的 JWT 密钥
3. 引导设置管理员密码
4. 配置可选功能（WebDAV、代理密钥、全局代理）
5. 启动 PostgreSQL + Redis + 应用
6. 初始化数据库

部署完成后访问 **http://localhost:3000**

### 部署模式

| 模式 | 命令 | 说明 |
|------|------|------|
| 本地模式 | `./deploy.sh` | PostgreSQL + Redis 本地运行（默认） |
| 云数据库 | `./deploy.sh --cloud-db` | 使用 Supabase/Neon/TiDB 云数据库 |
| 云 Redis | `./deploy.sh --cloud-redis` | 使用 Upstash 云 Redis |
| 全云端 | `./deploy.sh --cloud` | 数据库和 Redis 都使用云服务 |
| 快速部署 | `./deploy.sh --quick` | 跳过可选配置，最快部署 |

### 手动部署

```bash
# 1. 克隆项目
git clone https://github.com/chxcodepro/newapi-model-check.git
cd newapi-model-check

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，设置 ADMIN_PASSWORD 和 JWT_SECRET

# 3. 启动服务
docker compose up -d

# 4. 初始化数据库
docker compose exec app npx prisma db push
```

## API 代理

### 概述

代理服务将请求自动路由到对应的渠道端点，只有检测成功的模型才会出现在模型列表中。

模型 ID 格式为 `渠道名/模型名`（如 `OpenAI/gpt-4o`），便于客户端按渠道分组显示。

### 支持的端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/models` | GET | 获取可用模型列表 |
| `/v1/chat/completions` | POST | OpenAI Chat API |
| `/v1/messages` | POST | Claude Messages API |
| `/v1/responses` | POST | OpenAI Responses API (Codex) |
| `/v1beta/models/{model}:generateContent` | POST | Gemini API |
| `/v1beta/models/{model}:streamGenerateContent` | POST | Gemini 流式 API |

### 使用示例

#### 获取模型列表

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer your-proxy-key"
```

响应示例：
```json
{
  "object": "list",
  "data": [
    {
      "id": "OpenAI/gpt-4o",
      "object": "model",
      "created": 0,
      "owned_by": "OpenAI"
    },
    {
      "id": "Groq/llama-3.3-70b",
      "object": "model",
      "created": 0,
      "owned_by": "Groq"
    }
  ]
}
```

#### OpenAI Chat

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-proxy-key" \
  -d '{
    "model": "OpenAI/gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

#### Claude Messages

```bash
curl http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-proxy-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "Anthropic/claude-3-5-sonnet",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### 客户端配置

#### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="your-proxy-key"
)

response = client.chat.completions.create(
    model="OpenAI/gpt-4o",
    messages=[{"role": "user", "content": "Hello"}]
)
```

#### Anthropic Python SDK

```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://localhost:3000",
    api_key="your-proxy-key"
)

message = client.messages.create(
    model="Anthropic/claude-3-5-sonnet",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}]
)
```

### 认证方式

代理接口支持以下认证头：

```
# OpenAI 格式
Authorization: Bearer your-proxy-key

# Claude 格式
x-api-key: your-proxy-key

# Gemini 格式
x-goog-api-key: your-proxy-key
```

代理密钥通过 `PROXY_API_KEY` 环境变量配置。如未设置，系统会自动生成（重启后会变化）。

## WebDAV 同步

支持通过 WebDAV 在多设备间同步渠道配置，兼容坚果云、NextCloud、Alist 等服务。

### 配置方式

**方式一：环境变量配置（推荐）**

在 `.env` 中设置：

```bash
WEBDAV_URL="https://dav.jianguoyun.com/dav/newapi"
WEBDAV_USERNAME="your-email@example.com"
WEBDAV_PASSWORD="your-app-password"
WEBDAV_FILENAME="newapi-channels.json"  # 可选，默认 newapi-channels.json
```

配置后，页面上会自动显示 WebDAV 配置，点击同步按钮即可使用。

**方式二：页面手动输入**

在管理面板的渠道管理中，点击 WebDAV 同步按钮，手动输入配置信息。

### 坚果云配置

1. 登录坚果云，进入 **账户信息 → 安全选项**
2. 添加应用密码，获取专用密码
3. WebDAV URL 格式：`https://dav.jianguoyun.com/dav/文件夹名`

### 同步说明

- **上传**：将本地渠道配置上传到 WebDAV
- **下载**：从 WebDAV 下载配置并导入（支持合并/覆盖模式）
- 同步内容：渠道名称、API 地址、密钥、代理设置

## 数据库支持

### PostgreSQL（默认）

Docker 部署默认使用 PostgreSQL 16，无需额外配置。

**云服务推荐：**
- [Supabase](https://supabase.com) - 免费额度充足
- [Neon](https://neon.tech) - Serverless PostgreSQL

```bash
DOCKER_DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres"
```

### TiDB Cloud

TiDB 是 MySQL 兼容的分布式数据库，适合大规模部署。

**使用步骤：**
1. 切换 Schema：
   ```bash
   cp prisma/schema.mysql.prisma prisma/schema.prisma
   ```
2. 配置连接串：
   ```bash
   DOCKER_DATABASE_URL="mysql://user:password@gateway01.xx.tidbcloud.com:4000/newapi_monitor?sslaccept=strict"
   ```
3. 重新构建：
   ```bash
   docker compose up -d --build
   ```

### MySQL

本地 MySQL 或其他 MySQL 兼容数据库同样支持，切换方式与 TiDB 相同。

## 环境变量

### 必须配置

| 变量 | 说明 | 示例 |
|------|------|------|
| `ADMIN_PASSWORD` | 管理员登录密码 | `MySecurePassword123` |
| `JWT_SECRET` | JWT 签名密钥（建议 32 位以上） | `openssl rand -base64 32` |

### 可选配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AUTO_DETECT_ENABLED` | 自动检测开关 | `true` |
| `DETECT_PROMPT` | 检测提示词 | `1+1=2? yes or no` |
| `GLOBAL_PROXY` | 全局代理地址 | - |
| `CRON_SCHEDULE` | 检测周期（cron 格式） | `0 0,8,12,16,20 * * *` |
| `CRON_TIMEZONE` | 定时任务时区 | `Asia/Shanghai` |
| `CLEANUP_SCHEDULE` | 清理周期（cron 格式） | `0 2 * * *` |
| `LOG_RETENTION_DAYS` | 日志保留天数 | `7` |
| `APP_PORT` | 应用端口 | `3000` |
| `PROXY_API_KEY` | 代理接口密钥 | 自动生成 |

### 并发控制

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CHANNEL_CONCURRENCY` | 单渠道最大并发数 | `5` |
| `MAX_GLOBAL_CONCURRENCY` | 全局最大并发数 | `30` |
| `DETECTION_MIN_DELAY_MS` | 检测前最小延迟（ms） | `3000` |
| `DETECTION_MAX_DELAY_MS` | 检测前最大延迟（ms） | `5000` |

### WebDAV 同步

| 变量 | 说明 | 示例 |
|------|------|------|
| `WEBDAV_URL` | WebDAV 服务器地址 | `https://dav.jianguoyun.com/dav/newapi` |
| `WEBDAV_USERNAME` | WebDAV 用户名 | `user@example.com` |
| `WEBDAV_PASSWORD` | WebDAV 密码/应用密码 | `app-password` |
| `WEBDAV_FILENAME` | 同步文件名 | `newapi-channels.json` |

### 云 Redis

**Upstash（推荐）**
```bash
DOCKER_REDIS_URL="redis://default:[PASSWORD]@[ENDPOINT].upstash.io:6379"
```

## API 接口

### 管理接口

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/api/status` | GET | 否 | 健康检查 |
| `/api/dashboard` | GET | 否 | 仪表板数据 |
| `/api/auth/login` | POST | 否 | 管理员登录 |
| `/api/channel` | GET/POST/PUT/DELETE | 是 | 渠道 CRUD |
| `/api/channel/[id]/sync` | POST | 是 | 同步模型列表 |
| `/api/channel/import` | POST | 是 | 批量导入渠道 |
| `/api/channel/export` | GET | 是 | 导出渠道配置 |
| `/api/channel/webdav` | GET | 是 | 获取 WebDAV 配置状态 |
| `/api/channel/webdav` | POST | 是 | WebDAV 上传/下载同步 |
| `/api/detect` | POST/DELETE | 是 | 触发/停止检测 |
| `/api/scheduler` | GET/POST | 是 | 调度器管理 |
| `/api/sse/progress` | GET | 否 | SSE 实时进度 |
| `/api/proxy-key` | GET | 是 | 获取代理密钥 |

## Nginx 配置

如果使用 Nginx 作为反向代理，需要配置以下参数以支持流式响应：

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_cache_bypass $http_upgrade;

    # 流式响应支持（重要！）
    proxy_buffering off;

    # 长连接超时（CLI 对话可能持续较长时间）
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
```

> **重要：** `proxy_buffering off` 是流式响应的关键配置，否则 SSE 数据会被缓冲导致客户端无法实时接收。

## 项目结构

```
newapi-model-check/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # 管理 API 路由
│   │   ├── docs/              # 文档页面
│   │   ├── v1/                # OpenAI/Claude 代理端点
│   │   └── v1beta/            # Gemini 代理端点
│   ├── components/            # React 组件
│   │   ├── dashboard/         # 仪表板
│   │   ├── layout/           # 布局
│   │   └── ui/               # UI 组件
│   ├── hooks/                 # React Hooks
│   └── lib/                   # 核心库
│       ├── detection/        # 检测策略
│       ├── proxy/            # 代理工具
│       ├── queue/            # BullMQ 队列
│       └── scheduler/        # Cron 调度
├── prisma/
│   ├── schema.prisma         # PostgreSQL Schema（默认）
│   └── schema.mysql.prisma   # MySQL/TiDB Schema
├── docker-compose.yml
├── Dockerfile
└── deploy.sh                  # Linux/macOS 部署脚本
```

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript 5 |
| 数据库 | PostgreSQL / TiDB / MySQL + Prisma ORM |
| 队列 | Redis 7 + BullMQ |
| 定时任务 | cron + luxon |
| UI | Tailwind CSS + Lucide Icons |
| 认证 | JWT |
| 部署 | Docker + Docker Compose |

## 常用命令

```bash
# 查看日志
docker logs -f newapi-model-check

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 更新部署
git pull && docker compose up -d --build

# 本地开发
npm install
npm run dev

# 切换到 MySQL/TiDB
cp prisma/schema.mysql.prisma prisma/schema.prisma
npx prisma generate
```

## 常见问题

**Q: 忘记管理员密码？**

修改 `.env` 中的 `ADMIN_PASSWORD`，然后重启：`docker compose restart`

**Q: 如何修改检测间隔？**

修改 `.env` 中的 `CRON_SCHEDULE`（cron 格式），如每小时：`0 * * * *`

**Q: 如何切换到 TiDB/MySQL？**

```bash
cp prisma/schema.mysql.prisma prisma/schema.prisma
docker compose up -d --build
```

**Q: Docker 构建失败？**

镜像已配置国内加速源，如仍有问题可配置 Docker 镜像加速器。

**Q: 代理密钥在哪里获取？**

登录管理面板后访问 `/docs/proxy` 页面，或通过 API `/api/proxy-key` 获取。

**Q: 客户端如何按渠道分组显示模型？**

模型 ID 格式为 `渠道名/模型名`，客户端可根据 `/` 分隔符进行分组。

**Q: WebDAV 同步页面不显示配置？**

1. 确认 `.env` 中已配置 `WEBDAV_URL`、`WEBDAV_USERNAME`、`WEBDAV_PASSWORD`
2. 重启 Docker 容器：`docker compose down && docker compose up -d`
3. 刷新页面后打开 WebDAV 同步弹窗

**Q: 如何配置坚果云 WebDAV？**

1. 坚果云 → 账户信息 → 安全选项 → 添加应用密码
2. 在 `.env` 中配置：
   ```bash
   WEBDAV_URL="https://dav.jianguoyun.com/dav/你的文件夹"
   WEBDAV_USERNAME="你的坚果云邮箱"
   WEBDAV_PASSWORD="应用密码（不是登录密码）"
   ```

## License

[MIT](LICENSE)
