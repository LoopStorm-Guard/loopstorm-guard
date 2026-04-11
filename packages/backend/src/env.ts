// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Environment variable validation for LoopStorm Guard API.
 *
 * Uses zod to parse and validate all required environment variables at
 * startup. In test environments, validation is skipped to allow unit tests
 * to run without a full environment setup.
 *
 * Import this module wherever env vars are needed — never read process.env
 * directly in application code.
 *
 * T2 (Wave 2): ALLOWED_ORIGINS is validated here. In production, at least
 * one valid origin URL is required or the server fails to boot immediately.
 * This is a fail-fast guard: a misconfigured CORS policy that silently
 * rejects all browser requests is worse than a startup failure.
 */

import { z } from "zod";

/**
 * Zod schema for a comma-separated list of allowed CORS origins.
 *
 * Format: "https://app.example.com,https://dashboard.example.com"
 * In production (NODE_ENV=production), at least one valid origin is required.
 * In development/test, the variable is optional (defaults to localhost).
 */
const allowedOriginsSchema = z
  .string()
  .optional()
  .transform((val) => {
    if (!val) return [];
    return val
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
  });

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(), // e.g., "https://api.loopstorm.dev"

  // OAuth (optional — Google OAuth only activates when both vars are present)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // CORS — validated as a separate step after NODE_ENV is known (see below).
  // We parse this via allowedOriginsSchema, not inline, because the production
  // requirement depends on NODE_ENV.
  ALLOWED_ORIGINS: allowedOriginsSchema,
});

export type Env = z.infer<typeof envSchema>;

/**
 * Additional production-only validation for ALLOWED_ORIGINS.
 *
 * In production, at least one origin must be configured and each origin must
 * be a valid https:// URL. Failing to configure ALLOWED_ORIGINS in production
 * means all CORS requests are rejected silently, which is worse than a crash.
 *
 * @throws Error if production ALLOWED_ORIGINS is empty or contains invalid URLs
 */
function validateProductionOrigins(origins: string[], nodeEnv: string): void {
  if (nodeEnv !== "production") return;

  if (origins.length === 0) {
    throw new Error(
      "[loopstorm-api] STARTUP FAILED: ALLOWED_ORIGINS is required in production. " +
        "Set it to a comma-separated list of allowed origins, e.g.: " +
        "ALLOWED_ORIGINS=https://app.loopstorm.example,https://dashboard.loopstorm.example. " +
        "Without this, all browser requests will be rejected by CORS."
    );
  }

  const invalidOrigins: string[] = [];
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      // Require explicit protocol (no protocol-relative URLs)
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        invalidOrigins.push(origin);
      }
    } catch {
      invalidOrigins.push(origin);
    }
  }

  if (invalidOrigins.length > 0) {
    throw new Error(
      `[loopstorm-api] STARTUP FAILED: Invalid origins in ALLOWED_ORIGINS: ${invalidOrigins.join(", ")}. ` +
        "Each origin must be a valid URL with an explicit protocol (https:// or http://)."
    );
  }
}

/**
 * Parsed, validated environment variables.
 *
 * In test mode (NODE_ENV=test or BUN_ENV=test), we use safeParse and return
 * a partial object with safe defaults so unit tests can import modules that
 * transitively import env.ts without crashing. Any test that actually needs
 * a database must provide the real env vars.
 */
function loadEnv(): Env {
  const isTest = process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";

  if (isTest) {
    const result = envSchema.safeParse(process.env);
    if (result.success) {
      // Still run production validation — if tests run with NODE_ENV=production
      // (unusual but possible in E2E), the origin check should still fire.
      validateProductionOrigins(result.data.ALLOWED_ORIGINS ?? [], result.data.NODE_ENV);
      return result.data;
    }
    // Return a stub for test environments that don't need a real DB.
    // Tests that exercise DB functionality must set the real env vars.
    return {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost:5432/loopstorm_test",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? "test-secret-that-is-at-least-32-chars-long",
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      PORT: Number(process.env.PORT ?? 3001),
      NODE_ENV: "test",
      ALLOWED_ORIGINS: [], // empty list is fine in test mode
    };
  }

  const parsed = envSchema.parse(process.env);

  // Production-only: fail fast if ALLOWED_ORIGINS is missing or invalid.
  validateProductionOrigins(parsed.ALLOWED_ORIGINS ?? [], parsed.NODE_ENV);

  return parsed;
}

export const env = loadEnv();
