// GET /api/status - Public system status endpoint

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getQueueStats, isQueueRunning } from "@/lib/queue/queue";

export async function GET() {
  try {
    // Get basic statistics
    const [channelCount, modelCount, recentLogs] = await Promise.all([
      prisma.channel.count({ where: { enabled: true } }),
      prisma.model.count(),
      prisma.checkLog.findMany({
        select: { status: true },
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          },
        },
      }),
    ]);

    // Calculate health rate
    const successCount = recentLogs.filter((log) => log.status === "SUCCESS").length;
    const healthRate = recentLogs.length > 0 ? Math.round((successCount / recentLogs.length) * 100) : 0;

    // Get queue status
    let queueStats = null;
    try {
      queueStats = await getQueueStats();
    } catch {
      // Redis might not be available
    }

    return NextResponse.json({
      status: "operational",
      timestamp: new Date().toISOString(),
      statistics: {
        channels: channelCount,
        models: modelCount,
        checksLast24h: recentLogs.length,
        healthRate,
      },
      queue: queueStats
        ? {
            isRunning: isQueueRunning(queueStats),
            pending: queueStats.waiting + queueStats.delayed,
            active: queueStats.active,
            delayed: queueStats.delayed,
          }
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        message: "Failed to fetch system status",
      },
      { status: 500 }
    );
  }
}
