// Detection Strategy Factory
// Routes requests to correct endpoint based on model name

import { EndpointType } from "@prisma/client";
import type { EndpointDetection } from "./types";

// Default detection prompt
const DETECT_PROMPT = process.env.DETECT_PROMPT || "1+1=2? yes or no";

/**
 * Determine CLI endpoint type based on model name
 * Returns null if the model only supports CHAT
 */
export function detectCliEndpointType(modelName: string): EndpointType | null {
  const name = modelName.toLowerCase();

  if (name.includes("claude")) {
    return EndpointType.CLAUDE;
  }

  if (name.includes("gemini")) {
    return EndpointType.GEMINI;
  }

  // OpenAI Responses API (2025+):
  // - gpt-4o series (gpt-4o, gpt-4o-mini, etc.)
  // - gpt-5 series (gpt-5, gpt-5.1, gpt-5.2, etc.)
  // - o1, o3, o4 reasoning models
  if (
    /gpt-4o/.test(name) ||
    /gpt-5/.test(name) ||
    /^o[134](-|$)/.test(name)
  ) {
    return EndpointType.CODEX;
  }

  // No CLI endpoint for this model
  return null;
}

/**
 * Get all endpoint types to test for a model
 * Always includes CHAT, plus CLI endpoint if applicable
 */
export function getEndpointsToTest(modelName: string): EndpointType[] {
  const endpoints: EndpointType[] = [EndpointType.CHAT];
  const cliEndpoint = detectCliEndpointType(modelName);

  if (cliEndpoint) {
    endpoints.push(cliEndpoint);
  }

  return endpoints;
}

/**
 * Legacy function for backward compatibility
 */
export function detectEndpointType(modelName: string): EndpointType {
  return detectCliEndpointType(modelName) || EndpointType.CHAT;
}

/**
 * Build endpoint detection configuration based on model and endpoint type
 */
export function buildEndpointDetection(
  baseUrl: string,
  apiKey: string,
  modelName: string,
  endpointType: EndpointType
): EndpointDetection {
  // Normalize baseUrl - remove trailing slash and /v1 suffix if present
  let normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  if (normalizedBaseUrl.endsWith("/v1")) {
    normalizedBaseUrl = normalizedBaseUrl.slice(0, -3);
  }

  switch (endpointType) {
    case EndpointType.CLAUDE:
      return buildClaudeEndpoint(normalizedBaseUrl, apiKey, modelName);

    case EndpointType.GEMINI:
      return buildGeminiEndpoint(normalizedBaseUrl, apiKey, modelName);

    case EndpointType.CODEX:
      return buildCodexEndpoint(normalizedBaseUrl, apiKey, modelName);

    case EndpointType.CHAT:
    default:
      return buildChatEndpoint(normalizedBaseUrl, apiKey, modelName);
  }
}

/**
 * Build Claude /v1/messages endpoint
 */
function buildClaudeEndpoint(
  baseUrl: string,
  apiKey: string,
  modelName: string
): EndpointDetection {
  return {
    type: EndpointType.CLAUDE,
    url: `${baseUrl}/v1/messages`,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    requestBody: {
      model: modelName,
      max_tokens: 50,
      stream: false,
      messages: [
        {
          role: "user",
          content: DETECT_PROMPT,
        },
      ],
    },
  };
}

/**
 * Build Gemini generateContent endpoint
 */
function buildGeminiEndpoint(
  baseUrl: string,
  apiKey: string,
  modelName: string
): EndpointDetection {
  return {
    type: EndpointType.GEMINI,
    url: `${baseUrl}/v1beta/models/${modelName}:generateContent`,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    requestBody: {
      contents: [
        {
          parts: [
            {
              text: DETECT_PROMPT,
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 10,
      },
    },
  };
}

/**
 * Build Codex /v1/responses endpoint
 * Uses OpenAI Responses API format (2025)
 * @see https://platform.openai.com/docs/api-reference/responses
 */
function buildCodexEndpoint(
  baseUrl: string,
  apiKey: string,
  modelName: string
): EndpointDetection {
  return {
    type: EndpointType.CODEX,
    url: `${baseUrl}/v1/responses`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    requestBody: {
      model: modelName,
      stream: false,
      // Responses API input format: array of message objects
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: DETECT_PROMPT,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Build standard OpenAI /v1/chat/completions endpoint
 */
function buildChatEndpoint(
  baseUrl: string,
  apiKey: string,
  modelName: string
): EndpointDetection {
  return {
    type: EndpointType.CHAT,
    url: `${baseUrl}/v1/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    requestBody: {
      model: modelName,
      max_tokens: 50,
      stream: false,
      messages: [
        {
          role: "user",
          content: DETECT_PROMPT,
        },
      ],
    },
  };
}

/**
 * Parse model list from /v1/models response
 */
export function parseModelsResponse(data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return [];
  }

  const response = data as { data?: unknown[] };
  if (!Array.isArray(response.data)) {
    return [];
  }

  return response.data
    .filter((item): item is { id: string } =>
      item !== null && typeof item === "object" && "id" in item && typeof item.id === "string"
    )
    .map((item) => item.id);
}
