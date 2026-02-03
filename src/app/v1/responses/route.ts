// POST /v1/responses - Proxy OpenAI Responses API (2025)
// Supports both streaming and non-streaming responses
// Streaming uses SSE with event types: response.created, response.output_text.delta, response.completed
// Automatically routes to the correct channel based on model name

import { NextRequest, NextResponse } from "next/server";
import {
  findChannelByModel,
  buildUpstreamHeaders,
  proxyRequest,
  streamResponse,
  errorResponse,
  normalizeBaseUrl,
  verifyProxyKey,
} from "@/lib/proxy";

export async function POST(request: NextRequest) {
  // Verify proxy API key
  const authError = verifyProxyKey(request);
  if (authError) return authError;

  try {
    // Parse request body
    const body = await request.json();
    const modelName = body.model;

    if (!modelName) {
      return errorResponse("Missing 'model' field in request body", 400);
    }

    // Find channel by model name (supports "channelName/modelName" format)
    const channel = await findChannelByModel(modelName);
    if (!channel) {
      return errorResponse(`Model not found: ${modelName}`, 404);
    }

    // Use actual model name (without channel prefix) for upstream request
    const upstreamBody = { ...body, model: channel.actualModelName };

    // Responses API supports streaming via 'stream' boolean
    const isStream = body.stream === true;
    const baseUrl = normalizeBaseUrl(channel.baseUrl);
    const url = `${baseUrl}/v1/responses`;
    const headers = buildUpstreamHeaders(channel.apiKey, "openai");

    console.log(`[Proxy] Responses API request for model "${modelName}" -> channel "${channel.channelName}" (upstream model: "${channel.actualModelName}", stream: ${isStream})`);

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
    console.error("[Proxy /v1/responses] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(`Proxy error: ${message}`, 502);
  }
}
