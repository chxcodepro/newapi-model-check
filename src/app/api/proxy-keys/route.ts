// Proxy Keys API - List and create proxy API keys

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import prisma from "@/lib/prisma";
import { generateApiKey, getProxyApiKey, isKeyFromEnvironment } from "@/lib/utils/proxy-key";

// GET /api/proxy-keys - List all proxy keys
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const keys = await prisma.proxyKey.findMany({
      select: {
        id: true,
        name: true,
        key: true,
        enabled: true,
        allowAllModels: true,
        allowedChannelIds: true,
        allowedModelIds: true,
        lastUsedAt: true,
        usageCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Mask keys in response (show only first 8 and last 4 chars)
    const maskedKeys = keys.map((key) => ({
      ...key,
      key: maskKey(key.key),
      source: "database" as const,
    }));

    // Add the built-in key (env or auto-generated) at the top
    const builtInKey = getProxyApiKey();
    const isEnv = isKeyFromEnvironment();
    const builtInEntry = {
      id: "__builtin__",
      name: isEnv ? "环境变量密钥" : "自动生成密钥",
      key: maskKey(builtInKey),
      enabled: true,
      allowAllModels: true,
      allowedChannelIds: null,
      allowedModelIds: null,
      lastUsedAt: null,
      usageCount: 0,
      createdAt: null,
      updatedAt: null,
      source: isEnv ? "env" as const : "auto" as const,
    };

    return NextResponse.json({ keys: [builtInEntry, ...maskedKeys] });
  } catch (error) {
    console.error("[API] List proxy keys error:", error);
    return NextResponse.json(
      { error: "Failed to list proxy keys", code: "FETCH_ERROR" },
      { status: 500 }
    );
  }
}

// POST /api/proxy-keys - Create a new proxy key
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      name,
      key: customKey,
      enabled = true,
      allowAllModels = true,
      allowedChannelIds,
      allowedModelIds,
    } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Name is required", code: "MISSING_NAME" },
        { status: 400 }
      );
    }

    // Generate or use custom key
    let key = customKey;
    if (!key) {
      key = generateApiKey();
    } else if (!key.startsWith("sk-")) {
      return NextResponse.json(
        { error: "Custom key must start with 'sk-'", code: "INVALID_KEY_FORMAT" },
        { status: 400 }
      );
    }

    // Check for duplicate key
    const existing = await prisma.proxyKey.findUnique({
      where: { key },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Key already exists", code: "DUPLICATE_KEY" },
        { status: 409 }
      );
    }

    // Create the key
    const proxyKey = await prisma.proxyKey.create({
      data: {
        name: name.trim(),
        key,
        enabled,
        allowAllModels,
        allowedChannelIds: allowedChannelIds || null,
        allowedModelIds: allowedModelIds || null,
      },
    });

    return NextResponse.json({
      success: true,
      key: {
        id: proxyKey.id,
        name: proxyKey.name,
        key: proxyKey.key, // Return full key on creation
        enabled: proxyKey.enabled,
        allowAllModels: proxyKey.allowAllModels,
        allowedChannelIds: proxyKey.allowedChannelIds,
        allowedModelIds: proxyKey.allowedModelIds,
        createdAt: proxyKey.createdAt,
      },
    });
  } catch (error) {
    console.error("[API] Create proxy key error:", error);
    return NextResponse.json(
      { error: "Failed to create proxy key", code: "CREATE_ERROR" },
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
