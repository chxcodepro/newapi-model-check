// Channel API - CRUD operations for channels

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/middleware/auth";
import { EndpointType } from "@prisma/client";
import { appendChannelToWebDAV, removeChannelFromWebDAV, isWebDAVConfigured } from "@/lib/webdav/sync";

// GET /api/channel - List all channels (authenticated)
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const channels = await prisma.channel.findMany({
      include: {
        _count: {
          select: { models: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Mask API keys for security
    const maskedChannels = channels.map((ch) => ({
      ...ch,
      apiKey: ch.apiKey.slice(0, 8) + "..." + ch.apiKey.slice(-4),
    }));

    return NextResponse.json({ channels: maskedChannels });
  } catch (error) {
    console.error("[API] List channels error:", error);
    return NextResponse.json(
      { error: "Failed to fetch channels", code: "FETCH_ERROR" },
      { status: 500 }
    );
  }
}

// POST /api/channel - Create new channel
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { name, baseUrl, apiKey, proxy, models } = body;

    // Validate required fields
    if (!name || !baseUrl || !apiKey) {
      return NextResponse.json(
        { error: "Name, baseUrl, and apiKey are required", code: "MISSING_FIELDS" },
        { status: 400 }
      );
    }

    // Create channel
    const channel = await prisma.channel.create({
      data: {
        name,
        baseUrl: baseUrl.replace(/\/$/, ""), // Remove trailing slash
        apiKey,
        proxy: proxy || null,
        enabled: true,
      },
    });

    // If models are provided, create them with empty detectedEndpoints (will be populated after testing)
    if (models && Array.isArray(models) && models.length > 0) {
      await prisma.model.createMany({
        data: models.map((modelName: string) => ({
          channelId: channel.id,
          modelName,
          detectedEndpoints: [] as EndpointType[],
        })),
        skipDuplicates: true,
      });
    }

    // Sync to WebDAV if configured (async, don't block response)
    if (isWebDAVConfigured()) {
      appendChannelToWebDAV({
        name: channel.name,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        proxy: channel.proxy,
        enabled: channel.enabled,
      }).catch((err) => {
        console.error("[API] WebDAV append error:", err);
      });
    }

    return NextResponse.json({
      success: true,
      channel: {
        ...channel,
        apiKey: channel.apiKey.slice(0, 8) + "...",
      },
    });
  } catch (error) {
    console.error("[API] Create channel error:", error);
    return NextResponse.json(
      { error: "Failed to create channel", code: "CREATE_ERROR" },
      { status: 500 }
    );
  }
}

// PUT /api/channel - Update channel
export async function PUT(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id, name, baseUrl, apiKey, proxy, enabled } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Channel ID is required", code: "MISSING_ID" },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (baseUrl !== undefined) updateData.baseUrl = baseUrl.replace(/\/$/, "");
    if (apiKey !== undefined) updateData.apiKey = apiKey;
    if (proxy !== undefined) updateData.proxy = proxy || null;
    if (enabled !== undefined) updateData.enabled = Boolean(enabled);

    const channel = await prisma.channel.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      channel: {
        ...channel,
        apiKey: channel.apiKey.slice(0, 8) + "...",
      },
    });
  } catch (error) {
    console.error("[API] Update channel error:", error);
    return NextResponse.json(
      { error: "Failed to update channel", code: "UPDATE_ERROR" },
      { status: 500 }
    );
  }
}

// DELETE /api/channel - Delete channel
export async function DELETE(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Channel ID is required", code: "MISSING_ID" },
        { status: 400 }
      );
    }

    // Get channel info before deletion (for WebDAV sync)
    const channel = await prisma.channel.findUnique({
      where: { id },
      select: { name: true, baseUrl: true, apiKey: true, proxy: true, enabled: true },
    });

    if (!channel) {
      return NextResponse.json(
        { error: "Channel not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    await prisma.channel.delete({
      where: { id },
    });

    // Sync to WebDAV if configured (async, don't block response)
    if (isWebDAVConfigured()) {
      removeChannelFromWebDAV({
        name: channel.name,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        proxy: channel.proxy,
        enabled: channel.enabled,
      }).catch((err) => {
        console.error("[API] WebDAV remove error:", err);
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API] Delete channel error:", error);
    return NextResponse.json(
      { error: "Failed to delete channel", code: "DELETE_ERROR" },
      { status: 500 }
    );
  }
}
