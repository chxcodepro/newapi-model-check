// Proxy-enabled fetch utility
// Supports HTTP/HTTPS proxy (via undici) and SOCKS5 proxy (via socks-proxy-agent)

import { ProxyAgent, fetch as undiciFetch, type RequestInit } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";
import https from "https";
import http from "http";

// Cache proxy agents to avoid creating new ones for each request
const httpProxyAgentCache = new Map<string, ProxyAgent>();
const socksProxyAgentCache = new Map<string, SocksProxyAgent>();
const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks5:", "socks4:"]);

/**
 * Normalize and validate proxy URL.
 * - trims spaces
 * - strips URL fragment (e.g. #note)
 * - maps socks:// and socks5h:// to socks5://
 */
function normalizeProxyUrl(rawProxyUrl: string): string {
  const trimmed = rawProxyUrl.trim();
  if (!trimmed) {
    throw new Error("代理地址不能为空");
  }

  // Allow users to append notes via fragment (#xxx)
  const withoutFragment = trimmed.replace(/#.*$/, "");

  let url: URL;
  try {
    url = new URL(withoutFragment);
  } catch {
    throw new Error("代理地址格式不正确，请使用 http://、https://、socks5://");
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol === "socks:" || protocol === "socks5h:") {
    url.protocol = "socks5:";
  }

  if (!SUPPORTED_PROXY_PROTOCOLS.has(url.protocol.toLowerCase())) {
    throw new Error("不支持的代理协议，请使用 http://、https://、socks5://、socks4://");
  }

  return url.toString();
}

/**
 * Check if a proxy URL is SOCKS proxy
 */
function isSocksProxy(proxyUrl: string): boolean {
  const protocol = new URL(proxyUrl).protocol.toLowerCase();
  return protocol === "socks5:" || protocol === "socks4:";
}

function maskProxyUrl(proxyUrl: string): string {
  try {
    const url = new URL(proxyUrl);
    if (url.password) {
      url.password = "****";
    }
    return url.toString();
  } catch {
    return proxyUrl;
  }
}

function wrapProxyError(error: unknown, proxyUrl: string): Error {
  if (error instanceof Error && error.name === "AbortError") {
    return error;
  }

  const maskedProxy = maskProxyUrl(proxyUrl);
  if (error instanceof Error) {
    const errnoError = error as Error & { code?: string; cause?: { code?: string } };
    const code = errnoError.code || errnoError.cause?.code;
    const message = error.message || "";

    if (code === "ECONNREFUSED") {
      return new Error(`代理连接被拒绝: ${maskedProxy}`);
    }
    if (code === "ENOTFOUND") {
      return new Error(`代理地址无法解析: ${maskedProxy}`);
    }
    if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
      return new Error(`代理连接超时: ${maskedProxy}`);
    }
    if (/auth|authentication|unauthorized|407/i.test(message)) {
      return new Error(`代理认证失败: ${maskedProxy}`);
    }
    return new Error(`代理请求失败: ${message}`);
  }

  return new Error(`代理请求失败: ${maskedProxy}`);
}

/**
 * Get or create a HTTP ProxyAgent for the given proxy URL
 */
function getHttpProxyAgent(proxyUrl: string): ProxyAgent {
  let agent = httpProxyAgentCache.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    httpProxyAgentCache.set(proxyUrl, agent);
  }
  return agent;
}

/**
 * Get or create a SOCKS ProxyAgent for the given proxy URL
 */
function getSocksProxyAgent(proxyUrl: string): SocksProxyAgent {
  let agent = socksProxyAgentCache.get(proxyUrl);
  if (!agent) {
    agent = new SocksProxyAgent(proxyUrl);
    socksProxyAgentCache.set(proxyUrl, agent);
  }
  return agent;
}

/**
 * Fetch using SOCKS proxy with native Node.js http/https
 * Returns a streaming response for real-time data delivery
 */
async function socksFetch(
  url: string | URL,
  options: RequestInit | undefined,
  socksAgent: SocksProxyAgent
): Promise<Response> {
  const urlObj = typeof url === "string" ? new URL(url) : url;
  const isHttps = urlObj.protocol === "https:";
  const httpModule = isHttps ? https : http;

  // Check if already aborted
  const signal = options?.signal as AbortSignal | undefined;
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  return new Promise((resolve, reject) => {
    const reqOptions: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: (options?.method as string) || "GET",
      headers: options?.headers as http.OutgoingHttpHeaders,
      agent: socksAgent,
    };

    const req = httpModule.request(reqOptions, (res) => {
      // Convert Node.js headers to Headers object
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (value) {
          if (Array.isArray(value)) {
            value.forEach((v) => headers.append(key, v));
          } else {
            headers.set(key, value);
          }
        }
      }

      // Create a ReadableStream from the Node.js response for streaming support
      const stream = new ReadableStream({
        start(controller) {
          res.on("data", (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk));
          });
          res.on("end", () => {
            cleanup();
            controller.close();
          });
          res.on("error", (err) => {
            cleanup();
            controller.error(err);
          });
        },
        cancel() {
          res.destroy();
        },
      });

      // Resolve immediately with streaming response
      resolve(
        new Response(stream, {
          status: res.statusCode || 200,
          statusText: res.statusMessage || "",
          headers,
        })
      );
    });

    // Handle abort signal
    const onAbort = () => {
      cleanup();
      req.destroy();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    req.on("error", (err) => {
      cleanup();
      reject(err);
    });

    // Handle request body
    if (options?.body) {
      if (typeof options.body === "string") {
        req.write(options.body);
      } else if (Buffer.isBuffer(options.body)) {
        req.write(options.body);
      }
    }

    req.end();
  });
}

/**
 * Fetch with optional proxy support
 * @param url - The URL to fetch
 * @param options - Fetch options (same as native fetch)
 * @param proxy - Optional proxy URL (e.g., "http://127.0.0.1:7890" or "socks5://127.0.0.1:1080")
 * @returns Response object
 */
export async function proxyFetch(
  url: string | URL,
  options?: RequestInit,
  proxy?: string | null
): Promise<Response> {
  if (proxy) {
    const normalizedProxy = normalizeProxyUrl(proxy);
    try {
      if (isSocksProxy(normalizedProxy)) {
        // Use SOCKS proxy
        const agent = getSocksProxyAgent(normalizedProxy);
        return socksFetch(url, options, agent);
      } else {
        // Use HTTP/HTTPS proxy via undici
        const agent = getHttpProxyAgent(normalizedProxy);
        const response = await undiciFetch(url, {
          ...options,
          dispatcher: agent,
        });
        // Convert undici Response to standard Response for compatibility
        return response as unknown as Response;
      }
    } catch (error) {
      throw wrapProxyError(error, normalizedProxy);
    }
  }

  // No proxy, use native fetch
  return fetch(url.toString(), options as globalThis.RequestInit);
}

