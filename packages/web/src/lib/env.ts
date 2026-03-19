// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Type-safe environment variable access for the web package.
 *
 * All env vars used by the frontend are NEXT_PUBLIC_ prefixed so they
 * are embedded in the client bundle at build time.
 */

/**
 * The backend API URL. When empty, the Next.js rewrite proxy is used
 * in development (routes /api/trpc/** to localhost:3001).
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * The Better Auth base URL. When empty, the Next.js rewrite proxy
 * is used in development (routes /api/auth/** to localhost:3001).
 */
export const BETTER_AUTH_URL = process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "";

/**
 * The tRPC endpoint URL for server components (absolute path).
 * In development with rewrites, uses the relative /api/trpc path.
 * In production, uses the absolute backend URL.
 */
export function getTRPCUrl(): string {
  if (API_URL) {
    return `${API_URL}/api/trpc`;
  }
  // In server components we need an absolute URL even in development.
  // Use the loopback address that the backend listens on.
  if (typeof window === "undefined") {
    return "http://localhost:3001/api/trpc";
  }
  return "/api/trpc";
}

/**
 * The Better Auth base URL for the auth client.
 */
export function getAuthBaseURL(): string {
  if (BETTER_AUTH_URL) {
    return BETTER_AUTH_URL;
  }
  if (typeof window === "undefined") {
    return "http://localhost:3001";
  }
  return "";
}
