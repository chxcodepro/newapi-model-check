-- Model Check - MySQL/TiDB 数据库初始化脚本
-- 通常由 Prisma (npx prisma db push) 自动管理表结构
-- 此脚本用于手动初始化或不使用 Prisma CLI 的场景

CREATE TABLE IF NOT EXISTS `channels` (
  `id` VARCHAR(30) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `base_url` VARCHAR(500) NOT NULL,
  `api_key` TEXT NOT NULL,
  `proxy` VARCHAR(500) NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `models` (
  `id` VARCHAR(30) NOT NULL,
  `channel_id` VARCHAR(30) NOT NULL,
  `model_name` VARCHAR(200) NOT NULL,
  `detected_endpoints` JSON NULL,
  `last_status` BOOLEAN NULL,
  `last_latency` INT NULL,
  `last_checked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `models_channel_id_model_name_key` (`channel_id`, `model_name`),
  CONSTRAINT `models_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `check_logs` (
  `id` VARCHAR(30) NOT NULL,
  `model_id` VARCHAR(30) NOT NULL,
  `endpoint_type` ENUM('CHAT', 'CLAUDE', 'GEMINI', 'CODEX', 'IMAGE') NOT NULL,
  `status` ENUM('SUCCESS', 'FAIL') NOT NULL,
  `latency` INT NULL,
  `status_code` INT NULL,
  `error_msg` TEXT NULL,
  `response_content` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `check_logs_model_id_created_at_idx` (`model_id`, `created_at`),
  INDEX `check_logs_created_at_idx` (`created_at`),
  CONSTRAINT `check_logs_model_id_fkey` FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 定时任务配置表（单例模式，id 固定为 'default'）
CREATE TABLE IF NOT EXISTS `scheduler_config` (
  `id` VARCHAR(30) NOT NULL DEFAULT 'default',
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `cron_schedule` VARCHAR(100) NOT NULL DEFAULT '0 0,8,12,16,20 * * *',
  `timezone` VARCHAR(50) NOT NULL DEFAULT 'Asia/Shanghai',
  `channel_concurrency` INT NOT NULL DEFAULT 5,
  `max_global_concurrency` INT NOT NULL DEFAULT 30,
  `min_delay_ms` INT NOT NULL DEFAULT 3000,
  `max_delay_ms` INT NOT NULL DEFAULT 5000,
  `detect_all_channels` BOOLEAN NOT NULL DEFAULT true,
  `selected_channel_ids` JSON NULL,
  `selected_model_ids` JSON NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 代理密钥表（多密钥管理，支持权限控制）
CREATE TABLE IF NOT EXISTS `proxy_keys` (
  `id` VARCHAR(30) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `key` VARCHAR(100) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `allow_all_models` BOOLEAN NOT NULL DEFAULT true,
  `allowed_channel_ids` JSON NULL,
  `allowed_model_ids` JSON NULL,
  `last_used_at` DATETIME(3) NULL,
  `usage_count` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `proxy_keys_key_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
