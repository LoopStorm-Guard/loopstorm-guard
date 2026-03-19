// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test setup and teardown helpers for LoopStorm Guard backend tests.
 *
 * This file provides database connection management and test fixture helpers
 * for integration tests that require a live PostgreSQL database.
 *
 * IMPORTANT: Integration tests require a running PostgreSQL instance with the
 * LoopStorm schema applied. Unit tests (tests/lib/**) do NOT use this file.
 *
 * Environment variables required for integration tests:
 *   TEST_DATABASE_URL — PostgreSQL connection string for the test database.
 *                       Example: postgres://loopstorm:test@localhost:5432/loopstorm_test
 *   NODE_ENV=test     — Enables test mode in env.ts (relaxed validation).
 *
 * Usage in integration tests:
 * ```typescript
 * import { beforeAll, afterAll, beforeEach } from "bun:test";
 * import {
 *   initTestDb, closeTestDb, cleanTestDb,
 *   createTestTenant, createTestUser,
 * } from "../setup.js";
 *
 * beforeAll(initTestDb);
 * afterAll(closeTestDb);
 * beforeEach(cleanTestDb);
 * ```
 *
 * Database isolation: each test that needs isolation should call
 * `cleanTestDb()` in a beforeEach. This truncates all application tables
 * in the correct FK order.
 *
 * RLS: integration tests connect as the `postgres` superuser to bypass RLS.
 * Tests that exercise RLS must connect with the appropriate application role.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema.js";

// ---------------------------------------------------------------------------
// Test database connection
// ---------------------------------------------------------------------------

let testSql: ReturnType<typeof postgres> | null = null;
let testDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Initialize a test database connection.
 * Call this in `beforeAll`.
 *
 * @throws If TEST_DATABASE_URL is not set
 */
export async function initTestDb(): Promise<void> {
  const url =
    process.env["TEST_DATABASE_URL"] ??
    process.env["DATABASE_URL"] ??
    "postgres://postgres:postgres@localhost:54322/postgres";

  testSql = postgres(url, {
    max: 5,
    idle_timeout: 10,
    connect_timeout: 10,
    prepare: false,
  });

  testDb = drizzle(testSql, { schema });

  // Verify connection
  await testSql`SELECT 1`;
}

/**
 * Close the test database connection.
 * Call this in `afterAll`.
 */
export async function closeTestDb(): Promise<void> {
  if (testSql) {
    await testSql.end();
    testSql = null;
    testDb = null;
  }
}

/**
 * Get the test database instance.
 *
 * @throws If `initTestDb` has not been called
 */
export function getTestDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!testDb) {
    throw new Error(
      "Test database not initialized. Call initTestDb() in beforeAll.",
    );
  }
  return testDb;
}

/**
 * Get the raw postgres.js test connection.
 *
 * @throws If `initTestDb` has not been called
 */
export function getTestSql(): ReturnType<typeof postgres> {
  if (!testSql) {
    throw new Error(
      "Test database not initialized. Call initTestDb() in beforeAll.",
    );
  }
  return testSql;
}

// ---------------------------------------------------------------------------
// Database cleanup
// ---------------------------------------------------------------------------

/**
 * Truncate all application tables in FK-safe order.
 *
 * Call this in `beforeEach` for integration tests that need a clean slate.
 * Uses TRUNCATE ... CASCADE to handle FK constraints.
 *
 * NOTE: This truncates ALL rows from all application tables. Use a dedicated
 * test database — never run this against a production or staging database.
 */
export async function cleanTestDb(): Promise<void> {
  const sql = getTestSql();

  // Truncate in FK-safe order (children before parents).
  // CASCADE handles any remaining FK dependencies.
  await sql`
    TRUNCATE TABLE
      supervisor_escalations,
      supervisor_proposals,
      events,
      runs,
      policy_packs,
      api_keys,
      sessions,
      accounts,
      verifications,
      users,
      tenants
    RESTART IDENTITY CASCADE
  `;
}

// ---------------------------------------------------------------------------
// Test fixture factories
// ---------------------------------------------------------------------------

/**
 * Create a test tenant.
 *
 * @param overrides - Partial tenant fields to override the defaults
 * @returns The created tenant row
 */
export async function createTestTenant(
  overrides: Partial<schema.NewTenant> = {},
): Promise<schema.Tenant> {
  const db = getTestDb();
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      name: overrides.name ?? "Test Tenant",
      slug: overrides.slug ?? `test-tenant-${Date.now()}`,
      plan: overrides.plan ?? "free",
      is_active: overrides.is_active ?? true,
      ...overrides,
    })
    .returning();

  if (!tenant) {
    throw new Error("Failed to create test tenant");
  }

  return tenant;
}

/**
 * Create a test user associated with a tenant.
 *
 * @param tenantId - UUID of the tenant this user belongs to
 * @param overrides - Partial user fields to override the defaults
 * @returns The created user row
 */
export async function createTestUser(
  tenantId: string,
  overrides: Partial<schema.NewUser> = {},
): Promise<schema.User> {
  const db = getTestDb();
  const uniqueId = `user_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const [user] = await db
    .insert(schema.users)
    .values({
      id: overrides.id ?? uniqueId,
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `test-${uniqueId}@example.com`,
      email_verified: overrides.email_verified ?? true,
      tenant_id: tenantId,
      ...overrides,
    })
    .returning();

  if (!user) {
    throw new Error("Failed to create test user");
  }

  return user;
}

/**
 * Create a test run for a given tenant.
 *
 * @param tenantId - UUID of the tenant
 * @param overrides - Partial run fields to override the defaults
 * @returns The created run row
 */
export async function createTestRun(
  tenantId: string,
  overrides: Partial<schema.NewRun> = {},
): Promise<schema.Run> {
  const db = getTestDb();
  // UUID v4 for testing (UUID v7 not strictly required in tests)
  const runId =
    overrides.run_id ??
    `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${randomHex(4)}-${randomHex(12)}`;

  const [run] = await db
    .insert(schema.runs)
    .values({
      run_id: runId,
      tenant_id: tenantId,
      agent_name: overrides.agent_name ?? "test-agent",
      status: overrides.status ?? "started",
      event_count: overrides.event_count ?? 0,
      last_seq: overrides.last_seq ?? 0,
      last_hash: overrides.last_hash ?? null,
      total_cost_usd: overrides.total_cost_usd ?? 0,
      total_input_tokens: overrides.total_input_tokens ?? 0,
      total_output_tokens: overrides.total_output_tokens ?? 0,
      total_call_count: overrides.total_call_count ?? 0,
      ...overrides,
    })
    .returning();

  if (!run) {
    throw new Error("Failed to create test run");
  }

  return run;
}

/**
 * Create a test API key for a tenant.
 *
 * IMPORTANT: This creates an API key with a KNOWN hash. Do not use the
 * returned key_hash as a real key — it is only for DB fixture purposes.
 * The raw key is "lsg_test000000000000000000000001" for key 1, etc.
 *
 * @param tenantId - UUID of the tenant
 * @param userId - ID of the user creating the key
 * @param overrides - Partial API key fields to override the defaults
 * @returns Object with the created row and the raw key
 */
export async function createTestApiKey(
  tenantId: string,
  userId: string,
  overrides: Partial<schema.NewApiKey> = {},
): Promise<{ row: schema.ApiKey; rawKey: string }> {
  const db = getTestDb();
  const { generateApiKey } = await import("../src/lib/api-key-gen.js");
  const { rawKey, keyHash, keyPrefix } = generateApiKey();

  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      tenant_id: tenantId,
      user_id: userId,
      name: overrides.name ?? "Test Key",
      key_prefix: keyPrefix,
      key_hash: keyHash,
      scopes: overrides.scopes ?? ["ingest", "read"],
      is_revoked: overrides.is_revoked ?? false,
      ...overrides,
    })
    .returning();

  if (!row) {
    throw new Error("Failed to create test API key");
  }

  return { row, rawKey };
}

// ---------------------------------------------------------------------------
// RLS test helpers
// ---------------------------------------------------------------------------

/**
 * Set the tenant RLS context on the test database connection.
 *
 * Use this in integration tests to simulate a request from a specific tenant.
 * Must be called within a transaction for the setting to be properly scoped.
 *
 * @param sql - The postgres.js connection to set the context on
 * @param tenantId - UUID of the tenant to simulate
 */
export async function setTestTenantContext(
  sql: ReturnType<typeof postgres>,
  tenantId: string,
): Promise<void> {
  const claims = JSON.stringify({ tenant_id: tenantId });
  await sql`SELECT set_config('request.jwt.claims', ${claims}, true)`;
}

/**
 * Clear the tenant RLS context on the test database connection.
 */
export async function clearTestTenantContext(
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  await sql`SELECT set_config('request.jwt.claims', '', true)`;
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function randomHex(length: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
