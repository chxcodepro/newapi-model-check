// POST /v1/chat/completions - Proxy OpenAI Chat API
// Supports both streaming and non-streaming responses
// Streaming uses SSE with data: prefix format
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

const CLI_DETECT_PROMPT = process.env.DETECT_PROMPT || "1+1=2? yes or no";

function normalizeMessagesForGeminiCli(messages: unknown): unknown {
  if (!Array.isArray(messages)) {
    return messages;
  }

  return messages.map((message) => {
    if (!message || typeof message !== "object") {
      return message;
    }

    const msg = message as Record<string, unknown>;
    const role = typeof msg.role === "string" ? msg.role : "";

    if (role === "assistant") {
      return msg;
    }

    return {
      ...msg,
      content: CLI_DETECT_PROMPT,
    };
  });
}

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

    // Find channel by model name with permission check (supports "channelName/modelName" format)
    const channel = await findChannelByModelWithPermission(modelName, keyResult!);
    if (!channel) {
      return errorResponse(`Model not found or access denied: ${modelName}`, 404);
    }

    // Use actual model name (without channel prefix) for upstream request
    // Compatibility: normalize Gemini CLI message payloads that may omit content on non-assistant roles
    const upstreamBody = {
      ...body,
      model: channel.actualModelName,
      messages: normalizeMessagesForGeminiCli(body.messages),
    };

    const isStream = body.stream === true;
    const baseUrl = normalizeBaseUrl(channel.baseUrl);
    const url = `${baseUrl}/v1/chat/completions`;
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

    // Handle streaming response (SSE format)
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
