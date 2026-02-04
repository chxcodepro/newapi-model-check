// WebDAV Sync API - Sync channels to/from WebDAV server

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/middleware/auth";
import { syncChannelModels } from "@/lib/queue/service";
import type { ChannelExportData } from "../export/route";

// Environment variables for WebDAV configuration
const ENV_WEBDAV_URL = process.env.WEBDAV_URL;
const ENV_WEBDAV_USERNAME = process.env.WEBDAV_USERNAME;
const ENV_WEBDAV_PASSWORD = process.env.WEBDAV_PASSWORD;
const ENV_WEBDAV_FILENAME = process.env.WEBDAV_FILENAME;

interface WebDAVConfig {
  url: string;
  username?: string;
  password?: string;
  filename?: string;
}

// Helper function to build WebDAV headers
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

// Helper function to build full WebDAV URL
function buildWebDAVUrl(config: WebDAVConfig): string {
  let url = config.url.replace(/\/$/, "");
  const filename = config.filename || "channels.json";
  if (!url.endsWith(filename)) {
    url = `${url}/${filename}`;
  }
  return url;
}

// Helper function to ensure parent directories exist
// baseUrl: the WebDAV base URL (e.g., https://dav.jianguoyun.com/dav)
// filename: the filename which may contain subdirectories (e.g., "subdir/file.json")
async function ensureParentDirectories(baseUrl: string, filename: string, headers: HeadersInit): Promise<void> {
  // Extract subdirectory path from filename (e.g., "subdir/file.json" -> ["subdir"])
  const filenameParts = filename.split("/").filter(Boolean);

  // Remove the actual filename, keeping only directory parts
  filenameParts.pop();

  if (filenameParts.length === 0) {
    return; // No subdirectories in filename, nothing to create
  }

  // Normalize base URL (remove trailing slash)
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  // Create each subdirectory level under the base URL
  let currentPath = normalizedBaseUrl;
  for (const part of filenameParts) {
    currentPath += "/" + part;
    // Ensure directory URL ends with / for MKCOL
    const dirUrl = currentPath.endsWith("/") ? currentPath : currentPath + "/";

    try {
      // Try to create directory with MKCOL
      const response = await fetch(dirUrl, {
        method: "MKCOL",
        headers: {
          ...headers,
          "Content-Type": "application/xml", // Some WebDAV servers require this for MKCOL
        },
      });

      // 201 = Created, 405 = Already exists (Method Not Allowed)
      // 301/302 = Redirect (坚果云 already exists)
      // 409 = Conflict (坚果云 already exists or parent missing)
      if (response.ok || response.status === 201 || response.status === 405 ||
          response.status === 301 || response.status === 302 || response.status === 409) {
        console.log(`[WebDAV] Directory ensured: ${part} (status: ${response.status})`);
      } else if (response.status === 401) {
        throw new Error(`WebDAV authentication failed: invalid credentials`);
      } else if (response.status === 403) {
        // 403 on MKCOL usually means directory already exists or is the root sync folder
        // Try to continue - the actual PUT will fail if there's a real permission issue
        console.log(`[WebDAV] MKCOL returned 403 for ${part}, assuming directory exists`);
      } else {
        console.log(`[WebDAV] MKCOL returned ${response.status} for ${part}, continuing...`);
      }
    } catch (error) {
      // Network errors should be logged but not thrown - let PUT fail with clearer error
      console.log(`[WebDAV] MKCOL error for ${part}: ${error}`);
    }
  }
}

// GET /api/channel/webdav - Get WebDAV config status
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  // Return config status (masked for security)
  return NextResponse.json({
    configured: !!(ENV_WEBDAV_URL && ENV_WEBDAV_USERNAME && ENV_WEBDAV_PASSWORD),
    url: ENV_WEBDAV_URL || "",
    username: ENV_WEBDAV_USERNAME || "",
    hasPassword: !!ENV_WEBDAV_PASSWORD,
    filename: ENV_WEBDAV_FILENAME || "channels.json",
  });
}

// POST /api/channel/webdav - Sync with WebDAV
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action, url, username, password, filename, mode = "merge" } = body as {
      action: "upload" | "download";
      url?: string;
      username?: string;
      password?: string;
      filename?: string;
      mode?: "merge" | "replace";
    };

    // Use environment variables as fallback (empty string also falls back to env)
    const finalUrl = url || ENV_WEBDAV_URL;
    const finalUsername = username || ENV_WEBDAV_USERNAME;
    const finalPassword = password || ENV_WEBDAV_PASSWORD;
    const finalFilename = filename || ENV_WEBDAV_FILENAME;

    // Debug logging (remove in production)
    console.log("[WebDAV] Config resolution:", {
      urlSource: url ? "request" : "env",
      usernameSource: username ? "request" : "env",
      passwordSource: password ? "request" : "env",
      filenameSource: filename ? "request" : "env",
      hasPassword: !!finalPassword,
      envPasswordSet: !!ENV_WEBDAV_PASSWORD,
    });

    if (!action || !finalUrl) {
      return NextResponse.json(
        { error: "Action and URL are required (set WEBDAV_URL env or provide in request)", code: "MISSING_FIELDS" },
        { status: 400 }
      );
    }

    const config: WebDAVConfig = {
      url: finalUrl,
      username: finalUsername,
      password: finalPassword,
      filename: finalFilename
    };
    const webdavUrl = buildWebDAVUrl(config);
    const headers = buildWebDAVHeaders(config);

    if (action === "upload") {
      // Export channels and upload to WebDAV
      const channels = await prisma.channel.findMany({
        select: {
          name: true,
          baseUrl: true,
          apiKey: true,
          proxy: true,
          enabled: true,
        },
        orderBy: { createdAt: "asc" },
      });

      // Also export scheduler config and proxy keys
      const schedulerConfig = await prisma.schedulerConfig.findUnique({
        where: { id: "default" },
      });

      const proxyKeys = await prisma.proxyKey.findMany({
        select: {
          name: true,
          enabled: true,
          allowAllModels: true,
          allowedChannelIds: true,
          allowedModelIds: true,
        },
      });

      // Build local export data
      const localChannels = channels.map((ch) => ({
        name: ch.name,
        baseUrl: ch.baseUrl.replace(/\/$/, ""),
        apiKey: ch.apiKey,
        proxy: ch.proxy,
        enabled: ch.enabled,
      }));

      let finalChannels = localChannels;
      let merged = 0;
      let replaced = 0;

      // If merge mode, first download existing data and merge
      if (mode === "merge") {
        try {
          const downloadResponse = await fetch(webdavUrl, {
            method: "GET",
            headers,
          });

          if (downloadResponse.ok) {
            const remoteData = await downloadResponse.json() as {
              channels?: Array<{
                name: string;
                baseUrl: string;
                apiKey: string;
                proxy?: string | null;
                enabled?: boolean;
              }>;
            };

            if (remoteData.channels && Array.isArray(remoteData.channels)) {
              // Build set of local channels by baseUrl+apiKey for deduplication
              const localKeySet = new Set(
                localChannels.map((ch) => `${ch.baseUrl}|${ch.apiKey}`)
              );

              // Add remote channels that don't exist locally (by baseUrl+apiKey)
              for (const remoteCh of remoteData.channels) {
                if (!remoteCh.name || !remoteCh.baseUrl || !remoteCh.apiKey) {
                  continue;
                }
                const remoteKey = `${remoteCh.baseUrl.replace(/\/$/, "")}|${remoteCh.apiKey}`;

                if (!localKeySet.has(remoteKey)) {
                  finalChannels.push({
                    name: remoteCh.name,
                    baseUrl: remoteCh.baseUrl.replace(/\/$/, ""),
                    apiKey: remoteCh.apiKey,
                    proxy: remoteCh.proxy || null,
                    enabled: remoteCh.enabled ?? true,
                  });
                  merged++;
                }
              }
            }
          }
          // If 404 or other error, just upload local data (no remote to merge)
        } catch {
          // Network error - proceed with local data only
          console.log("[WebDAV] No remote data to merge, uploading local data only");
        }
      } else {
        replaced = 1; // Flag that we're replacing
      }

      const exportData = {
        version: "2.0",
        exportedAt: new Date().toISOString(),
        channels: finalChannels,
        schedulerConfig: schedulerConfig ? {
          enabled: schedulerConfig.enabled,
          cronSchedule: schedulerConfig.cronSchedule,
          timezone: schedulerConfig.timezone,
          channelConcurrency: schedulerConfig.channelConcurrency,
          maxGlobalConcurrency: schedulerConfig.maxGlobalConcurrency,
          minDelayMs: schedulerConfig.minDelayMs,
          maxDelayMs: schedulerConfig.maxDelayMs,
          detectAllChannels: schedulerConfig.detectAllChannels,
          selectedChannelIds: schedulerConfig.selectedChannelIds,
          selectedModelIds: schedulerConfig.selectedModelIds,
        } : undefined,
        proxyKeys: proxyKeys.map((pk) => ({
          name: pk.name,
          enabled: pk.enabled,
          allowAllModels: pk.allowAllModels,
          allowedChannelIds: pk.allowedChannelIds,
          allowedModelIds: pk.allowedModelIds,
        })),
      };

      // Ensure parent directories exist before uploading
      // Pass base URL and filename separately so MKCOL only creates subdirs in filename
      await ensureParentDirectories(finalUrl, finalFilename || "channels.json", headers);

      const response = await fetch(webdavUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify(exportData, null, 2),
      });

      if (!response.ok && response.status !== 201 && response.status !== 204) {
        const text = await response.text().catch(() => "");
        throw new Error(`WebDAV upload failed: ${response.status} ${response.statusText} ${text}`);
      }

      return NextResponse.json({
        success: true,
        action: "upload",
        mode,
        localCount: localChannels.length,
        mergedFromRemote: merged,
        totalUploaded: finalChannels.length,
        replaced: replaced === 1,
        url: webdavUrl,
      });
    } else if (action === "download") {
      // Download from WebDAV and import channels
      const response = await fetch(webdavUrl, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        if (response.status === 404) {
          return NextResponse.json(
            { error: "Remote file not found", code: "NOT_FOUND" },
            { status: 404 }
          );
        }
        throw new Error(`WebDAV download failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as ChannelExportData & {
        schedulerConfig?: Record<string, unknown>;
        proxyKeys?: Array<Record<string, unknown>>;
      };

      if (!data.channels || !Array.isArray(data.channels)) {
        return NextResponse.json(
          { error: "Invalid remote data format", code: "INVALID_DATA" },
          { status: 400 }
        );
      }

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      let duplicates = 0;
      const importedChannelIds: string[] = [];

      // Validate all channels before any database changes
      const validChannels: Array<{
        name: string;
        baseUrl: string;
        apiKey: string;
        proxy?: string | null;
        enabled?: boolean;
      }> = [];

      for (const ch of data.channels) {
        if (!ch.name || !ch.baseUrl || !ch.apiKey) {
          skipped++;
          continue;
        }
        validChannels.push({
          name: ch.name,
          baseUrl: ch.baseUrl.replace(/\/$/, ""),
          apiKey: ch.apiKey,
          proxy: ch.proxy || null,
          enabled: ch.enabled ?? true,
        });
      }

      // If replace mode, use transaction to ensure atomicity
      if (mode === "replace") {
        // Perform delete and insert in a transaction
        await prisma.$transaction(async (tx) => {
          await tx.channel.deleteMany({});

          // Track duplicates within import data
          const importKeySet = new Set<string>();

          for (const ch of validChannels) {
            const channelKey = `${ch.baseUrl}|${ch.apiKey}`;

            if (importKeySet.has(channelKey)) {
              duplicates++;
              continue;
            }
            importKeySet.add(channelKey);

            const newChannel = await tx.channel.create({
              data: {
                name: ch.name,
                baseUrl: ch.baseUrl,
                apiKey: ch.apiKey,
                proxy: ch.proxy,
                enabled: ch.enabled,
              },
            });
            importedChannelIds.push(newChannel.id);
            imported++;
          }
        });
      } else {
        // Merge mode - add new channels, skip if baseUrl+apiKey already exists
        // Build set of existing channels by baseUrl+apiKey for duplicate detection
        const existingChannels = await prisma.channel.findMany({
          select: { id: true, name: true, baseUrl: true, apiKey: true },
        });
        const existingKeySet = new Set(
          existingChannels.map((ch) => `${ch.baseUrl.replace(/\/$/, "")}|${ch.apiKey}`)
        );
        const existingNameSet = new Set(
          existingChannels.map((ch) => ch.name)
        );

        // Also track duplicates within the import data itself
        const importKeySet = new Set<string>();
        const importNameSet = new Set<string>();

        // Helper function to generate unique name
        const generateUniqueName = (baseName: string): string => {
          let name = baseName;
          let suffix = 1;
          while (existingNameSet.has(name) || importNameSet.has(name)) {
            name = `${baseName}_${suffix}`;
            suffix++;
          }
          return name;
        };

        for (const ch of validChannels) {
          const channelKey = `${ch.baseUrl}|${ch.apiKey}`;

          // Check for duplicate within import data (by baseUrl+apiKey)
          if (importKeySet.has(channelKey)) {
            duplicates++;
            continue;
          }
          importKeySet.add(channelKey);

          // Check for duplicate with existing channels (by baseUrl+apiKey)
          // If same baseUrl+apiKey exists, skip entirely (true duplicate)
          if (existingKeySet.has(channelKey)) {
            duplicates++;
            continue;
          }

          // Generate unique name if name already exists
          // (same name but different apiKey = create new channel with unique name)
          const finalName = generateUniqueName(ch.name);
          importNameSet.add(finalName);

          // Always create new channel in merge mode
          const newChannel = await prisma.channel.create({
            data: {
              name: finalName,
              baseUrl: ch.baseUrl,
              apiKey: ch.apiKey,
              proxy: ch.proxy,
              enabled: ch.enabled,
            },
          });
          importedChannelIds.push(newChannel.id);
          imported++;
        }
      }

      // Auto-sync models for imported channels
      let syncedModels = 0;
      if (importedChannelIds.length > 0) {
        const CONCURRENCY = 3;
        for (let i = 0; i < importedChannelIds.length; i += CONCURRENCY) {
          const batch = importedChannelIds.slice(i, i + CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map((channelId) => syncChannelModels(channelId))
          );

          for (const result of results) {
            if (result.status === "fulfilled") {
              syncedModels += result.value.added;
            }
          }
        }
      }

      // Import scheduler config if present
      let schedulerConfigRestored = false;
      if (data.schedulerConfig) {
        try {
          await prisma.schedulerConfig.upsert({
            where: { id: "default" },
            update: {
              enabled: data.schedulerConfig.enabled as boolean ?? true,
              cronSchedule: data.schedulerConfig.cronSchedule as string ?? "0 0,8,12,16,20 * * *",
              timezone: data.schedulerConfig.timezone as string ?? "Asia/Shanghai",
              channelConcurrency: data.schedulerConfig.channelConcurrency as number ?? 5,
              maxGlobalConcurrency: data.schedulerConfig.maxGlobalConcurrency as number ?? 30,
              minDelayMs: data.schedulerConfig.minDelayMs as number ?? 3000,
              maxDelayMs: data.schedulerConfig.maxDelayMs as number ?? 5000,
              detectAllChannels: data.schedulerConfig.detectAllChannels as boolean ?? true,
              selectedChannelIds: data.schedulerConfig.selectedChannelIds as string[] ?? null,
              selectedModelIds: data.schedulerConfig.selectedModelIds as Record<string, string[]> ?? null,
            },
            create: {
              id: "default",
              enabled: data.schedulerConfig.enabled as boolean ?? true,
              cronSchedule: data.schedulerConfig.cronSchedule as string ?? "0 0,8,12,16,20 * * *",
              timezone: data.schedulerConfig.timezone as string ?? "Asia/Shanghai",
              channelConcurrency: data.schedulerConfig.channelConcurrency as number ?? 5,
              maxGlobalConcurrency: data.schedulerConfig.maxGlobalConcurrency as number ?? 30,
              minDelayMs: data.schedulerConfig.minDelayMs as number ?? 3000,
              maxDelayMs: data.schedulerConfig.maxDelayMs as number ?? 5000,
              detectAllChannels: data.schedulerConfig.detectAllChannels as boolean ?? true,
              selectedChannelIds: data.schedulerConfig.selectedChannelIds as string[] ?? null,
              selectedModelIds: data.schedulerConfig.selectedModelIds as Record<string, string[]> ?? null,
            },
          });
          schedulerConfigRestored = true;
        } catch (error) {
          console.error("[WebDAV] Failed to restore scheduler config:", error);
        }
      }

      // Import proxy keys if present (config only, no key values for security)
      let proxyKeysRestored = 0;
      if (data.proxyKeys && Array.isArray(data.proxyKeys)) {
        for (const pk of data.proxyKeys) {
          try {
            // Check if key with same name exists
            const existing = await prisma.proxyKey.findFirst({
              where: { name: pk.name as string },
            });

            if (existing) {
              // Update config (not the key value itself)
              await prisma.proxyKey.update({
                where: { id: existing.id },
                data: {
                  enabled: pk.enabled as boolean ?? true,
                  allowAllModels: pk.allowAllModels as boolean ?? true,
                  allowedChannelIds: pk.allowedChannelIds as string[] ?? null,
                  allowedModelIds: pk.allowedModelIds as string[] ?? null,
                },
              });
              proxyKeysRestored++;
            }
            // Don't create new keys from WebDAV (security: keys should be created locally)
          } catch (error) {
            console.error(`[WebDAV] Failed to restore proxy key ${pk.name}:`, error);
          }
        }
      }

      return NextResponse.json({
        success: true,
        action: "download",
        imported,
        updated,
        skipped,
        duplicates,
        total: data.channels.length,
        syncedModels,
        schedulerConfigRestored,
        proxyKeysRestored,
        remoteVersion: data.version,
        remoteExportedAt: data.exportedAt,
      });
    }

    return NextResponse.json(
      { error: "Invalid action", code: "INVALID_ACTION" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[API] WebDAV sync error:", error);
    const message = error instanceof Error ? error.message : "WebDAV sync failed";
    return NextResponse.json(
      { error: message, code: "WEBDAV_ERROR" },
      { status: 500 }
    );
  }
}
