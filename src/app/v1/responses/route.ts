// POST /v1/responses - Proxy OpenAI Responses API (2025)
// Supports both streaming and non-streaming responses
// Streaming uses SSE with event types: response.created, response.output_text.delta, response.completed
// Automatically routes to the correct channel based on model name

import { NextRequest, NextResponse } from "next/server";
import {
  findChannelByModelWithPermission,
  buildUpstreamHeaders,
  proxyRequest,
  streamResponse,
  errorResponse,
  normalizeBaseUrl,
  verifyProxyKeyAsync,
} from "@/lib/proxy";

export async function POST(request: NextRequest) {
  // Verify proxy API key (async for multi-key support)
  const { error: authError, keyResult } = await verifyProxyKeyAsync(request);
  if (authError) return authError;

  try {
    // Parse request body
    const body = await request.json();
    const modelName = body.model;

    if (!modelName) {
      return errorResponse("Missing 'model' field in request body", 400);
    }

    if (typeof modelName !== "string" || modelName.indexOf("/") <= 0 || modelName.endsWith("/")) {
      return errorResponse("Model must use channel prefix format: channelName/modelName", 400);
    }

    // Find channel by model name with permission check (requires "channelName/modelName" format)
    const channel = await findChannelByModelWithPermission(modelName, keyResult!);
    if (!channel) {
      return errorResponse(`Model not found or access denied: ${modelName}`, 404);
    }

    // Use actual model name (without channel prefix) for upstream request
    // Default to stream=true (required by Codex etc.), allow explicit stream=false for compatibility
    const isStream = body.stream !== false;
    const upstreamBody = { ...body, model: channel.actualModelName, stream: isStream };

    const baseUrl = normalizeBaseUrl(channel.baseUrl);
    const url = `${baseUrl}/v1/responses`;
    const headers = buildUpstreamHeaders(channel.apiKey, "openai");

    // Forward request to upstream (with channel proxy support)
    const response = await proxyRequest(url, "POST", headers, upstreamBody, channel.proxy);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return errorResponse(
        `Upstream error: ${response.status} - ${errorText.slice(0, 500)}`,
        response.status
      );
    }

    // Handle streaming response (SSE format with event: + data: lines)
    if (isStream) {
      return streamResponse(response);
    }

    // Handle non-streaming response
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(`Proxy error: ${message}`, 502);
  }
}
