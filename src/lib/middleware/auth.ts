// Authentication middleware for API routes

import { NextRequest, NextResponse } from "next/server";
import { extractToken, verifyToken } from "@/lib/auth";

/**
 * Middleware to verify admin authentication
 * Returns null if authenticated, or an error response if not
 */
export function requireAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get("Authorization");
  const token = extractToken(authHeader);

  if (!token) {
    return NextResponse.json(
      { error: "Authentication required", code: "AUTH_REQUIRED" },
      { status: 401 }
    );
  }

  const payload = verifyToken(token);

  if (!payload) {
    return NextResponse.json(
      { error: "Invalid or expired token", code: "INVALID_TOKEN" },
      { status: 401 }
    );
  }

  return null; // Authenticated successfully
}

/**
 * Check if request is authenticated (non-blocking)
 */
export function isAuthenticated(request: NextRequest): boolean {
  const authHeader = request.headers.get("Authorization");
  const token = extractToken(authHeader);

  if (!token) {
    return false;
  }

  const payload = verifyToken(token);
  return payload !== null;
}
