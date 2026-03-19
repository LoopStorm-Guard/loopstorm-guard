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
 */

import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(), // e.g., "https://api.loopstorm.dev"

  // OAuth (optional — Google OAuth only activates when both vars are present)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

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
      return result.data;
    }
    // Return a stub for test environments that don't need a real DB.
    // Tests that exercise DB functionality must set the real env vars.
    return {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost:5432/loopstorm_test",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key",
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? "test-secret-that-is-at-least-32-chars-long",
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      PORT: Number(process.env.PORT ?? 3001),
      NODE_ENV: "test",
    };
  }

  return envSchema.parse(process.env);
}

export const env = loadEnv();
