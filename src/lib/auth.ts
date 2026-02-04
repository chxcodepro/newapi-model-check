// JWT Authentication utilities

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "model-check-secret-key";
const JWT_EXPIRES_IN = "7d";

export interface JWTPayload {
  role: "admin";
  iat: number;
  exp: number;
}

/**
 * Verify admin password and generate JWT token
 */
export async function authenticateAdmin(password: string): Promise<string | null> {
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    console.error("[Auth] ADMIN_PASSWORD not configured");
    return null;
  }

  // Support both plain text and bcrypt hashed passwords
  let isValid = false;

  if (adminPassword.startsWith("$2")) {
    // Bcrypt hash
    isValid = await bcrypt.compare(password, adminPassword);
  } else {
    // Plain text comparison
    isValid = password === adminPassword;
  }

  if (!isValid) {
    return null;
  }

  // Generate JWT token
  const token = jwt.sign({ role: "admin" } as Omit<JWTPayload, "iat" | "exp">, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

  return token;
}

/**
 * Verify JWT token and return payload
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return authHeader;
}

/**
 * Hash password with bcrypt (utility for setup)
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}
