// GET /api/dashboard - Get channels and models status with pagination and filtering

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isAuthenticated } from "@/lib/middleware/auth";
import { Prisma } from "@/generated/prisma";

const DEFAULT_PAGE_SIZE = 10;

export async function GET(request: NextRequest) {
  const authenticated = isAuthenticated(request);

  // Parse pagination parameters
  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10)));

  // Parse filter parameters
  const search = searchParams.get("search")?.trim() || "";
  const endpointFilter = searchParams.get("endpointFilter") || "all";
  const statusFilter = searchParams.get("statusFilter") || "all";

  try {
    // Build model filter conditions
    const modelWhereConditions: Prisma.ModelWhereInput[] = [];

    // Search filter - filter by model name
    if (search) {
      modelWhereConditions.push({
        modelName: { contains: search, mode: "insensitive" },
      });
    }

    // Endpoint filter - filter by detected endpoints (PostgreSQL native array)
    if (endpointFilter !== "all") {
      modelWhereConditions.push({
        detectedEndpoints: { has: endpointFilter },
      });
    }

    // Status filter - filter by lastStatus
    if (statusFilter === "healthy") {
      modelWhereConditions.push({ lastStatus: true });
    } else if (statusFilter === "unhealthy") {
      modelWhereConditions.push({ lastStatus: false });
    } else if (statusFilter === "unknown") {
      modelWhereConditions.push({ lastStatus: null });
    }

    const modelWhere: Prisma.ModelWhereInput | undefined =
      modelWhereConditions.length > 0 ? { AND: modelWhereConditions } : undefined;

    // Get channels that have at least one matching model (for filtered queries)
    // or all enabled channels (for unfiltered queries)
    const hasFilters = search || endpointFilter !== "all" || statusFilter !== "all";

    let channelIds: string[] | undefined;
    if (hasFilters) {
      // Find channels that have matching models
      const channelsWithMatchingModels = await prisma.channel.findMany({
        where: {
          enabled: true,
          models: { some: modelWhere },
        },
        select: { id: true },
      });
      channelIds = channelsWithMatchingModels.map((c) => c.id);
    }

    // Get total count for pagination
    const totalChannels = hasFilters
      ? channelIds?.length || 0
      : await prisma.channel.count({ where: { enabled: true } });

    // Fetch paginated channels with filtered models
    const channels = await prisma.channel.findMany({
      where: {
        enabled: true,
        ...(hasFilters && channelIds ? { id: { in: channelIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        baseUrl: authenticated, // Only show baseUrl to authenticated users
        createdAt: true,
        models: {
          where: modelWhere,
          select: {
            id: true,
            modelName: true,
            detectedEndpoints: true,
            lastStatus: true,
            lastLatency: true,
            lastCheckedAt: true,
            checkLogs: {
              select: {
                id: true,
                status: true,
                latency: true,
                statusCode: true,
                endpointType: true,
                // Only include sensitive fields for authenticated users
                responseContent: authenticated,
                errorMsg: authenticated,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 7, // Last 7 checks for heatmap
            },
          },
        },
      },
      orderBy: [
        { sortOrder: "asc" },
        { createdAt: "desc" },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // Calculate summary statistics for ALL channels (not just current page)
    const allChannelsForStats = await prisma.channel.findMany({
      where: { enabled: true },
      select: {
        models: {
          select: {
            id: true,
            lastStatus: true,
            checkLogs: {
              select: {
                status: true,
                endpointType: true,
              },
              orderBy: { createdAt: "desc" },
              take: 7,
            },
          },
        },
      },
    });

    const totalModels = allChannelsForStats.reduce((sum, ch) => sum + ch.models.length, 0);

    // A model is healthy if all its tested endpoints are successful
    const healthyModels = allChannelsForStats.reduce((sum, ch) => {
      return sum + ch.models.filter((m) => {
        if (m.checkLogs.length === 0) return false;

        // Get latest status for each endpoint type
        const endpointStatuses: Record<string, string> = {};
        for (const log of m.checkLogs) {
          if (!endpointStatuses[log.endpointType]) {
            endpointStatuses[log.endpointType] = log.status;
          }
        }

        // Model is healthy only if all tested endpoints are successful
        const statuses = Object.values(endpointStatuses);
        return statuses.length > 0 && statuses.every((s) => s === "SUCCESS");
      }).length;
    }, 0);

    const totalPages = Math.ceil(totalChannels / pageSize);

    return NextResponse.json({
      authenticated,
      summary: {
        totalChannels,
        totalModels,
        healthyModels,
        healthRate: totalModels > 0 ? Math.round((healthyModels / totalModels) * 100) : 0,
      },
      pagination: {
        page,
        pageSize,
        totalPages,
        totalChannels,
      },
      channels,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch dashboard data", code: "FETCH_ERROR" },
      { status: 500 }
    );
  }
}
