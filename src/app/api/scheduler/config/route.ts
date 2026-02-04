// Scheduler Config API - Get and update scheduler configuration

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import prisma from "@/lib/prisma";
import { reloadSchedulerConfig, getCronStatus } from "@/lib/scheduler";

// Default configuration values (from environment variables)
const DEFAULT_CONFIG = {
  enabled: process.env.AUTO_DETECT_ENABLED !== "false",
  cronSchedule: process.env.CRON_SCHEDULE || "0 0,8,12,16,20 * * *",
  timezone: process.env.CRON_TIMEZONE || "Asia/Shanghai",
  channelConcurrency: parseInt(process.env.CHANNEL_CONCURRENCY || "5", 10),
  maxGlobalConcurrency: parseInt(process.env.MAX_GLOBAL_CONCURRENCY || "30", 10),
  minDelayMs: parseInt(process.env.DETECTION_MIN_DELAY_MS || "3000", 10),
  maxDelayMs: parseInt(process.env.DETECTION_MAX_DELAY_MS || "5000", 10),
  detectAllChannels: true,
};

// GET /api/scheduler/config - Get scheduler configuration with channel list
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    // Get or create scheduler config
    let config = await prisma.schedulerConfig.findUnique({
      where: { id: "default" },
    });

    // If no config exists, create from defaults
    if (!config) {
      config = await prisma.schedulerConfig.create({
        data: {
          id: "default",
          ...DEFAULT_CONFIG,
        },
      });
    }

    // Get all enabled channels with their models
    const channels = await prisma.channel.findMany({
      where: { enabled: true },
      select: {
        id: true,
        name: true,
        baseUrl: true,
        models: {
          select: {
            id: true,
            modelName: true,
            lastStatus: true,
          },
          orderBy: { modelName: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });

    // Get cron status for next run time
    const cronStatus = getCronStatus();

    return NextResponse.json({
      config: {
        enabled: config.enabled,
        cronSchedule: config.cronSchedule,
        timezone: config.timezone,
        channelConcurrency: config.channelConcurrency,
        maxGlobalConcurrency: config.maxGlobalConcurrency,
        minDelayMs: config.minDelayMs,
        maxDelayMs: config.maxDelayMs,
        detectAllChannels: config.detectAllChannels,
        selectedChannelIds: config.selectedChannelIds,
        selectedModelIds: config.selectedModelIds,
        updatedAt: config.updatedAt,
      },
      channels,
      nextRun: cronStatus.detection.nextRun,
    });
  } catch (error) {
    console.error("[API] Get scheduler config error:", error);
    return NextResponse.json(
      { error: "Failed to get scheduler config", code: "FETCH_ERROR" },
      { status: 500 }
    );
  }
}

// PUT /api/scheduler/config - Update scheduler configuration
export async function PUT(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      enabled,
      cronSchedule,
      timezone,
      channelConcurrency,
      maxGlobalConcurrency,
      minDelayMs,
      maxDelayMs,
      detectAllChannels,
      selectedChannelIds,
      selectedModelIds,
    } = body;

    // Validate cron schedule format
    if (cronSchedule !== undefined) {
      const cronParts = cronSchedule.split(" ");
      if (cronParts.length !== 5) {
        return NextResponse.json(
          { error: "Invalid cron schedule format. Expected 5 parts: minute hour day month weekday", code: "INVALID_CRON" },
          { status: 400 }
        );
      }
    }

    // Validate delay values
    if (minDelayMs !== undefined && maxDelayMs !== undefined) {
      if (minDelayMs < 0 || maxDelayMs < 0) {
        return NextResponse.json(
          { error: "Delay values must be non-negative", code: "INVALID_DELAY" },
          { status: 400 }
        );
      }
      if (minDelayMs > maxDelayMs) {
        return NextResponse.json(
          { error: "Minimum delay cannot be greater than maximum delay", code: "INVALID_DELAY" },
          { status: 400 }
        );
      }
    }

    // Update or create config
    const config = await prisma.schedulerConfig.upsert({
      where: { id: "default" },
      update: {
        ...(enabled !== undefined && { enabled }),
        ...(cronSchedule !== undefined && { cronSchedule }),
        ...(timezone !== undefined && { timezone }),
        ...(channelConcurrency !== undefined && { channelConcurrency }),
        ...(maxGlobalConcurrency !== undefined && { maxGlobalConcurrency }),
        ...(minDelayMs !== undefined && { minDelayMs }),
        ...(maxDelayMs !== undefined && { maxDelayMs }),
        ...(detectAllChannels !== undefined && { detectAllChannels }),
        ...(selectedChannelIds !== undefined && { selectedChannelIds }),
        ...(selectedModelIds !== undefined && { selectedModelIds }),
      },
      create: {
        id: "default",
        ...DEFAULT_CONFIG,
        ...(enabled !== undefined && { enabled }),
        ...(cronSchedule !== undefined && { cronSchedule }),
        ...(timezone !== undefined && { timezone }),
        ...(channelConcurrency !== undefined && { channelConcurrency }),
        ...(maxGlobalConcurrency !== undefined && { maxGlobalConcurrency }),
        ...(minDelayMs !== undefined && { minDelayMs }),
        ...(maxDelayMs !== undefined && { maxDelayMs }),
        ...(detectAllChannels !== undefined && { detectAllChannels }),
        ...(selectedChannelIds !== undefined && { selectedChannelIds }),
        ...(selectedModelIds !== undefined && { selectedModelIds }),
      },
    });

    // Reload cron job with new configuration
    await reloadSchedulerConfig();

    // Get updated cron status
    const cronStatus = getCronStatus();

    return NextResponse.json({
      success: true,
      config: {
        enabled: config.enabled,
        cronSchedule: config.cronSchedule,
        timezone: config.timezone,
        channelConcurrency: config.channelConcurrency,
        maxGlobalConcurrency: config.maxGlobalConcurrency,
        minDelayMs: config.minDelayMs,
        maxDelayMs: config.maxDelayMs,
        detectAllChannels: config.detectAllChannels,
        selectedChannelIds: config.selectedChannelIds,
        selectedModelIds: config.selectedModelIds,
        updatedAt: config.updatedAt,
      },
      nextRun: cronStatus.detection.nextRun,
    });
  } catch (error) {
    console.error("[API] Update scheduler config error:", error);
    return NextResponse.json(
      { error: "Failed to update scheduler config", code: "UPDATE_ERROR" },
      { status: 500 }
    );
  }
}
