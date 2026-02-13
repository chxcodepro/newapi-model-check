import type { NextConfig } from "next";

const isWindows = process.platform === "win32";
const forceStandalone = process.env.NEXT_STANDALONE === "true";
const disableStandalone = process.env.NEXT_STANDALONE === "false";

const nextConfig: NextConfig = {
  // Disable x-powered-by header for security
  poweredByHeader: false,
  // Avoid Windows traced-file copy warnings by default.
  ...(forceStandalone || (!isWindows && !disableStandalone)
    ? { output: "standalone" as const }
    : {}),
};

export default nextConfig;
