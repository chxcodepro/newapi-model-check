// BullMQ Queue Configuration for Detection Jobs

import { Queue } from "bullmq";
import redis from "@/lib/redis";
import type { DetectionJobData } from "@/lib/detection/types";
import { DETECTION_QUEUE_NAME, DETECTION_STOPPED_KEY, DETECTION_STOPPED_TTL } from "./constants";

// Queue instance (singleton)
let detectionQueue: Queue<DetectionJobData> | null = null;

/**
 * Get or create the detection queue instance
 */
export function getDetectionQueue(): Queue<DetectionJobData> {
  if (!detectionQueue) {
    detectionQueue = new Queue<DetectionJobData>(DETECTION_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000, // Start with 5 second delay, exponential backoff
        },
        removeOnComplete: {
          count: 1000, // Keep last 1000 completed jobs
          age: 3600,   // Remove completed jobs older than 1 hour
        },
        removeOnFail: {
          count: 500,  // Keep last 500 failed jobs for debugging
          age: 86400,  // Remove failed jobs older than 24 hours
        },
      },
    });
  }
  return detectionQueue;
}

/**
 * Add a single detection job to the queue
 */
export async function addDetectionJob(data: DetectionJobData): Promise<string> {
  const queue = getDetectionQueue();
  const job = await queue.add(`detect-${data.modelName}`, data, {
    // Include endpointType in jobId to ensure uniqueness when testing multiple endpoints
    jobId: `${data.channelId}-${data.modelId}-${data.endpointType}-${Date.now()}`,
  });
  return job.id || "";
}

/**
 * Add multiple detection jobs in bulk
 */
export async function addDetectionJobsBulk(jobs: DetectionJobData[]): Promise<string[]> {
  const queue = getDetectionQueue();
  const timestamp = Date.now();
  const bulkJobs = jobs.map((data, index) => ({
    name: `detect-${data.modelName}`,
    data,
    opts: {
      // Include endpointType and index to ensure unique jobId for each job
      jobId: `${data.channelId}-${data.modelId}-${data.endpointType}-${timestamp}-${index}`,
    },
  }));

  const addedJobs = await queue.addBulk(bulkJobs);
  return addedJobs.map((j) => j.id || "");
}

/**
 * Get queue statistics
 */
export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
}

export function isQueueRunning(stats: Pick<QueueStats, "active" | "waiting" | "delayed">): boolean {
  return stats.active > 0 || stats.waiting > 0 || stats.delayed > 0;
}

export async function getQueueStats(): Promise<QueueStats> {
  const queue = getDetectionQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed,
  };
}

/**
 * Get model IDs currently being tested (waiting + active + delayed)
 */
export async function getTestingModelIds(): Promise<string[]> {
  const queue = getDetectionQueue();

  // Get all jobs that are waiting, active, or delayed
  const [waitingJobs, activeJobs, delayedJobs] = await Promise.all([
    queue.getJobs(["waiting"], 0, 1000),
    queue.getJobs(["active"], 0, 100),
    queue.getJobs(["delayed"], 0, 1000),
  ]);

  const allJobs = [...waitingJobs, ...activeJobs, ...delayedJobs];

  // Extract unique model IDs from job data
  const modelIds = new Set<string>();
  for (const job of allJobs) {
    if (job.data?.modelId) {
      modelIds.add(job.data.modelId);
    }
  }

  return Array.from(modelIds);
}

/**
 * Get channel IDs currently being tested (waiting + active + delayed)
 */
export async function getTestingChannelIds(): Promise<Set<string>> {
  const queue = getDetectionQueue();

  const [waitingJobs, activeJobs, delayedJobs] = await Promise.all([
    queue.getJobs(["waiting"], 0, 1000),
    queue.getJobs(["active"], 0, 100),
    queue.getJobs(["delayed"], 0, 1000),
  ]);

  const channelIds = new Set<string>();
  for (const job of [...waitingJobs, ...activeJobs, ...delayedJobs]) {
    if (job.data?.channelId) {
      channelIds.add(job.data.channelId);
    }
  }

  return channelIds;
}

/**
 * Clear all jobs from the queue
 */
export async function clearQueue(): Promise<void> {
  const queue = getDetectionQueue();
  await queue.obliterate({ force: true });
}

/**
 * Pause queue and drain all waiting jobs (for stopping detection)
 * Also cancels active jobs by moving them to failed state
 * Returns the number of jobs that were cleared
 */
export async function pauseAndDrainQueue(): Promise<{ cleared: number }> {
  const queue = getDetectionQueue();

  // Set stopped flag so workers skip remaining jobs
  await redis.set(DETECTION_STOPPED_KEY, "1", "EX", DETECTION_STOPPED_TTL);

  // Pause the queue globally to prevent new jobs from being processed across all workers
  await queue.pause();

  let cleared = 0;

  try {
    // Get counts before clearing
    const [waiting, delayed, activeJobs] = await Promise.all([
      queue.getWaitingCount(),
      queue.getDelayedCount(),
      queue.getJobs(["active"], 0, 1000),
    ]);

    const activeCount = activeJobs.length;

    // Move active jobs to failed state to stop them
    // This signals the worker to stop processing these jobs
    const failPromises = activeJobs.map(async (job) => {
      try {
        // Use discardJob for safer cancellation, fallback to moveToFailed
        if (job.token) {
          await job.moveToFailed(new Error("Detection stopped by user"), job.token, true);
        } else {
          // If no token, try to remove the job directly
          await job.remove().catch(() => {});
        }
      } catch (err) {
        // Job may have completed or already failed, ignore
      }
    });
    await Promise.allSettled(failPromises);

    // Drain waiting and delayed jobs (true = also drain delayed)
    await queue.drain(true);

    // Clear Redis semaphore counters to reset concurrency tracking
    const semaphoreKeys = await redis.keys("detection:semaphore:*");
    if (semaphoreKeys.length > 0) {
      await redis.del(...semaphoreKeys);
    }

    cleared = waiting + delayed + activeCount;
  } finally {
    // Always resume queue, even if an error occurred during cleanup
    await queue.resume();
  }

  return { cleared };
}

/**
 * Check if detection has been stopped by user
 */
export async function isDetectionStopped(): Promise<boolean> {
  const value = await redis.get(DETECTION_STOPPED_KEY);
  return value === "1";
}

/**
 * Clear the detection stopped flag (called when starting new detection)
 */
export async function clearStoppedFlag(): Promise<void> {
  await redis.del(DETECTION_STOPPED_KEY);
}
