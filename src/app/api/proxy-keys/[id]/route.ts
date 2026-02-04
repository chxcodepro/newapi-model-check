// Proxy Key API - Update and delete individual proxy keys

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import prisma from "@/lib/prisma";
import { getProxyApiKey, isKeyFromEnvironment } from "@/lib/utils/proxy-key";

// GET /api/proxy-keys/[id] - Get a specific proxy key (with full key)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    // Handle built-in key
    if (id === "__builtin__") {
      const builtInKey = getProxyApiKey();
      const isEnv = isKeyFromEnvironment();
      return NextResponse.json({
        key: {
          id: "__builtin__",
          name: isEnv ? "环境变量密钥" : "自动生成密钥",
          key: builtInKey,
          enabled: true,
          allowAllModels: true,
          source: isEnv ? "env" : "auto",
        },
      });
    }

    const key = await prisma.proxyKey.findUnique({
      where: { id },
    });

    if (!key) {
      return NextResponse.json(
        { error: "Proxy key not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ key });
  } catch (error) {
    console.error("[API] Get proxy key error:", error);
    return NextResponse.json(
      { error: "Failed to get proxy key", code: "FETCH_ERROR" },
      { status: 500 }
    );
  }
}

// PUT /api/proxy-keys/[id] - Update a proxy key
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      enabled,
      allowAllModels,
      allowedChannelIds,
      allowedModelIds,
    } = body;

    // Check if key exists
    const existing = await prisma.proxyKey.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Proxy key not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    // Update the key
    const key = await prisma.proxyKey.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(enabled !== undefined && { enabled }),
        ...(allowAllModels !== undefined && { allowAllModels }),
        ...(allowedChannelIds !== undefined && { allowedChannelIds }),
        ...(allowedModelIds !== undefined && { allowedModelIds }),
      },
    });

    return NextResponse.json({
      success: true,
      key: {
        id: key.id,
        name: key.name,
        key: maskKey(key.key),
        enabled: key.enabled,
        allowAllModels: key.allowAllModels,
        allowedChannelIds: key.allowedChannelIds,
        allowedModelIds: key.allowedModelIds,
        updatedAt: key.updatedAt,
      },
    });
  } catch (error) {
    console.error("[API] Update proxy key error:", error);
    return NextResponse.json(
      { error: "Failed to update proxy key", code: "UPDATE_ERROR" },
      { status: 500 }
    );
  }
}

// DELETE /api/proxy-keys/[id] - Delete a proxy key
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    // Check if key exists
    const existing = await prisma.proxyKey.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Proxy key not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    // Delete the key
    await prisma.proxyKey.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: "Proxy key deleted",
    });
  } catch (error) {
    console.error("[API] Delete proxy key error:", error);
    return NextResponse.json(
      { error: "Failed to delete proxy key", code: "DELETE_ERROR" },
      { status: 500 }
    );
  }
}

// Helper function to mask key for display
function maskKey(key: string): string {
  if (key.length <= 12) {
    return key.substring(0, 4) + "****";
  }
  return key.substring(0, 8) + "..." + key.substring(key.length - 4);
}
