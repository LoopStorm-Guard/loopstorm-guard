// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PostgreSQL connection and Drizzle ORM instance.
 *
 * Uses the `postgres` package (postgresjs) as the Drizzle driver, as
 * recommended for Bun + Supabase PostgreSQL (AD-P3-1).
 *
 * Connection configuration:
 * - `max: 10` — connection pool size appropriate for a Vercel serverless env.
 *   In serverless functions each instance has a short life; the pool is
 *   per-process not per-request, but we keep it small to stay within
 *   Supabase connection limits.
 * - `idle_timeout: 20` — release idle connections after 20s to avoid
 *   exhausting the Supabase connection limit.
 * - `connect_timeout: 10` — fail fast if the DB is unreachable.
 * - `prepare: false` — required for Supabase pgBouncer compatibility.
 *   Supabase uses pgBouncer in transaction mode, which does not support
 *   prepared statements.
 *
 * IMPORTANT: This module must NOT be imported in test files that do not
 * connect to a real database. Tests should create their own db instance
 * using the TEST_DATABASE_URL env var.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.js";
import * as schema from "./schema.js";

// Raw postgres.js connection. Exported for use in Better Auth's drizzleAdapter.
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // Disable prepared statements for pgBouncer transaction mode compatibility.
  prepare: false,
});

// Drizzle ORM instance with full schema for type inference.
export const db = drizzle(sql, { schema });

export type Database = typeof db;
