// GET /api/version - Version check endpoint
// Public: returns current version
// Authenticated: also returns remote latest version and update availability

import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/middleware/auth";

const GITHUB_RAW_URL =
  "https://raw.githubusercontent.com/chxcodepro/model-check/master/package.json";

// Cache remote version check result (1 hour)
let cachedRemoteVersion: { version: string; checkedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Simple semver comparison: returns true if remote > local
 * Supports x.y.z format
 */
function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.split(".").map(Number);
  const l = local.split(".").map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

async function fetchRemoteVersion(): Promise<string | null> {
  // Return cached result if still fresh
  if (cachedRemoteVersion && Date.now() - cachedRemoteVersion.checkedAt < CACHE_TTL_MS) {
    return cachedRemoteVersion.version;
  }

  try {
    const response = await fetch(GITHUB_RAW_URL, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return cachedRemoteVersion?.version ?? null;

    const pkg = await response.json();
    const version = pkg.version as string;

    cachedRemoteVersion = { version, checkedAt: Date.now() };
    return version;
  } catch {
    // Network error, return stale cache if available
    return cachedRemoteVersion?.version ?? null;
  }
}

export async function GET(request: NextRequest) {
  const currentVersion = process.env.APP_VERSION || "unknown";
  const authenticated = isAuthenticated(request);

  // Public response: only current version
  if (!authenticated) {
    return NextResponse.json({ current: currentVersion });
  }

  // Authenticated: check for updates
  const remoteVersion = await fetchRemoteVersion();

  const hasUpdate = remoteVersion ? isNewerVersion(remoteVersion, currentVersion) : false;

  return NextResponse.json({
    current: currentVersion,
    latest: remoteVersion,
    hasUpdate,
  });
}
