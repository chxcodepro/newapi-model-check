// POST /api/detect - Trigger detection manually

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import {
  triggerFullDetection,
  triggerChannelDetection,
  triggerModelDetection,
  getDetectionProgress,
} from "@/lib/queue/service";
import { getQueueStats, getTestingChannelIds, isQueueRunning, pauseAndDrainQueue } from "@/lib/queue/queue";

// POST /api/detect - Trigger detection
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const { channelId, modelId, modelIds } = body;

    // Check if detection is already running for the same scope
    if (!modelId) {
      if (channelId) {
        // Channel-level detection: only block if this specific channel is already being tested
        const testingChannels = await getTestingChannelIds();
        if (testingChannels.has(channelId)) {
          return NextResponse.json(
            {
              error: "该渠道检测任务正在进行中",
              code: "DETECTION_RUNNING",
              progress: await getDetectionProgress(),
            },
            { status: 409 }
          );
        }
      } else {
        // Full detection: block if any detection is running
        const stats = await getQueueStats();
        if (isQueueRunning(stats)) {
          return NextResponse.json(
            {
              error: "检测任务正在进行中",
              code: "DETECTION_RUNNING",
              progress: await getDetectionProgress(),
            },
            { status: 409 }
          );
        }
      }
    }

    let result;

    if (modelId) {
      // Trigger detection for specific model
      result = await triggerModelDetection(modelId);
      return NextResponse.json({
        success: true,
        message: "模型检测已启动",
        ...result,
      });
    } else if (channelId) {
      // Trigger detection for specific channel (optionally filtered by modelIds)
      result = await triggerChannelDetection(channelId, modelIds);
      return NextResponse.json({
        success: true,
        message: `渠道检测已启动，共 ${result.modelCount} 个模型，${result.jobCount} 个任务`,
        ...result,
      });
    } else {
      // Trigger full detection for all channels
      result = await triggerFullDetection();
      return NextResponse.json({
        success: true,
        message: `全量检测已启动，${result.channelCount} 个渠道，${result.modelCount} 个模型，${result.jobCount} 个任务`,
        ...result,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "启动检测失败";
    return NextResponse.json(
      { error: message, code: "DETECT_ERROR" },
      { status: 500 }
    );
  }
}

// GET /api/detect - Get detection progress
export async function GET(request: NextRequest) {
  try {
    const progress = await getDetectionProgress();
    return NextResponse.json(progress);
  } catch (error) {
    return NextResponse.json(
      { error: "获取检测进度失败", code: "PROGRESS_ERROR" },
      { status: 500 }
    );
  }
}

// DELETE /api/detect - Stop all detection tasks
export async function DELETE(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const { cleared } = await pauseAndDrainQueue();
    return NextResponse.json({
      success: true,
      message: `已停止检测，清理了 ${cleared} 个等待中的任务`,
      cleared,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "停止检测失败";
    return NextResponse.json(
      { error: message, code: "STOP_ERROR" },
      { status: 500 }
    );
  }
}
