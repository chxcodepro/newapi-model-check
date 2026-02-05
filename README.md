# Model Check

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://github.com/chxcodepro/model-check/pkgs/container/model-check)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js)](https://nodejs.org/)

API 渠道模型可用性检测工具，支持多渠道管理、自动检测、代理转发。

## 功能特性

- **多渠道管理** - 支持 OpenAI、Claude、Gemini 等多种 API 格式
- **自动检测** - 可视化配置定时检测，支持 cron 表达式
- **代理转发** - 内置代理接口，自动路由到可用渠道
- **多密钥管理** - 支持创建多个代理密钥，独立权限控制
- **WebDAV 同步** - 支持坚果云、NextCloud 等，多设备同步配置
- **Docker 部署** - 一键脚本，支持本地/云端数据库

## 快速开始

### Docker 部署（推荐）

```bash
# 克隆项目
git clone https://github.com/chxcodepro/model-check.git
cd model-check

# 赋予一键部署脚本执行权限


# 一键部署（全本地模式）
chmod +x deploy.sh && ./deploy.sh --local

# 或使用云数据库
chmod +x deploy.sh && ./deploy.sh --cloud-db
```

### 部署模式

| 模式 | 命令 | 说明 |
|------|------|------|
| 全本地 | `./deploy.sh --local` | PostgreSQL + Redis 本地运行 |
| 云数据库 | `./deploy.sh --cloud-db` | 使用 Supabase/Neon，本地 Redis |
| 云 Redis | `./deploy.sh --cloud-redis` | 本地 PostgreSQL，使用 Upstash |
| 全云端 | `./deploy.sh --cloud` | 数据库和 Redis 都使用云端 |

### 其他选项

```bash
./deploy.sh --quick      # 快速模式，跳过可选配置
./deploy.sh --rebuild    # 强制重新构建镜像
./deploy.sh --update     # 更新部署
./deploy.sh --status     # 查看服务状态
./deploy.sh --help       # 显示帮助
```

## 手动部署

### 环境要求

- Node.js 22.12.0+ 或 20.19.0+
- PostgreSQL 14+
- Redis 6+

### 安装步骤

```bash
# 安装依赖
npm install

# 复制配置文件
cp .env.example .env

# 编辑 .env 配置数据库连接等

# 初始化数据库
npm run db:push

# 启动开发服务器
npm run dev

# 或构建生产版本
npm run build
npm start
```

## 配置说明

### 必须配置

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis 连接串 | `redis://localhost:6379` |
| `ADMIN_PASSWORD` | 管理员密码 | `your-secure-password` |
| `JWT_SECRET` | JWT 密钥 | `openssl rand -base64 32` |

### 可选配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CRON_SCHEDULE` | 检测周期（cron） | `0 0,8,12,16,20 * * *` |
| `CRON_TIMEZONE` | 时区 | `Asia/Shanghai` |
| `GLOBAL_PROXY` | 全局代理 | - |
| `CHANNEL_CONCURRENCY` | 单渠道并发数 | `5` |
| `MAX_GLOBAL_CONCURRENCY` | 全局最大并发 | `30` |

### WebDAV 配置

支持坚果云、NextCloud、Alist 等 WebDAV 服务：

```env
WEBDAV_URL="https://dav.jianguoyun.com/dav/sync"
WEBDAV_USERNAME="your-email@example.com"
WEBDAV_PASSWORD="your-app-password"
WEBDAV_FILENAME="channels.json"
```

> 坚果云用户需使用应用密码，非登录密码

## API 代理

支持 OpenAI 兼容格式，自动路由到可用渠道：

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer your-proxy-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### 支持的端点

| 端点 | 格式 |
|------|------|
| `/v1/chat/completions` | OpenAI Chat |
| `/v1/messages` | Claude |
| `/v1/responses` | Codex |
| `/v1/models` | 模型列表 |
| `/v1beta/models/*` | Gemini |

## 常用命令

```bash
# 查看日志
docker logs -f model-check

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 更新部署
git pull && docker compose up -d --build

# 数据库操作
npm run db:studio    # 打开 Prisma Studio
npm run db:push      # 推送 schema 变更
```

## 云服务推荐

### PostgreSQL
- [Supabase](https://supabase.com/) - 免费 500MB
- [Neon](https://neon.tech/) - 免费 512MB

### Redis
- [Upstash](https://upstash.com/) - 免费 10K 命令/天
- [Redis Cloud](https://redis.com/cloud/) - 免费 30MB

## 项目结构

```
model-check/
├── src/
│   ├── app/              # Next.js App Router
│   │   ├── api/          # API 路由
│   │   └── v1/           # 代理接口
│   ├── components/       # React 组件
│   ├── lib/              # 工具库
│   │   ├── detection/    # 检测逻辑
│   │   ├── queue/        # 任务队列
│   │   └── scheduler/    # 定时任务
│   └── generated/        # Prisma 生成
├── prisma/
│   ├── schema.prisma     # 数据库 Schema
│   └── init.postgresql.sql
├── deploy.sh             # 一键部署脚本
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## 技术栈

- **框架**: Next.js 16 (App Router)
- **语言**: TypeScript
- **数据库**: PostgreSQL + Prisma 7
- **缓存/队列**: Redis + BullMQ
- **UI**: Tailwind CSS 4 + Lucide Icons
- **运行时**: Node.js 22

## License

[MIT](LICENSE)
