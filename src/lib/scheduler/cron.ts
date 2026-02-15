// Cron scheduler for periodic tasks

import { CronJob } from "cron";
import { triggerFullDetection, triggerSelectiveDetection } from "@/lib/queue/service";
import prisma from "@/lib/prisma";

// Environment variable defaults
const ENV_AUTO_DETECT_ENABLED = process.env.AUTO_DETECT_ENABLED !== "false";
const ENV_AUTO_DETECT_ALL_CHANNELS = process.env.AUTO_DETECT_ALL_CHANNELS !== "false";
const ENV_DETECTION_SCHEDULE = process.env.CRON_SCHEDULE || "0 0,8,12,16,20 * * *";
const ENV_CLEANUP_SCHEDULE = process.env.CLEANUP_SCHEDULE || "0 2 * * *";
const ENV_CRON_TIMEZONE = process.env.CRON_TIMEZONE || "Asia/Shanghai";
const ENV_LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || "7", 10);
const CRON_SCHEDULE_SEPARATOR = "||";
const INTERVAL_SCHEDULE_PREFIX = "interval:";
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MAX_DAILY_RUNS = 6;

type IntervalUnit = "minute" | "hour" | "day";

const INTERVAL_RANGES: Record<IntervalUnit, { min: number; max: number; ms: number }> = {
  minute: { min: 1, max: 60, ms: 60 * 1000 },
  hour: { min: 1, max: 24, ms: 60 * 60 * 1000 },
  day: { min: 1, max: 7, ms: 24 * 60 * 60 * 1000 },
};

interface ParsedIntervalSchedule {
  unit: IntervalUnit;
  value: number;
  anchorIso: string;
  anchorMs: number;
  offsetMinutes: number;
  dailyTimes: string[];
  intervalMs: number;
}

// Current active configuration (loaded from database or env)
let currentConfig = {
  enabled: ENV_AUTO_DETECT_ENABLED,
  cronSchedule: ENV_DETECTION_SCHEDULE,
  timezone: ENV_CRON_TIMEZONE,
  detectAllChannels: ENV_AUTO_DETECT_ALL_CHANNELS,
  selectedChannelIds: null as string[] | null,
  selectedModelIds: null as Record<string, string[]> | null,
};

let detectionJobs: CronJob[] = [];
let detectionTimer: NodeJS.Timeout | null = null;
let cleanupJob: CronJob | null = null;

function splitCronSchedules(cronSchedule: string): string[] {
  return cronSchedule
    .split(CRON_SCHEDULE_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stopDetectionCrons(): void {
  if (detectionJobs.length === 0) return;
  detectionJobs.forEach((job) => job.stop());
  detectionJobs = [];
}

function parseIntervalSchedule(schedule: string): ParsedIntervalSchedule | null {
  const trimmed = schedule.trim();
  if (!trimmed.startsWith(INTERVAL_SCHEDULE_PREFIX)) return null;

  const [prefix, unitPart, valuePart, ...anchorParts] = trimmed.split(":");
  if (prefix !== "interval") return null;

  const unit = unitPart as IntervalUnit;
  if (!(unit in INTERVAL_RANGES)) return null;

  const value = Number(valuePart);
  const range = INTERVAL_RANGES[unit];
  if (Number.isNaN(value) || value < range.min || value > range.max) return null;

  const anchorWithMeta = anchorParts.join(":");
  const [anchorIso, ...metaParts] = anchorWithMeta.split("|");
  const anchorMs = Date.parse(anchorIso);
  if (!anchorIso || Number.isNaN(anchorMs)) return null;

  let offsetMinutes = 0;
  const offsetPart = metaParts.find((item) => item.startsWith("offset="));
  if (offsetPart) {
    const parsedOffset = Number(offsetPart.slice("offset=".length));
    if (!Number.isNaN(parsedOffset) && Number.isFinite(parsedOffset)) {
      offsetMinutes = parsedOffset;
    }
  }

  let dailyTimes: string[] = [];
  const timesPart = metaParts.find((item) => item.startsWith("times="));
  if (timesPart) {
    const parsedTimes = timesPart
      .slice("times=".length)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (parsedTimes.every((time) => /^\d{2}:\d{2}$/.test(time))) {
      dailyTimes = parsedTimes;
    }
  }

  if (unit === "day" && dailyTimes.length === 0) {
    const localAnchor = new Date(anchorMs - offsetMinutes * MINUTE_MS);
    const hour = String(localAnchor.getUTCHours()).padStart(2, "0");
    const minute = String(localAnchor.getUTCMinutes()).padStart(2, "0");
    dailyTimes = [`${hour}:${minute}`];
  }

  if (unit === "day") {
    if (dailyTimes.length === 0 || dailyTimes.length > MAX_DAILY_RUNS) return null;
    for (let i = 1; i < dailyTimes.length; i += 1) {
      if (dailyTimes[i] <= dailyTimes[i - 1]) return null;
    }
  }

  return {
    unit,
    value,
    anchorIso,
    anchorMs,
    offsetMinutes,
    dailyTimes,
    intervalMs: value * range.ms,
  };
}

function getNextIntervalRunMs(anchorMs: number, intervalMs: number, nowMs: number = Date.now()): number {
  const firstRunMs = anchorMs + intervalMs;
  if (nowMs <= firstRunMs) {
    return firstRunMs;
  }

  const passed = Math.ceil((nowMs - firstRunMs) / intervalMs);
  return firstRunMs + passed * intervalMs;
}

function getLocalDayStartMs(utcMs: number, offsetMinutes: number): number {
  const localMs = utcMs - offsetMinutes * MINUTE_MS;
  const date = new Date(localMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseTimeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function getNextDayMultiRunMs(
  intervalConfig: ParsedIntervalSchedule,
  nowMs: number = Date.now()
): number {
  const thresholdMs = Math.max(nowMs, intervalConfig.anchorMs);
  const anchorDayStartLocalMs = getLocalDayStartMs(intervalConfig.anchorMs, intervalConfig.offsetMinutes);
  const nowDayStartLocalMs = getLocalDayStartMs(thresholdMs, intervalConfig.offsetMinutes);
  const diffDays = Math.floor((nowDayStartLocalMs - anchorDayStartLocalMs) / DAY_MS);

  let cycleStart = diffDays <= 0 ? 0 : diffDays - (diffDays % intervalConfig.value);
  if (cycleStart < 0) cycleStart = 0;

  const timeMinutes = intervalConfig.dailyTimes
    .map(parseTimeToMinutes)
    .filter((value): value is number => value !== null);

  for (let cycle = cycleStart; cycle <= cycleStart + intervalConfig.value * 400; cycle += intervalConfig.value) {
    const cycleDayLocalStartMs = anchorDayStartLocalMs + cycle * DAY_MS;
    for (const minutes of timeMinutes) {
      const candidateLocalMs = cycleDayLocalStartMs + minutes * MINUTE_MS;
      const candidateUtcMs = candidateLocalMs + intervalConfig.offsetMinutes * MINUTE_MS;
      if (candidateUtcMs > thresholdMs) {
        return candidateUtcMs;
      }
    }
  }

  return getNextIntervalRunMs(intervalConfig.anchorMs, intervalConfig.intervalMs, thresholdMs);
}

function stopDetectionSchedulers(): void {
  stopDetectionCrons();
  if (detectionTimer) {
    clearTimeout(detectionTimer);
    detectionTimer = null;
  }
}

async function runDetectionOnce(): Promise<void> {
  try {
    // Guard: re-check enabled from DB before every run
    // (module-level state may be stale due to Next.js chunk isolation)
    const freshConfig = await loadSchedulerConfig();
    if (!freshConfig.enabled) {
      stopDetectionSchedulers();
      return;
    }

    if (currentConfig.detectAllChannels) {
      // Full detection - all channels
      await triggerFullDetection();
    } else {
      // Selective detection - only specified channels/models
      await triggerSelectiveDetection(
        currentConfig.selectedChannelIds,
        currentConfig.selectedModelIds
      );
    }
  } catch {
  }
}

function startIntervalDetection(intervalConfig: ParsedIntervalSchedule): void {
  const scheduleNext = () => {
    const nextRunMs = intervalConfig.unit === "day"
      ? getNextDayMultiRunMs(intervalConfig)
      : getNextIntervalRunMs(intervalConfig.anchorMs, intervalConfig.intervalMs);
    const delay = Math.max(0, nextRunMs - Date.now());
    detectionTimer = setTimeout(async () => {
      await runDetectionOnce();
      if (detectionTimer) {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
}

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
          detectAllChannels: ENV_AUTO_DETECT_ALL_CHANNELS,
        },
      });
    }
  } catch (error) {
    console.error("[Scheduler] Failed to load config from database, using defaults:", error);
    // If database is unavailable, disable scheduler to avoid running with stale env defaults.
    currentConfig = {
      ...currentConfig,
      enabled: false,
    };
  }

  return currentConfig;
}

/**
 * Start detection cron job with database configuration
 */
export async function startDetectionCronWithConfig(): Promise<CronJob[] | null> {
  // Load config from database first
  await loadSchedulerConfig();

  if (!currentConfig.enabled) {
    stopDetectionSchedulers();
    return null;
  }

  // Stop existing job if running
  stopDetectionSchedulers();

  const intervalConfig = parseIntervalSchedule(currentConfig.cronSchedule);
  if (intervalConfig) {
    startIntervalDetection(intervalConfig);
    return null;
  }

  const schedules = splitCronSchedules(currentConfig.cronSchedule);
  if (schedules.length === 0) {
    return null;
  }

  const validSchedules = schedules.filter(
    (schedule) => getNextRunTime(schedule, currentConfig.timezone) !== null
  );
  if (validSchedules.length === 0) {
    return null;
  }

  detectionJobs = validSchedules.map(
    (schedule) =>
      new CronJob(
        schedule,
        runDetectionOnce,
        null, // onComplete
        true, // start immediately
        currentConfig.timezone // timezone
      )
  );

  return detectionJobs;
}

/**
 * Reload scheduler configuration and restart cron job
 */
export async function reloadSchedulerConfig(): Promise<void> {

  // Stop current detection job
  stopDetectionSchedulers();

  // startDetectionCronWithConfig 内部会调用 loadSchedulerConfig，无需重复加载
  await startDetectionCronWithConfig();
}

/**
 * Start cleanup cron job
 */
export function startCleanupCron(): CronJob {
  if (cleanupJob) {
    return cleanupJob;
  }

  cleanupJob = new CronJob(
    ENV_CLEANUP_SCHEDULE,
    async () => {
      try {
        await cleanupOldLogs();
      } catch {
      }
    },
    null, // onComplete
    true, // start immediately
    ENV_CRON_TIMEZONE // timezone
  );

  return cleanupJob;
}

/**
 * Clean up old check logs
 */
export async function cleanupOldLogs(): Promise<{ deleted: number }> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ENV_LOG_RETENTION_DAYS);

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
  stopDetectionSchedulers();

  if (cleanupJob) {
    cleanupJob.stop();
    cleanupJob = null;
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

function getNextRunTimeFromSchedule(cronSchedule: string, timezone: string): string | null {
  const schedules = splitCronSchedules(cronSchedule);
  if (schedules.length === 0) return null;

  let minTimestamp = Number.POSITIVE_INFINITY;
  let nextRunIso: string | null = null;

  schedules.forEach((schedule) => {
    const nextRun = getNextRunTime(schedule, timezone);
    if (!nextRun) return;
    const timestamp = new Date(nextRun).getTime();
    if (!Number.isNaN(timestamp) && timestamp < minTimestamp) {
      minTimestamp = timestamp;
      nextRunIso = nextRun;
    }
  });

  return nextRunIso;
}

function getNextDetectionRunTime(): string | null {
  const intervalConfig = parseIntervalSchedule(currentConfig.cronSchedule);
  if (intervalConfig) {
    const nextRunMs = intervalConfig.unit === "day"
      ? getNextDayMultiRunMs(intervalConfig)
      : getNextIntervalRunMs(intervalConfig.anchorMs, intervalConfig.intervalMs);
    return new Date(nextRunMs).toISOString();
  }

  return getNextRunTimeFromSchedule(currentConfig.cronSchedule, currentConfig.timezone);
}

/**
 * Get cron status
 */
export function getCronStatus() {
  return {
    detection: {
      enabled: currentConfig.enabled,
      running: detectionJobs.length > 0 || detectionTimer !== null,
      schedule: currentConfig.cronSchedule,
      timezone: currentConfig.timezone,
      nextRun: currentConfig.enabled ? getNextDetectionRunTime() : null,
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
 * Start all cron jobs with database configuration
 */
export async function startAllCronsWithConfig(): Promise<void> {
  await startDetectionCronWithConfig();
  startCleanupCron();
}
