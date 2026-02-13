// Proxy utilities for API forwarding
// Routes requests to channels stored in database based on model name

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { proxyFetch } from "@/lib/utils/proxy-fetch";
import { getProxyApiKey, validateProxyKey, canAccessModel, type ValidateKeyResult } from "@/lib/utils/proxy-key";

// Round-robin counter per channel
const roundRobinCounters = new Map<string, number>();

/**
 * Safely parse JSON field as string array
 * Returns null if the value is not a valid string array
 */
function parseStringArray(value: unknown): string[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[];
  }
  return null;
}

// Proxy request timeout (10 minutes for long-running CLI requests)
const PROXY_TIMEOUT = 600000;

// Global proxy from environment
const GLOBAL_PROXY = process.env.GLOBAL_PROXY;

// API types for different authentication schemes
export type ApiType = "openai" | "anthropic" | "gemini";

// Request context with validated key info
export interface ProxyRequestContext {
  keyResult: ValidateKeyResult;
}

/**
 * Verify proxy API key from request (legacy sync version)
 * Key is always required (auto-generated if not configured)
 */
export function verifyProxyKey(request: NextRequest): NextResponse | null {
  const expectedKey = getProxyApiKey();

  const authHeader = request.headers.get("Authorization");
  const xApiKey = request.headers.get("x-api-key");
  const googApiKey = request.headers.get("x-goog-api-key");

  // Accept key from any common header format
  const apiKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : xApiKey || googApiKey;

  if (!apiKey || apiKey !== expectedKey) {
    return NextResponse.json(
      {
        error: {
          message: "Invalid or missing API key",
          type: "authentication_error",
        },
      },
      { status: 401 }
    );
  }

  return null;
}

/**
 * Verify proxy API key from request (async version with multi-key support)
 * Returns the validated key result for permission checking
 */
export async function verifyProxyKeyAsync(request: NextRequest): Promise<{
  error?: NextResponse;
  keyResult?: ValidateKeyResult;
}> {
  const authHeader = request.headers.get("Authorization");
  const xApiKey = request.headers.get("x-api-key");
  const googApiKey = request.headers.get("x-goog-api-key");

  // Accept key from any common header format
  const apiKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : xApiKey || googApiKey;

  if (!apiKey) {
    return {
      error: NextResponse.json(
        {
          error: {
            message: "Missing API key",
            type: "authentication_error",
          },
        },
        { status: 401 }
      ),
    };
  }

  const keyResult = await validateProxyKey(apiKey);

  if (!keyResult.valid) {
    return {
      error: NextResponse.json(
        {
          error: {
            message: "Invalid API key",
            type: "authentication_error",
          },
        },
        { status: 401 }
      ),
    };
  }

  return { keyResult };
}

/**
 * Find channel by model name
 * Supports both "modelName" and "channelName/modelName" formats
 * Returns the channel that contains the specified model
 * Supports multi-key routing (round_robin / random) and filters out invalid keys
 */
export async function findChannelByModel(modelName: string): Promise<{
  channelId: string;
  channelName: string;
  baseUrl: string;
  apiKey: string;
  proxy: string | null;
  actualModelName: string;
  modelId: string;
  modelStatus: boolean | null;
} | null> {
  // Parse channel prefix if present (e.g., "渠道名/模型名" -> channelName="渠道名", actualModel="模型名")
  let channelNameFilter: string | undefined;
  let actualModelName = modelName;

  const slashIndex = modelName.indexOf("/");
  if (slashIndex > 0) {
    channelNameFilter = modelName.slice(0, slashIndex);
    actualModelName = modelName.slice(slashIndex + 1);
  }

  const models = await prisma.model.findMany({
    where: {
      modelName: actualModelName,
      channel: {
        enabled: true,
        ...(channelNameFilter ? { name: channelNameFilter } : {}),
      },
    },
    include: {
      channel: {
        select: {
          id: true,
          name: true,
          baseUrl: true,
          apiKey: true,
          proxy: true,
          enabled: true,
          sortOrder: true,
          createdAt: true,
          keyMode: true,
          routeStrategy: true,
        },
      },
      channelKey: {
        select: {
          apiKey: true,
          lastValid: true,
        },
      },
    },
    orderBy: [
      { channel: { sortOrder: "asc" } },
      { channel: { createdAt: "desc" } },
      { id: "asc" },
    ],
    take: 200,
  });

  if (models.length === 0) {
    return null;
  }

  // Filter out models whose channelKey is explicitly invalid
  // or model is explicitly unhealthy.
  const validModels = models.filter((m) => {
    if (m.channelKey && m.channelKey.lastValid === false) return false;
    if (m.lastStatus === false) return false;
    return true;
  });

  if (validModels.length === 0) {
    return null;
  }

  // Route within one channel only.
  // If multiple channels have same model name, pick the first channel by configured order.
  let selected;
  const primaryChannelId = validModels[0].channel.id;
  const sameChannelModels = validModels.filter((m) => m.channel.id === primaryChannelId);
  const channel = sameChannelModels[0].channel;

  if (channel.keyMode === "multi" && sameChannelModels.length > 1) {
    if (channel.routeStrategy === "random") {
      selected = sameChannelModels[Math.floor(Math.random() * sameChannelModels.length)];
    } else {
      // round_robin
      const counterKey = `${channel.id}:${actualModelName}`;
      const current = roundRobinCounters.get(counterKey) || 0;
      selected = sameChannelModels[current % sameChannelModels.length];
      roundRobinCounters.set(counterKey, current + 1);
    }
  } else {
    selected = sameChannelModels[0];
  }

  // Use channelKey's apiKey if available, otherwise fall back to channel's default
  const apiKey = selected.channelKey?.apiKey ?? selected.channel.apiKey;

  return {
    channelId: selected.channel.id,
    channelName: selected.channel.name,
    baseUrl: selected.channel.baseUrl.replace(/\/$/, ""),
    apiKey,
    proxy: selected.channel.proxy,
    actualModelName,
    modelId: selected.id,
    modelStatus: selected.lastStatus,
  };
}

/**
 * Find channel by model name with permission check
 * Returns null if the key doesn't have permission to access the model
 */
export async function findChannelByModelWithPermission(
  modelName: string,
  keyResult: ValidateKeyResult
): Promise<{
  channelId: string;
  channelName: string;
  baseUrl: string;
  apiKey: string;
  proxy: string | null;
  actualModelName: string;
  modelId: string;
  modelStatus: boolean | null;
} | null> {
  const channel = await findChannelByModel(modelName);

  if (!channel) {
    return null;
  }

  // Check permission
  const hasPermission = await canAccessModel(
    keyResult.keyRecord,
    keyResult.isEnvKey,
    channel.channelId,
    channel.modelId,
    channel.modelStatus
  );

  if (!hasPermission) {
    return null;
  }

  return channel;
}

/**
 * Get all available models from all enabled channels
 * Only returns models that have been successfully tested (at least one endpoint SUCCESS)
 */
export async function getAllModelsWithChannels(keyResult?: ValidateKeyResult): Promise<
  Array<{
    id: string;
    modelName: string;
    channelName: string;
    channelId: string;
  }>
> {
  // Build where clause based on key permissions
  let whereClause: {
    channel: { enabled: boolean };
    checkLogs?: { some: { status: "SUCCESS" } };
    channelId?: { in: string[] };
    id?: { in: string[] };
  } = {
    channel: { enabled: true },
    // Only include models that have at least one successful check log
    checkLogs: {
      some: {
        status: "SUCCESS",
      },
    },
  };

  // If key has restricted permissions, filter by allowed channels/models
  if (keyResult?.keyRecord && !keyResult.keyRecord.allowAllModels) {
    const allowedChannelIds = parseStringArray(keyResult.keyRecord.allowedChannelIds);
    const allowedModelIds = parseStringArray(keyResult.keyRecord.allowedModelIds);

    const hasChannelPerms = allowedChannelIds !== null && allowedChannelIds.length > 0;
    const hasModelPerms = allowedModelIds !== null && allowedModelIds.length > 0;

    // If no explicit permissions configured, return empty (deny all)
    if (!hasChannelPerms && !hasModelPerms) {
      return [];
    }

    // Build OR condition: channel match OR model match
    if (hasChannelPerms && hasModelPerms) {
      // Need to use Prisma OR logic - but findMany doesn't support top-level OR easily
      // So we'll filter by channelId OR modelId using two queries and merge
      // For simplicity, we use channelId filter first, then add model filter
      whereClause = {
        ...whereClause,
        OR: [
          { channelId: { in: allowedChannelIds } },
          { id: { in: allowedModelIds } },
        ],
      } as typeof whereClause;
    } else if (hasChannelPerms) {
      whereClause = {
        ...whereClause,
        channelId: { in: allowedChannelIds },
      };
    } else if (hasModelPerms) {
      whereClause = {
        ...whereClause,
        id: { in: allowedModelIds },
      };
    }
  }

  const models = await prisma.model.findMany({
    where: whereClause,
    include: {
      channel: {
        select: { id: true, name: true },
      },
    },
    orderBy: [
      { channel: { name: "asc" } },
      { modelName: "asc" },
    ],
  });

  const uniqueModels = new Map<string, {
    id: string;
    modelName: string;
    channelName: string;
    channelId: string;
  }>();

  for (const m of models) {
    const dedupeKey = `${m.channel.id}\u0000${m.modelName}`;
    if (!uniqueModels.has(dedupeKey)) {
      uniqueModels.set(dedupeKey, {
        id: m.id,
        modelName: m.modelName,
        channelName: m.channel.name,
        channelId: m.channel.id,
      });
    }
  }

  return Array.from(uniqueModels.values());
}

/**
 * Build headers for upstream request based on API type
 */
export function buildUpstreamHeaders(
  apiKey: string,
  apiType: ApiType,
  extraHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  switch (apiType) {
    case "openai":
      headers["Authorization"] = `Bearer ${apiKey}`;
      break;
    case "anthropic":
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      break;
    case "gemini":
      headers["x-goog-api-key"] = apiKey;
      break;
  }

  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }

  return headers;
}

/**
 * Proxy a request to upstream with optional proxy support
 */
export async function proxyRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
  proxy?: string | null
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT);

  // Use channel proxy, fall back to global proxy
  const effectiveProxy = proxy || GLOBAL_PROXY;

  try {
    if (effectiveProxy) {
    }

    const response = await proxyFetch(
      url,
      {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      },
      effectiveProxy
    );

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout after ${PROXY_TIMEOUT}ms`);
    }
    throw error;
  }
}

/**
 * Stream response from upstream endpoint
 * Supports:
 * - OpenAI/Anthropic SSE format (text/event-stream)
 * - Gemini JSON array streaming (application/json)
 * - OpenAI Responses API SSE format (event: + data:)
 */
export function streamResponse(upstream: Response): Response {
  const reader = upstream.body?.getReader();

  if (!reader) {
    return new Response("Upstream response has no body", { status: 502 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }
          controller.enqueue(value);
        }
      } catch (error) {
        // Upstream closed mid-stream — close gracefully so partial data still reaches the client
        try {
          controller.close();
        } catch {
          // controller already closed or errored, nothing to do
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  // Preserve the upstream Content-Type - important for different streaming formats:
  // - text/event-stream: OpenAI Chat Completions, Anthropic Messages, OpenAI Responses API
  // - application/json: Gemini streamGenerateContent
  const contentType = upstream.headers.get("Content-Type");

  return new Response(stream, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType || "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Preserve transfer encoding for proper chunked streaming
      ...(upstream.headers.get("Transfer-Encoding") && {
        "Transfer-Encoding": upstream.headers.get("Transfer-Encoding")!,
      }),
    },
  });
}

/**
 * Create error response in JSON format
 */
export function errorResponse(message: string, status: number = 400): NextResponse {
  return NextResponse.json(
    {
      error: {
        message,
        type: "proxy_error",
      },
    },
    { status }
  );
}

/**
 * Normalize base URL - remove trailing slash and /v1 suffix
 */
export function normalizeBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1")) {
    normalized = normalized.slice(0, -3);
  }
  return normalized;
}
