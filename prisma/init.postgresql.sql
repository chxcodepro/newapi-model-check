-- Model Check - PostgreSQL 数据库初始化脚本
-- 通常由 Prisma (npx prisma db push) 自动管理表结构
-- 此脚本用于手动初始化或不使用 Prisma CLI 的场景

-- 创建枚举类型（Prisma 需要原生 ENUM 类型）
DO $$ BEGIN
    CREATE TYPE "EndpointType" AS ENUM ('CHAT', 'CLAUDE', 'GEMINI', 'CODEX', 'IMAGE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 添加 IMAGE 枚举值（如果枚举已存在但缺少 IMAGE）
DO $$ BEGIN
    ALTER TYPE "EndpointType" ADD VALUE IF NOT EXISTS 'IMAGE';
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "CheckStatus" AS ENUM ('SUCCESS', 'FAIL');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "channels" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "base_url" VARCHAR(500) NOT NULL,
  "api_key" TEXT NOT NULL,
  "proxy" VARCHAR(500),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- 兼容历史库：补 channels.sort_order 字段
ALTER TABLE "channels"
  ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "models" (
  "id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "model_name" VARCHAR(200) NOT NULL,
  "detected_endpoints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "last_status" BOOLEAN,
  "last_latency" INTEGER,
  "last_checked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  CONSTRAINT "models_channel_id_model_name_key" UNIQUE ("channel_id", "model_name"),
  CONSTRAINT "models_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "check_logs" (
  "id" TEXT NOT NULL,
  "model_id" TEXT NOT NULL,
  "endpoint_type" "EndpointType" NOT NULL,
  "status" "CheckStatus" NOT NULL,
  "latency" INTEGER,
  "status_code" INTEGER,
  "error_msg" TEXT,
  "response_content" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  CONSTRAINT "check_logs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "check_logs_model_id_created_at_idx" ON "check_logs"("model_id", "created_at");
CREATE INDEX IF NOT EXISTS "check_logs_created_at_idx" ON "check_logs"("created_at");

-- 定时任务配置表（单例模式，id 固定为 'default'）
CREATE TABLE IF NOT EXISTS "scheduler_config" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "cron_schedule" VARCHAR(100) NOT NULL DEFAULT '0 0,8,12,16,20 * * *',
  "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Shanghai',
  "channel_concurrency" INTEGER NOT NULL DEFAULT 5,
  "max_global_concurrency" INTEGER NOT NULL DEFAULT 30,
  "min_delay_ms" INTEGER NOT NULL DEFAULT 3000,
  "max_delay_ms" INTEGER NOT NULL DEFAULT 5000,
  "detect_all_channels" BOOLEAN NOT NULL DEFAULT true,
  "selected_channel_ids" JSONB,
  "selected_model_ids" JSONB,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

-- 代理密钥表（多密钥管理，支持权限控制）
CREATE TABLE IF NOT EXISTS "proxy_keys" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "key" VARCHAR(100) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "allow_all_models" BOOLEAN NOT NULL DEFAULT true,
  "allowed_channel_ids" JSONB,
  "allowed_model_ids" JSONB,
  "last_used_at" TIMESTAMP(3),
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  CONSTRAINT "proxy_keys_key_key" UNIQUE ("key")
);
