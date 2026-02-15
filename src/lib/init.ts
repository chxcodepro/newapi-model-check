// Application initialization - Start worker and scheduler

import { startWorker, isWorkerRunning } from "@/lib/queue/worker";
import { startAllCronsWithConfig, getCronStatus } from "@/lib/scheduler";

let initialized = false;

/**
 * Initialize background services
 * Should be called once on application startup
 */
export async function initializeServices(): Promise<void> {
  if (initialized) {
    return;
  }

  // Start worker
  if (!isWorkerRunning()) {
    startWorker();
  }

  // Start cron jobs (load config from database)
  await startAllCronsWithConfig();

  initialized = true;

  // Log status
  const cronStatus = getCronStatus();
}

