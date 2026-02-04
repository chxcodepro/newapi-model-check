// Proxy Key Regenerate API - Regenerate a proxy key's value

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import prisma from "@/lib/prisma";
import { generateApiKey } from "@/lib/utils/proxy-key";

// POST /api/proxy-keys/[id]/regenerate - Regenerate a proxy key
export async function POST(
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

    // Generate new key
    const newKey = generateApiKey();

    // Update the key
    const key = await prisma.proxyKey.update({
      where: { id },
      data: {
        key: newKey,
        usageCount: 0, // Reset usage count on regeneration
      },
    });

    return NextResponse.json({
      success: true,
      key: {
        id: key.id,
        name: key.name,
        key: key.key, // Return full key after regeneration
        enabled: key.enabled,
        allowAllModels: key.allowAllModels,
        allowedChannelIds: key.allowedChannelIds,
        allowedModelIds: key.allowedModelIds,
        updatedAt: key.updatedAt,
      },
    });
  } catch (error) {
    console.error("[API] Regenerate proxy key error:", error);
    return NextResponse.json(
      { error: "Failed to regenerate proxy key", code: "REGENERATE_ERROR" },
      { status: 500 }
    );
  }
}
