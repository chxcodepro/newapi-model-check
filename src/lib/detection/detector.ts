// Core detector - executes HTTP requests to test model availability

import { CheckStatus, EndpointType } from "@prisma/client";
import { buildEndpointDetection } from "./strategies";
import type { DetectionJobData, DetectionResult } from "./types";
import { proxyFetch } from "@/lib/utils/proxy-fetch";

// Detection timeout in milliseconds
const DETECTION_TIMEOUT = 30000;

// Global proxy from environment
const GLOBAL_PROXY = process.env.GLOBAL_PROXY;

/**
 * Sleep utility for anti-blocking delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Random delay between min and max milliseconds
 */
export function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Strip <think>...</think> blocks from response content
 * Many relay/proxy services embed thinking content in the main response
 */
function stripThinkingBlocks(text: string): string {
  // Remove complete <think>...</think> blocks (including multiline)
  let stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // Remove unclosed <think> block (thinking was truncated)
  stripped = stripped.replace(/<think>[\s\S]*/gi, "").trim();
  // If stripping removed everything, return original (the model only returned thinking)
  return stripped || text;
}

/**
 * Extract response content from API response based on endpoint type
 */
function extractResponseContent(
  responseBody: unknown,
  endpointType: EndpointType
): string | undefined {
  try {
    const body = responseBody as Record<string, unknown>;

    switch (endpointType) {
      case "CHAT": {
        // OpenAI format: response.choices[0].message.content
        const choices = body.choices as {
          message?: {
            content?: string | null;
            reasoning_content?: string;
            refusal?: string;
          };
          delta?: { content?: string | null };
          text?: string;
        }[] | undefined;

        const msg = choices?.[0]?.message;
        if (msg) {
          // 1. Standard content field
          if (typeof msg.content === "string" && msg.content.length > 0) {
            return stripThinkingBlocks(msg.content).slice(0, 500);
          }
          // 2. Reasoning models (DeepSeek R1 etc.) put response in reasoning_content
          if (typeof msg.reasoning_content === "string" && msg.reasoning_content.length > 0) {
            return stripThinkingBlocks(msg.reasoning_content).slice(0, 500);
          }
          // 3. Refusal content
          if (typeof msg.refusal === "string" && msg.refusal.length > 0) {
            return msg.refusal.slice(0, 500);
          }
        }

        // 4. Streaming-style delta response
        const delta = choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          return stripThinkingBlocks(delta.content).slice(0, 500);
        }

        // 5. Legacy completions format
        const text = choices?.[0]?.text;
        if (typeof text === "string" && text.length > 0) {
          return stripThinkingBlocks(text).slice(0, 500);
        }

        break;
      }
      case "CLAUDE": {
        // Claude format: response.content[].text
        // Extended thinking models return: [{type: "thinking", thinking: "..."}, {type: "text", text: "..."}]
        // Normal models return: [{type: "text", text: "..."}]
        const content = body.content as { type?: string; text?: string }[] | undefined;
        if (Array.isArray(content)) {
          // Find the first text block (skip thinking blocks)
          const textBlock = content.find((block) => block.type === "text" && typeof block.text === "string");
          if (textBlock?.text) {
            return textBlock.text.slice(0, 500);
          }
          // Fallback: try first block's text directly (legacy format compatibility)
          const fallbackText = content[0]?.text;
          if (typeof fallbackText === "string") {
            return fallbackText.slice(0, 500);
          }
        }
        break;
      }
      case "GEMINI": {
        // Gemini format: response.candidates[0].content.parts[].text
        // Newer models (2024+) may include thinking field in parts
        const candidates = body.candidates as {
          content?: { parts?: { text?: string; thought?: boolean }[] };
        }[] | undefined;
        const parts = candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          // Find the first non-thought text part
          const textPart = parts.find(
            (p) => typeof p.text === "string" && p.text.length > 0 && !p.thought
          );
          if (textPart?.text) {
            return textPart.text.slice(0, 500);
          }
          // Fallback: return first text part regardless of thought flag
          const fallbackPart = parts.find((p) => typeof p.text === "string" && p.text.length > 0);
          if (fallbackPart?.text) {
            return fallbackPart.text.slice(0, 500);
          }
        }
        break;
      }
      case "CODEX": {
        // Codex/Responses API format (2025):
        // response.output[].content[].text where type is "output_text"
        // or response.output[].text for simple text output
        const output = body.output as {
          type?: string;
          content?: { type?: string; text?: string }[];
          text?: string;
        }[] | undefined;

        if (Array.isArray(output)) {
          for (const item of output) {
            // Type "message" with content array
            if (Array.isArray(item.content)) {
              const textContent = item.content.find(
                (c) => c.type === "output_text" && typeof c.text === "string"
              );
              if (textContent?.text) {
                return textContent.text.slice(0, 500);
              }
            }
            // Simple text field on output item
            if (typeof item.text === "string" && item.text.length > 0) {
              return item.text.slice(0, 500);
            }
          }
        }
        break;
      }
    }
  } catch {
    // Ignore parsing errors
  }

  // Last resort: try to extract something readable from the response
  try {
    const body = responseBody as Record<string, unknown>;

    // Try common alternative fields
    for (const key of ["text", "output", "result", "data", "response", "message", "answer"]) {
      const val = body[key];
      if (typeof val === "string" && val.length > 0) {
        return stripThinkingBlocks(val).slice(0, 500);
      }
    }

    // Try to find the model field to at least confirm the response is valid
    const model = body.model || body.id;
    if (typeof model === "string") {
      return `[response OK, model: ${model}]`;
    }
  } catch {
    // Ignore
  }

  return undefined;
}

/**
 * Execute detection for a single model
 */
export async function executeDetection(job: DetectionJobData): Promise<DetectionResult> {
  const startTime = Date.now();

  // Use channel proxy if specified, otherwise fall back to global proxy
  const proxy = job.proxy || GLOBAL_PROXY;

  // Build endpoint configuration
  const endpoint = buildEndpointDetection(
    job.baseUrl,
    job.apiKey,
    job.modelName,
    job.endpointType
  );

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DETECTION_TIMEOUT);

    // Build fetch options
    const fetchOptions = {
      method: "POST" as const,
      headers: endpoint.headers,
      body: JSON.stringify(endpoint.requestBody),
      signal: controller.signal,
    };

    if (proxy) {
      console.log(`[Detector] Using proxy: ${proxy} for ${job.modelName}`);
    }

    // Use proxyFetch for proxy support
    const response = await proxyFetch(endpoint.url, fetchOptions, proxy);
    clearTimeout(timeoutId);

    const latency = Date.now() - startTime;

    if (response.ok) {
      // Parse response body to extract content
      let responseContent: string | undefined;
      try {
        const responseBody = await response.json();
        responseContent = extractResponseContent(responseBody, job.endpointType);
      } catch {
        // Ignore JSON parsing errors
      }

      return {
        status: CheckStatus.SUCCESS,
        latency,
        statusCode: response.status,
        endpointType: job.endpointType,
        responseContent,
      };
    }

    // Non-OK response
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errorBody = await response.text();
      // Truncate error message if too long
      errorMsg = errorBody.length > 500 ? errorBody.slice(0, 500) + "..." : errorBody;
    } catch {
      // Ignore error body parsing failures
    }

    return {
      status: CheckStatus.FAIL,
      latency,
      statusCode: response.status,
      errorMsg,
      endpointType: job.endpointType,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    let errorMsg = "Unknown error";

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMsg = `Timeout after ${DETECTION_TIMEOUT}ms`;
      } else {
        errorMsg = error.message;
      }
    }

    return {
      status: CheckStatus.FAIL,
      latency,
      errorMsg,
      endpointType: job.endpointType,
    };
  }
}

/**
 * Fetch available models from channel's /v1/models endpoint
 */
export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  proxy?: string | null
): Promise<string[]> {
  // Normalize baseUrl - remove trailing slash and /v1 suffix if present
  let normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  if (normalizedBaseUrl.endsWith("/v1")) {
    normalizedBaseUrl = normalizedBaseUrl.slice(0, -3);
  }

  const url = `${normalizedBaseUrl}/v1/models`;

  const effectiveProxy = proxy || GLOBAL_PROXY;
  if (effectiveProxy) {
    console.log(`[Detector] Using proxy: ${effectiveProxy} for model list`);
  }

  console.log(`[Detector] Fetching models from: ${url}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DETECTION_TIMEOUT);

    const response = await proxyFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    }, effectiveProxy);

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`[Detector] Failed to fetch models: HTTP ${response.status}`, errorText.slice(0, 200));
      return [];
    }

    const data = await response.json();

    // Parse OpenAI-style models response
    if (data && Array.isArray(data.data)) {
      const models = data.data
        .filter((m: unknown): m is { id: string } =>
          m !== null && typeof m === "object" && "id" in m && typeof m.id === "string"
        )
        .map((m: { id: string }) => m.id);

      console.log(`[Detector] Found ${models.length} models`);
      return models;
    }

    console.log("[Detector] No models array in response");
    return [];
  } catch (error) {
    console.error("[Detector] Error fetching models:", error);
    return [];
  }
}
