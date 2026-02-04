// WebDAV incremental sync utilities
// Handles append/delete operations for individual channels

interface WebDAVConfig {
  url: string;
  username?: string;
  password?: string;
  filename?: string;
}

interface ChannelData {
  name: string;
  baseUrl: string;
  apiKey: string;
  proxy?: string | null;
  enabled?: boolean;
}

interface WebDAVExportData {
  version: string;
  exportedAt: string;
  channels: ChannelData[];
  schedulerConfig?: Record<string, unknown>;
  proxyKeys?: Array<Record<string, unknown>>;
}

// Get WebDAV config from environment variables
function getWebDAVConfig(): WebDAVConfig | null {
  const url = process.env.WEBDAV_URL;
  if (!url) return null;

  return {
    url,
    username: process.env.WEBDAV_USERNAME,
    password: process.env.WEBDAV_PASSWORD,
    filename: process.env.WEBDAV_FILENAME || "channels.json",
  };
}

// Check if WebDAV is configured
export function isWebDAVConfigured(): boolean {
  return !!process.env.WEBDAV_URL;
}

// Build WebDAV headers with auth
function buildWebDAVHeaders(config: WebDAVConfig): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (config.username && config.password) {
    const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    headers["Authorization"] = `Basic ${auth}`;
  }

  return headers;
}

// Build full WebDAV URL
function buildWebDAVUrl(config: WebDAVConfig): string {
  let url = config.url.replace(/\/$/, "");
  const filename = config.filename || "channels.json";
  if (!url.endsWith(filename)) {
    url = `${url}/${filename}`;
  }
  return url;
}

// Ensure parent directories exist
async function ensureParentDirectories(baseUrl: string, filename: string, headers: HeadersInit): Promise<void> {
  const filenameParts = filename.split("/").filter(Boolean);
  filenameParts.pop();

  if (filenameParts.length === 0) return;

  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  let currentPath = normalizedBaseUrl;

  for (const part of filenameParts) {
    currentPath += "/" + part;
    const dirUrl = currentPath.endsWith("/") ? currentPath : currentPath + "/";

    try {
      await fetch(dirUrl, {
        method: "MKCOL",
        headers: {
          ...headers,
          "Content-Type": "application/xml",
        },
      });
    } catch {
      // Ignore errors, let PUT fail if there's a real issue
    }
  }
}

// Read remote WebDAV data
async function readRemoteData(config: WebDAVConfig): Promise<WebDAVExportData | null> {
  const webdavUrl = buildWebDAVUrl(config);
  const headers = buildWebDAVHeaders(config);

  try {
    const response = await fetch(webdavUrl, {
      method: "GET",
      headers,
    });

    if (response.status === 404) {
      // No remote file yet, return empty structure
      return {
        version: "2.0",
        exportedAt: new Date().toISOString(),
        channels: [],
      };
    }

    if (!response.ok) {
      console.error(`[WebDAV Sync] Failed to read remote: ${response.status}`);
      return null;
    }

    return await response.json() as WebDAVExportData;
  } catch (error) {
    console.error("[WebDAV Sync] Error reading remote:", error);
    return null;
  }
}

// Write data to WebDAV
async function writeRemoteData(config: WebDAVConfig, data: WebDAVExportData): Promise<boolean> {
  const webdavUrl = buildWebDAVUrl(config);
  const headers = buildWebDAVHeaders(config);

  try {
    await ensureParentDirectories(config.url, config.filename || "channels.json", headers);

    const response = await fetch(webdavUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify(data, null, 2),
    });

    if (!response.ok && response.status !== 201 && response.status !== 204) {
      console.error(`[WebDAV Sync] Failed to write remote: ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[WebDAV Sync] Error writing remote:", error);
    return false;
  }
}

/**
 * Append a channel to WebDAV (called after channel creation)
 * Only appends if the channel doesn't already exist (by baseUrl+apiKey)
 */
export async function appendChannelToWebDAV(channel: ChannelData): Promise<void> {
  const config = getWebDAVConfig();
  if (!config) {
    console.log("[WebDAV Sync] Not configured, skipping append");
    return;
  }

  try {
    const remoteData = await readRemoteData(config);
    if (!remoteData) {
      console.error("[WebDAV Sync] Failed to read remote data for append");
      return;
    }

    // Check if channel already exists by baseUrl+apiKey
    const channelKey = `${channel.baseUrl.replace(/\/$/, "")}|${channel.apiKey}`;
    const existingKeys = new Set(
      remoteData.channels.map((ch) => `${ch.baseUrl.replace(/\/$/, "")}|${ch.apiKey}`)
    );

    if (existingKeys.has(channelKey)) {
      console.log("[WebDAV Sync] Channel already exists in remote, skipping append");
      return;
    }

    // Append channel
    remoteData.channels.push({
      name: channel.name,
      baseUrl: channel.baseUrl.replace(/\/$/, ""),
      apiKey: channel.apiKey,
      proxy: channel.proxy || null,
      enabled: channel.enabled ?? true,
    });
    remoteData.exportedAt = new Date().toISOString();

    const success = await writeRemoteData(config, remoteData);
    if (success) {
      console.log(`[WebDAV Sync] Channel "${channel.name}" appended to remote`);
    }
  } catch (error) {
    console.error("[WebDAV Sync] Error appending channel:", error);
  }
}

/**
 * Remove a channel from WebDAV (called after channel deletion)
 * Removes by matching baseUrl+apiKey
 */
export async function removeChannelFromWebDAV(channel: ChannelData): Promise<void> {
  const config = getWebDAVConfig();
  if (!config) {
    console.log("[WebDAV Sync] Not configured, skipping remove");
    return;
  }

  try {
    const remoteData = await readRemoteData(config);
    if (!remoteData) {
      console.error("[WebDAV Sync] Failed to read remote data for remove");
      return;
    }

    // Find and remove channel by baseUrl+apiKey
    const channelKey = `${channel.baseUrl.replace(/\/$/, "")}|${channel.apiKey}`;
    const originalLength = remoteData.channels.length;

    remoteData.channels = remoteData.channels.filter((ch) => {
      const key = `${ch.baseUrl.replace(/\/$/, "")}|${ch.apiKey}`;
      return key !== channelKey;
    });

    if (remoteData.channels.length === originalLength) {
      console.log("[WebDAV Sync] Channel not found in remote, skipping remove");
      return;
    }

    remoteData.exportedAt = new Date().toISOString();

    const success = await writeRemoteData(config, remoteData);
    if (success) {
      console.log(`[WebDAV Sync] Channel "${channel.name}" removed from remote`);
    }
  } catch (error) {
    console.error("[WebDAV Sync] Error removing channel:", error);
  }
}
