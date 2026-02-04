// Cron scheduler for periodic tasks

import { CronJob } from "cron";
import { triggerFullDetection, triggerSelectiveDetection } from "@/lib/queue/service";
import prisma from "@/lib/prisma";

// Environment variable defaults
const ENV_AUTO_DETECT_ENABLED = process.env.AUTO_DETECT_ENABLED !== "false";
const ENV_DETECTION_SCHEDULE = process.env.CRON_SCHEDULE || "0 0,8,12,16,20 * * *";
const ENV_CLEANUP_SCHEDULE = process.env.CLEANUP_SCHEDULE || "0 2 * * *";
const ENV_CRON_TIMEZONE = process.env.CRON_TIMEZONE || "Asia/Shanghai";
const ENV_LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || "7", 10);

// Current active configuration (loaded from database or env)
let currentConfig = {
  enabled: ENV_AUTO_DETECT_ENABLED,
  cronSchedule: ENV_DETECTION_SCHEDULE,
  timezone: ENV_CRON_TIMEZONE,
  detectAllChannels: true,
  selectedChannelIds: null as string[] | null,
  selectedModelIds: null as Record<string, string[]> | null,
};

let detectionJob: CronJob | null = null;
let cleanupJob: CronJob | null = null;

/**
 * Load scheduler configuration from database
 * Falls back to environment variables if no database config exists
 */
export async function loadSchedulerConfig(): Promise<typeof currentConfig> {
  try {
    const config = await prisma.schedulerConfig.findUnique({
      where: { id: "default" },
    });

    if (config) {
      currentConfig = {
        enabled: config.enabled,
        cronSchedule: config.cronSchedule,
        timezone: config.timezone,
        detectAllChannels: config.detectAllChannels,
        selectedChannelIds: config.selectedChannelIds as string[] | null,
        selectedModelIds: config.selectedModelIds as Record<string, string[]> | null,
      };
      console.log("[Cron] Loaded config from database:", {
        enabled: currentConfig.enabled,
        schedule: currentConfig.cronSchedule,
        detectAllChannels: currentConfig.detectAllChannels,
      });
    } else {
      // Initialize database with environment defaults
      await prisma.schedulerConfig.create({
        data: {
          id: "default",
          enabled: ENV_AUTO_DETECT_ENABLED,
          cronSchedule: ENV_DETECTION_SCHEDULE,
          timezone: ENV_CRON_TIMEZONE,
          channelConcurrency: parseInt(process.env.CHANNEL_CONCURRENCY || "5", 10),
          maxGlobalConcurrency: parseInt(process.env.MAX_GLOBAL_CONCURRENCY || "30", 10),
          minDelayMs: parseInt(process.env.DETECTION_MIN_DELAY_MS || "3000", 10),
          maxDelayMs: parseInt(process.env.DETECTION_MAX_DELAY_MS || "5000", 10),
          detectAllChannels: true,
        },
      });
      console.log("[Cron] Created default config from environment variables");
    }
  } catch (error) {
    console.error("[Cron] Failed to load config from database, using env defaults:", error);
  }

  return currentConfig;
}

/**
 * Start detection cron job with database configuration
 */
export async function startDetectionCronWithConfig(): Promise<CronJob | null> {
  // Load config from database first
  await loadSchedulerConfig();

  if (!currentConfig.enabled) {
    console.log("[Cron] Auto detection is disabled");
    return null;
  }

  // Stop existing job if running
  if (detectionJob) {
    detectionJob.stop();
    detectionJob = null;
  }

  detectionJob = new CronJob(
    currentConfig.cronSchedule,
    async () => {
      console.log("[Cron] Starting scheduled detection with model sync...");
      try {
        let result;

        if (currentConfig.detectAllChannels) {
          // Full detection - all channels
          result = await triggerFullDetection(true);
        } else {
          // Selective detection - only specified channels/models
          result = await triggerSelectiveDetection(
            currentConfig.selectedChannelIds,
            currentConfig.selectedModelIds
          );
        }

        console.log(
          `[Cron] Detection scheduled: ${result.channelCount} channels, ${result.modelCount} models`
        );
        if (result.syncResults) {
          const totalAdded = result.syncResults.reduce((sum, r) => sum + r.added, 0);
          if (totalAdded > 0) {
            console.log(`[Cron] Model sync: ${totalAdded} new models added`);
          }
        }
      } catch (error) {
        console.error("[Cron] Detection failed:", error);
      }
    },
    null, // onComplete
    true, // start immediately
    currentConfig.timezone // timezone
  );

  console.log(`[Cron] Detection job started with schedule: ${currentConfig.cronSchedule}`);
  return detectionJob;
}

/**
 * Start detection cron job (legacy function for compatibility)
 */
export function startDetectionCron(): CronJob | null {
  if (!ENV_AUTO_DETECT_ENABLED) {
    console.log("[Cron] Auto detection is disabled");
    return null;
  }

  if (detectionJob) {
    console.log("[Cron] Detection job already running");
    return detectionJob;
  }

  detectionJob = new CronJob(
    currentConfig.cronSchedule,
    async () => {
      console.log("[Cron] Starting scheduled detection with model sync...");
      try {
        let result;

        if (currentConfig.detectAllChannels) {
          result = await triggerFullDetection(true);
        } else {
          result = await triggerSelectiveDetection(
            currentConfig.selectedChannelIds,
            currentConfig.selectedModelIds
          );
        }

        console.log(
          `[Cron] Detection scheduled: ${result.channelCount} channels, ${result.modelCount} models`
        );
        if (result.syncResults) {
          const totalAdded = result.syncResults.reduce((sum, r) => sum + r.added, 0);
          if (totalAdded > 0) {
            console.log(`[Cron] Model sync: ${totalAdded} new models added`);
          }
        }
      } catch (error) {
        console.error("[Cron] Detection failed:", error);
      }
    },
    null, // onComplete
    true, // start immediately
    currentConfig.timezone // timezone
  );

  console.log(`[Cron] Detection job started with schedule: ${currentConfig.cronSchedule}`);
  return detectionJob;
}

/**
 * Reload scheduler configuration and restart cron job
 */
export async function reloadSchedulerConfig(): Promise<void> {
  console.log("[Cron] Reloading scheduler configuration...");

  // Load new config from database
  await loadSchedulerConfig();

  // Stop current detection job
  if (detectionJob) {
    detectionJob.stop();
    detectionJob = null;
    console.log("[Cron] Detection job stopped for reload");
  }

  // Start with new config if enabled
  if (currentConfig.enabled) {
    await startDetectionCronWithConfig();
  } else {
    console.log("[Cron] Auto detection is disabled in new config");
  }
}

/**
 * Start cleanup cron job
 */
export function startCleanupCron(): CronJob {
  if (cleanupJob) {
    console.log("[Cron] Cleanup job already running");
    return cleanupJob;
  }

  cleanupJob = new CronJob(
    ENV_CLEANUP_SCHEDULE,
    async () => {
      console.log("[Cron] Starting scheduled cleanup...");
      try {
        const result = await cleanupOldLogs();
        console.log(`[Cron] Cleanup complete: ${result.deleted} logs removed`);
      } catch (error) {
        console.error("[Cron] Cleanup failed:", error);
      }
    },
    null, // onComplete
    true, // start immediately
    ENV_CRON_TIMEZONE // timezone
  );

  console.log(`[Cron] Cleanup job started with schedule: ${ENV_CLEANUP_SCHEDULE}`);
  return cleanupJob;
}

/**
 * Clean up old check logs
 */
export async function cleanupOldLogs(): Promise<{ deleted: number }> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ENV_LOG_RETENTION_DAYS);

  console.log(`[Cleanup] Removing logs older than ${cutoffDate.toISOString()}`);

  const result = await prisma.checkLog.deleteMany({
    where: {
      createdAt: {
        lt: cutoffDate,
      },
    },
  });

  return { deleted: result.count };
}

/**
 * Stop all cron jobs
 */
export function stopAllCrons(): void {
  if (detectionJob) {
    detectionJob.stop();
    detectionJob = null;
    console.log("[Cron] Detection job stopped");
  }

  if (cleanupJob) {
    cleanupJob.stop();
    cleanupJob = null;
    console.log("[Cron] Cleanup job stopped");
  }
}

/**
 * Calculate next run time from cron expression
 */
function getNextRunTime(cronExpression: string, timezone: string = ENV_CRON_TIMEZONE): string | null {
  try {
    // Create a temporary CronJob to calculate next run time
    const tempJob = new CronJob(cronExpression, () => {}, null, false, timezone);
    const nextDate = tempJob.nextDate();
    return nextDate?.toISO() ?? null;
  } catch {
    return null;
  }
}

/**
 * Get cron status
 */
export function getCronStatus() {
  return {
    detection: {
      enabled: currentConfig.enabled,
      running: detectionJob !== null,
      schedule: currentConfig.cronSchedule,
      timezone: currentConfig.timezone,
      nextRun: currentConfig.enabled ? getNextRunTime(currentConfig.cronSchedule, currentConfig.timezone) : null,
      detectAllChannels: currentConfig.detectAllChannels,
    },
    cleanup: {
      running: cleanupJob !== null,
      schedule: ENV_CLEANUP_SCHEDULE,
      nextRun: getNextRunTime(ENV_CLEANUP_SCHEDULE),
      retentionDays: ENV_LOG_RETENTION_DAYS,
    },
  };
}

/**
 * Get current scheduler config
 */
export function getCurrentConfig() {
  return { ...currentConfig };
}

/**
 * Start all cron jobs
 */
export function startAllCrons(): void {
  startDetectionCron();
  startCleanupCron();
}

/**
 * Start all cron jobs with database configuration
 */
export async function startAllCronsWithConfig(): Promise<void> {
  await startDetectionCronWithConfig();
  startCleanupCron();
}
