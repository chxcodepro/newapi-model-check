// Scheduler API - Manage cron jobs and maintenance tasks

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import prisma from "@/lib/prisma";
import {
  startAllCronsWithConfig,
  stopAllCrons,
  getCronStatus,
  cleanupOldLogs,
  startDetectionCronWithConfig,
  startCleanupCron,
} from "@/lib/scheduler";

const DEFAULT_RUNTIME_CONFIG = {
  channelConcurrency: parseInt(process.env.CHANNEL_CONCURRENCY || "5", 10),
  maxGlobalConcurrency: parseInt(process.env.MAX_GLOBAL_CONCURRENCY || "30", 10),
  minDelayMs: parseInt(process.env.DETECTION_MIN_DELAY_MS || "3000", 10),
  maxDelayMs: parseInt(process.env.DETECTION_MAX_DELAY_MS || "5000", 10),
};

async function getRuntimeConfig() {
  try {
    const config = await prisma.schedulerConfig.findUnique({
      where: { id: "default" },
      select: {
        channelConcurrency: true,
        maxGlobalConcurrency: true,
        minDelayMs: true,
        maxDelayMs: true,
      },
    });

    if (!config) {
      return DEFAULT_RUNTIME_CONFIG;
    }

    return {
      channelConcurrency: config.channelConcurrency,
      maxGlobalConcurrency: config.maxGlobalConcurrency,
      minDelayMs: config.minDelayMs,
      maxDelayMs: config.maxDelayMs,
    };
  } catch {
    return DEFAULT_RUNTIME_CONFIG;
  }
}

// GET /api/scheduler - Get scheduler status
export async function GET() {
  try {
    const status = getCronStatus();
    const config = await getRuntimeConfig();
    return NextResponse.json({
      ...status,
      config,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get scheduler status", code: "STATUS_ERROR" },
      { status: 500 }
    );
  }
}

// POST /api/scheduler - Control scheduler
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const { action } = body;

    switch (action) {
      case "start":
        await startAllCronsWithConfig();
        return NextResponse.json({
          success: true,
          message: "All cron jobs started",
          status: getCronStatus(),
        });

      case "stop":
        stopAllCrons();
        return NextResponse.json({
          success: true,
          message: "All cron jobs stopped",
          status: getCronStatus(),
        });

      case "start-detection":
        await startDetectionCronWithConfig();
        return NextResponse.json({
          success: true,
          message: "Detection cron started",
          status: getCronStatus(),
        });

      case "start-cleanup":
        startCleanupCron();
        return NextResponse.json({
          success: true,
          message: "Cleanup cron started",
          status: getCronStatus(),
        });

      case "cleanup-now":
        const result = await cleanupOldLogs();
        return NextResponse.json({
          success: true,
          message: `Cleanup complete: ${result.deleted} logs removed`,
          deleted: result.deleted,
        });

      default:
        return NextResponse.json(
          {
            error: "Invalid action. Use: start, stop, start-detection, start-cleanup, cleanup-now",
            code: "INVALID_ACTION",
          },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to control scheduler", code: "SCHEDULER_ERROR" },
      { status: 500 }
    );
  }
}
