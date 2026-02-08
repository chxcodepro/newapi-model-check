// BullMQ Worker for processing detection jobs

import { Worker, Job } from "bullmq";
import redis from "@/lib/redis";
import prisma from "@/lib/prisma";
import { executeDetection, sleep, randomDelay } from "@/lib/detection/detector";
import type { DetectionJobData, DetectionResult } from "@/lib/detection/types";
import { DETECTION_QUEUE_NAME, PROGRESS_CHANNEL } from "./constants";

// Worker configuration (from environment variables)
const WORKER_CONCURRENCY = 50; // BullMQ worker pool size (should be >= MAX_GLOBAL_CONCURRENCY)
const SEMAPHORE_POLL_MS = 500; // Poll interval when waiting for slot
const SEMAPHORE_TTL = 120; // TTL in seconds for semaphore keys (auto-cleanup)
const CONFIG_CACHE_TTL_MS = 5000;

interface WorkerRuntimeConfig {
  channelConcurrency: number;
  maxGlobalConcurrency: number;
  minDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_WORKER_CONFIG: WorkerRuntimeConfig = {
  channelConcurrency: parseInt(process.env.CHANNEL_CONCURRENCY || "5", 10),
  maxGlobalConcurrency: parseInt(process.env.MAX_GLOBAL_CONCURRENCY || "30", 10),
  minDelayMs: parseInt(process.env.DETECTION_MIN_DELAY_MS || "3000", 10),
  maxDelayMs: parseInt(process.env.DETECTION_MAX_DELAY_MS || "5000", 10),
};

let cachedConfig: WorkerRuntimeConfig | null = null;
let cachedAt = 0;
let loadingConfigPromise: Promise<WorkerRuntimeConfig> | null = null;

// Redis keys
const GLOBAL_SEMAPHORE_KEY = "detection:semaphore:global";

// Worker instance
let worker: Worker<DetectionJobData, DetectionResult> | null = null;

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const parsed = Math.floor(value);
  return parsed >= 0 ? parsed : fallback;
}

function normalizeConfig(config: Partial<WorkerRuntimeConfig>): WorkerRuntimeConfig {
  const minDelayMs = parseNonNegativeInt(config.minDelayMs, DEFAULT_WORKER_CONFIG.minDelayMs);
  const maxDelayMsRaw = parseNonNegativeInt(config.maxDelayMs, DEFAULT_WORKER_CONFIG.maxDelayMs);
  const maxDelayMs = Math.max(maxDelayMsRaw, minDelayMs);

  return {
    channelConcurrency: parsePositiveInt(config.channelConcurrency, DEFAULT_WORKER_CONFIG.channelConcurrency),
    maxGlobalConcurrency: parsePositiveInt(config.maxGlobalConcurrency, DEFAULT_WORKER_CONFIG.maxGlobalConcurrency),
    minDelayMs,
    maxDelayMs,
  };
}

async function loadWorkerConfig(): Promise<WorkerRuntimeConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CONFIG_CACHE_TTL_MS) {
    return cachedConfig;
  }

  if (!loadingConfigPromise) {
    loadingConfigPromise = (async () => {
      try {
        const dbConfig = await prisma.schedulerConfig.findUnique({
          where: { id: "default" },
          select: {
            channelConcurrency: true,
            maxGlobalConcurrency: true,
            minDelayMs: true,
            maxDelayMs: true,
          },
        });

        const resolvedConfig = dbConfig
          ? normalizeConfig(dbConfig)
          : normalizeConfig(DEFAULT_WORKER_CONFIG);

        cachedConfig = resolvedConfig;
        cachedAt = Date.now();
        return resolvedConfig;
      } catch {
        const fallbackConfig = cachedConfig ?? normalizeConfig(DEFAULT_WORKER_CONFIG);
        cachedConfig = fallbackConfig;
        cachedAt = Date.now();
        return fallbackConfig;
      } finally {
        loadingConfigPromise = null;
      }
    })();
  }

  return loadingConfigPromise;
}

export function reloadWorkerConfig(): void {
  cachedConfig = null;
  cachedAt = 0;
}

/**
 * Redis-based semaphore for concurrency control
 */
function channelSemaphoreKey(channelId: string): string {
  return `detection:semaphore:channel:${channelId}`;
}

async function acquireSlots(channelId: string, config: WorkerRuntimeConfig): Promise<void> {
  const channelKey = channelSemaphoreKey(channelId);

  // Must acquire both global and channel slots
  while (true) {
    // Try global slot first
    const globalCount = await redis.incr(GLOBAL_SEMAPHORE_KEY);
    if (globalCount > config.maxGlobalConcurrency) {
      await redis.decr(GLOBAL_SEMAPHORE_KEY);
      await sleep(SEMAPHORE_POLL_MS);
      continue;
    }
    await redis.expire(GLOBAL_SEMAPHORE_KEY, SEMAPHORE_TTL);

    // Try channel slot
    const channelCount = await redis.incr(channelKey);
    if (channelCount > config.channelConcurrency) {
      // Release channel slot and global slot, then wait
      await redis.decr(channelKey);
      await redis.decr(GLOBAL_SEMAPHORE_KEY);
      await sleep(SEMAPHORE_POLL_MS);
      continue;
    }
    await redis.expire(channelKey, SEMAPHORE_TTL);

    // Got both slots
    return;
  }
}

async function releaseSlots(channelId: string): Promise<void> {
  const channelKey = channelSemaphoreKey(channelId);

  // Release both slots with minimum value protection
  // Use pipeline for atomic execution
  const pipeline = redis.pipeline();
  pipeline.decr(channelKey);
  pipeline.decr(GLOBAL_SEMAPHORE_KEY);
  const results = await pipeline.exec();

  // Check results and ensure counters don't go negative
  const channelVal = (results?.[0]?.[1] as number) ?? 0;
  const globalVal = (results?.[1]?.[1] as number) ?? 0;

  // Clean up or reset if counters are at or below 0
  // This prevents negative values from accumulating if queue was forcibly cleared
  if (channelVal <= 0) {
    await redis.del(channelKey);
  }
  if (globalVal <= 0) {
    await redis.del(GLOBAL_SEMAPHORE_KEY);
  }
}

/**
 * Process a single detection job
 */
async function processDetectionJob(
  job: Job<DetectionJobData, DetectionResult>
): Promise<DetectionResult> {
  const { data } = job;
  const runtimeConfig = await loadWorkerConfig();

  // Check if detection has been stopped before processing
  const { isDetectionStopped } = await import("./queue");
  if (await isDetectionStopped()) {
    return {
      status: "FAIL",
      latency: 0,
      endpointType: data.endpointType,
      errorMsg: "Detection stopped by user",
    };
  }

  // Acquire concurrency slots (both global and per-channel)
  await acquireSlots(data.channelId, runtimeConfig);

  try {
    // Check again after acquiring slot (in case stop was triggered during wait)
    if (await isDetectionStopped()) {
      return {
        status: "FAIL",
        latency: 0,
        endpointType: data.endpointType,
        errorMsg: "Detection stopped by user",
      };
    }

    // Anti-blocking delay (3-5 seconds random)
    const delay = randomDelay(runtimeConfig.minDelayMs, runtimeConfig.maxDelayMs);
    await sleep(delay);

    // Execute the actual detection
    const result = await executeDetection(data);

    // Use atomic operations to avoid race conditions when updating detectedEndpoints
    // Multiple detection jobs for the same model can run in parallel
    await prisma.$transaction(async (tx) => {
      if (result.status === "SUCCESS") {
        // Atomically add endpoint to array if not already present (PostgreSQL array operation)
        await tx.$executeRaw`
          UPDATE "models"
          SET "detected_endpoints" =
            CASE
              WHEN ${data.endpointType} = ANY("detected_endpoints") THEN "detected_endpoints"
              ELSE COALESCE("detected_endpoints", ARRAY[]::text[]) || ARRAY[${data.endpointType}]
            END,
            "last_status" = true,
            "last_latency" = ${result.latency},
            "last_checked_at" = ${new Date()}
          WHERE id = ${data.modelId}
        `;
      } else {
        // Atomically remove endpoint from array (PostgreSQL array_remove)
        await tx.$executeRaw`
          UPDATE "models"
          SET "detected_endpoints" = array_remove(COALESCE("detected_endpoints", ARRAY[]::text[]), ${data.endpointType}),
            "last_status" = false,
            "last_latency" = ${result.latency},
            "last_checked_at" = ${new Date()}
          WHERE id = ${data.modelId}
        `;
      }

      // Create check log entry
      await tx.checkLog.create({
        data: {
          modelId: data.modelId,
          endpointType: result.endpointType,
          status: result.status,
          latency: result.latency,
          statusCode: result.statusCode,
          errorMsg: result.errorMsg,
          responseContent: result.responseContent,
        },
      });
    });

    // Check if this model has any remaining jobs (to determine if model detection is complete)
    const queue = (await import("./queue")).getDetectionQueue();
    const [waitingJobs, activeJobs, delayedJobs] = await Promise.all([
      queue.getJobs(["waiting"], 0, 1000),
      queue.getJobs(["active"], 0, 100),
      queue.getJobs(["delayed"], 0, 1000),
    ]);

    // Count remaining jobs for this model (excluding the current job which is about to complete)
    const remainingJobs = [...waitingJobs, ...activeJobs, ...delayedJobs].filter(
      (j) => j.data?.modelId === data.modelId && j.id !== job.id
    );
    const isModelComplete = remainingJobs.length === 0;

    // Publish progress update for SSE (with error handling to not affect detection result)
    const progressData = {
      channelId: data.channelId,
      modelId: data.modelId,
      modelName: data.modelName,
      endpointType: data.endpointType,
      status: result.status,
      latency: result.latency,
      timestamp: Date.now(),
      isModelComplete, // true when all endpoints for this model are done
    };

    try {
      await redis.publish(PROGRESS_CHANNEL, JSON.stringify(progressData));
    } catch (publishError) {
      // Redis publish failure should not affect the detection result
    }

    return result;
  } finally {
    // Always release slots, even on error
    await releaseSlots(data.channelId);
  }
}

/**
 * Start the detection worker
 */
export function startWorker(): Worker<DetectionJobData, DetectionResult> {
  if (worker) {
    return worker;
  }

  worker = new Worker<DetectionJobData, DetectionResult>(
    DETECTION_QUEUE_NAME,
    processDetectionJob,
    {
      connection: redis.duplicate(),
      concurrency: WORKER_CONCURRENCY,
    }
  );

  // Event handlers
  worker.on("completed", (job, result) => {
  });

  worker.on("failed", (job, error) => {
  });

  worker.on("error", (error) => {
  });

  worker.on("stalled", (jobId) => {
  });

  return worker;
}

/**
 * Stop the detection worker
 */
export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

/**
 * Get worker status
 */
export function isWorkerRunning(): boolean {
  return worker !== null && !worker.closing;
}
