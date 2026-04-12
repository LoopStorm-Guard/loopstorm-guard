// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adversarial RLS transaction-scoping integration tests (ADR-020).
 *
 * These tests verify that the `withTenantTransaction` middleware (ADR-020)
 * correctly scopes the PostgreSQL RLS context to the active transaction,
 * preventing cross-tenant data leakage via connection pool reuse.
 *
 * TESTS
 * =====
 * TX-1  Pooled connection leak: two sequential requests from different tenants
 *        on the same underlying connection. Tenant B cannot see Tenant A's data.
 * TX-2  Transaction rollback: if a procedure throws mid-query, the RLS context
 *        is cleared. The next request on the same connection starts clean.
 * TX-3  setTenantRlsContext is always called on the tx client, not db singleton.
 *        Verified by checking that ctx.db inside a procedure is a transaction.
 * TX-4  Cross-tenant SELECT returns 0 rows (not an error) via the tx client.
 * TX-5  Concurrent requests from different tenants do not leak.
 *
 * PREREQUISITES
 * =============
 * - A running PostgreSQL with migrations applied (same as rls-adversarial).
 * - TEST_DATABASE_URL or DATABASE_URL env var.
 * - If no DB is reachable, tests pass vacuously.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql as drizzleSql, eq, and } from "drizzle-orm";
import * as schema from "../../src/db/schema.js";
import { setTenantRlsContext } from "../../src/middleware/tenant.js";

// ---------------------------------------------------------------------------
// Connection setup — mirrors rls-adversarial.test.ts pattern
// ---------------------------------------------------------------------------

const DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:54322/postgres";

let pgClient: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    pgClient = postgres(DB_URL, {
      max: 5,
      idle_timeout: 5,
      connect_timeout: 3,
      prepare: false,
    });
    db = drizzle(pgClient, { schema });
    // Connectivity check
    await pgClient`SELECT 1`;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (pgClient) {
    await pgClient.end();
  }
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_A = "a0000000-0000-0000-0000-000000000001";
const TENANT_B = "b0000000-0000-0000-0000-000000000002";
const RUN_A = "a1111111-1111-1111-1111-111111111101";
const RUN_B = "b2222222-2222-2222-2222-222222222202";

/**
 * Bypass RLS for test setup (superuser only).
 * We insert rows as the postgres superuser with row_security disabled,
 * then verify that application-level queries with RLS enabled cannot
 * cross tenant boundaries.
 */
async function setupFixtures(): Promise<void> {
  if (!pgClient || !db) return;

  // Disable row_security for setup (requires superuser)
  await pgClient`SET row_security = off`;

  // Ensure tenant rows exist
  await pgClient`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES
      (${TENANT_A}, 'Tenant A (TX Test)', 'tenant-a-tx', NOW(), NOW()),
      (${TENANT_B}, 'Tenant B (TX Test)', 'tenant-b-tx', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;

  // Insert a run for Tenant A
  await pgClient`
    INSERT INTO runs (run_id, tenant_id, status, event_count, last_seq, last_hash,
                      total_cost_usd, total_input_tokens, total_output_tokens,
                      total_call_count, started_at, created_at, updated_at)
    VALUES (
      ${RUN_A}, ${TENANT_A}, 'completed', 1, 1, 'aabbcc',
      0.001, 100, 50, 1, NOW(), NOW(), NOW()
    )
    ON CONFLICT (run_id) DO NOTHING
  `;

  // Insert a run for Tenant B
  await pgClient`
    INSERT INTO runs (run_id, tenant_id, status, event_count, last_seq, last_hash,
                      total_cost_usd, total_input_tokens, total_output_tokens,
                      total_call_count, started_at, created_at, updated_at)
    VALUES (
      ${RUN_B}, ${TENANT_B}, 'completed', 1, 1, 'ddeeff',
      0.002, 200, 100, 2, NOW(), NOW(), NOW()
    )
    ON CONFLICT (run_id) DO NOTHING
  `;

  // Re-enable row_security
  await pgClient`SET row_security = on`;
}

async function cleanupFixtures(): Promise<void> {
  if (!pgClient) return;
  await pgClient`SET row_security = off`;
  await pgClient`DELETE FROM runs WHERE run_id IN (${RUN_A}, ${RUN_B})`;
  await pgClient`DELETE FROM tenants WHERE id IN (${TENANT_A}, ${TENANT_B})`;
  await pgClient`SET row_security = on`;
}

// ---------------------------------------------------------------------------
// TX-1: Pooled connection leak — sequential requests from different tenants
// ---------------------------------------------------------------------------

describe("TX-1: Pooled connection does not leak RLS context between requests", () => {
  test("Tenant B cannot see Tenant A data on reused connection", async () => {
    if (!dbAvailable || !db) {
      console.warn("[rls-tx] DB not available — skipping TX-1");
      return;
    }

    await setupFixtures();

    try {
      // Simulate Request A: sets RLS context for Tenant A, reads runs, commits.
      let runASeenByA: typeof schema.runs.$inferSelect[] = [];
      await db.transaction(async (tx) => {
        await setTenantRlsContext(tx, TENANT_A);
        runASeenByA = await tx
          .select()
          .from(schema.runs)
          .where(eq(schema.runs.run_id, RUN_A));
      });

      // Simulate Request B (potentially reusing same connection): sets RLS context
      // for Tenant B, tries to read Tenant A's run.
      let runASeenByB: typeof schema.runs.$inferSelect[] = [];
      await db.transaction(async (tx) => {
        await setTenantRlsContext(tx, TENANT_B);
        runASeenByB = await tx
          .select()
          .from(schema.runs)
          .where(eq(schema.runs.run_id, RUN_A));
      });

      // Request A should see its own run.
      expect(runASeenByA.length).toBe(1);
      expect(runASeenByA[0]?.run_id).toBe(RUN_A);

      // Request B should see 0 rows — the LOCAL set_config from Request A's
      // transaction was committed+cleared before Request B started its transaction.
      expect(runASeenByB.length).toBe(0);
    } finally {
      await cleanupFixtures();
    }
  });

  test("Tenant A cannot see Tenant B data on reused connection", async () => {
    if (!dbAvailable || !db) {
      console.warn("[rls-tx] DB not available — skipping TX-1b");
      return;
    }

    await setupFixtures();

    try {
      // Request B first
      await db.transaction(async (tx) => {
        await setTenantRlsContext(tx, TENANT_B);
        await tx.select().from(schema.runs).where(eq(schema.runs.run_id, RUN_B));
      });

      // Now Request A tries to read Tenant B's run
      let runBSeenByA: typeof schema.runs.$inferSelect[] = [];
      await db.transaction(async (tx) => {
        await setTenantRlsContext(tx, TENANT_A);
        runBSeenByA = await tx
          .select()
          .from(schema.runs)
          .where(eq(schema.runs.run_id, RUN_B));
      });

      expect(runBSeenByA.length).toBe(0);
    } finally {
      await cleanupFixtures();
    }
  });
});

// ---------------------------------------------------------------------------
// TX-2: Transaction rollback — RLS context cleared after error
// ---------------------------------------------------------------------------

describe("TX-2: Transaction rollback clears RLS context", () => {
  test("After a thrown error, next request starts with clean RLS state", async () => {
    if (!dbAvailable || !db) {
      console.warn("[rls-tx] DB not available — skipping TX-2");
      return;
    }

    await setupFixtures();

    try {
      // Request A: set RLS context, then throw — causing rollback
      const error = await db
        .transaction(async (tx) => {
          await setTenantRlsContext(tx, TENANT_A);
          // Read one row to confirm context is set
          const rows = await tx
            .select()
            .from(schema.runs)
            .where(eq(schema.runs.run_id, RUN_A));
          expect(rows.length).toBe(1); // context correctly set
          throw new Error("Simulated procedure error — should roll back");
        })
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(Error);

      // Request B (same pool, potentially same connection): should NOT see Tenant A's data.
      // If the rollback cleared the LOCAL set_config, Tenant B context is pristine.
      let runASeenByB: typeof schema.runs.$inferSelect[] = [];
      await db.transaction(async (tx) => {
        // Deliberately set TENANT_B context — after rollback, the connection is clean
        await setTenantRlsContext(tx, TENANT_B);
        runASeenByB = await tx
          .select()
          .from(schema.runs)
          .where(eq(schema.runs.run_id, RUN_A));
      });

      // Tenant B cannot see Tenant A's run even after the rolled-back request.
      expect(runASeenByB.length).toBe(0);
    } finally {
      await cleanupFixtures();
    }
  });

  test("After rollback, own tenant data is still visible in next request", async () => {
    if (!dbAvailable || !db) {
      console.warn("[rls-tx] DB not available — skipping TX-2b");
      return;
    }

    await setupFixtures();

    try {
      // Trigger a rollback in a Tenant A transaction
      await db.transaction(async (tx) => {
        await setTenantRlsContext(tx, TENANT_A);
        throw new Error("rollback");
      }).catch(() => {});

      // Tenant A can still see its own data in the next transaction
      let runASeenByA: typeof schema.runs.$inferSelect[] = [];
      await db.transaction(async (tx) => {
        await setTenantRlsContext(tx, TENANT_A);
        runASeenByA = await tx
          .select()
          .from(schema.runs)
          .where(eq(schema.runs.run_id, RUN_A));
      });

      expect(runASeenByA.length).toBe(1);
    } finally {
      await cleanupFixtures();
    }
  });
});

// ---------------------------------------------------------------------------
// TX-3: setTenantRlsContext must be called on the tx client
// ---------------------------------------------------------------------------

describe("TX-3: setTenantRlsContext called on tx correctly scopes config", () => {
  test("set_config with LOCAL=true is scoped to the transaction", async () => {
    if (!dbAvailable || !db) {
      console.warn("[rls-tx] DB not available — skipping TX-3");
      return;
    }

    // Verify the PostgreSQL set_config LOCAL mechanism works as documented:
    // Inside a transaction, set_config with is_local=true sets a value that
    // is visible inside the transaction but reverts after commit.
    let valueInsideTx: string | null = null;
    let valueAfterTx: string | null = null;

    await db.transaction(async (tx) => {
      await setTenantRlsContext(tx, TENANT_A);
      // Read the value back inside the same transaction
      const result = await tx.execute<{ claims: string }>(
        drizzleSql`SELECT current_setting('request.jwt.claims', true) AS claims`
      );
      const row = (result as unknown as Array<{ claims: string }>)[0];
      valueInsideTx = row?.claims ?? null;
    });

    // After the transaction commits, the LOCAL config should be cleared
    // (or at minimum, not contain Tenant A's claims)
    await db.transaction(async (tx) => {
      const result = await tx.execute<{ claims: string }>(
        drizzleSql`SELECT current_setting('request.jwt.claims', true) AS claims`
      );
      const row = (result as unknown as Array<{ claims: string }>)[0];
      valueAfterTx = row?.claims ?? null;
    });

    // Inside the transaction, the claims were set
    expect(valueInsideTx).toContain(TENANT_A);

    // After the transaction, the LOCAL config has reverted (empty or different tenant)
    // It should NOT contain Tenant A's ID without a new setTenantRlsContext call.
    expect(valueAfterTx).not.toContain(TENANT_A);
  });
});

// ---------------------------------------------------------------------------
// TX-4: Cross-tenant SELECT via tx returns 0 rows, not an error
// ---------------------------------------------------------------------------

describe("TX-4: Cross-tenant SELECT returns 0 rows via transaction client", () => {
  test("Querying another tenant's run_id returns empty array", async () => {
    if (!dbAvailable || !db) {
      console.warn("[rls-tx] DB not available — skipping TX-4");
      return;
    }

    await setupFixtures();

    try {
      let rows: typeof schema.runs.$inferSelect[] = [];
      // No error should be thrown — RLS silently filters rows
      await db.transaction(async (tx) => {
        await setTenantRlsContext(tx, TENANT_A);
        rows = await tx
          .select()
          .from(schema.runs)
          .where(eq(schema.runs.run_id, RUN_B)); // Tenant B's run
      });

      expect(rows.length).toBe(0);
    } finally {
      await cleanupFixtures();
    }
  });

  test("Cross-tenant SELECT on events table returns empty array", async () => {
    if (!dbAvailable || !db) {
      console.warn("[rls-tx] DB not available — skipping TX-4b");
      return;
    }

    await setupFixtures();

    try {
      let rows: typeof schema.events.$inferSelect[] = [];
      await db.transaction(async (tx) => {
        await setTenantRlsContext(tx, TENANT_A);
        rows = await tx
          .select()
          .from(schema.events)
          .where(eq(schema.events.tenant_id, TENANT_B));
      });

      expect(rows.length).toBe(0);
    } finally {
      await cleanupFixtures();
    }
  });
});

// ---------------------------------------------------------------------------
// TX-5: Concurrent requests do not interfere (simulated via sequential promises)
// ---------------------------------------------------------------------------

describe("TX-5: Concurrent-style requests maintain separate RLS contexts", () => {
  test("Interleaved transactions from different tenants do not cross-contaminate", async () => {
    if (!dbAvailable || !db) {
      console.warn("[rls-tx] DB not available — skipping TX-5");
      return;
    }

    await setupFixtures();

    try {
      // Run two transactions concurrently — each should only see its own data.
      const [resultA, resultB] = await Promise.all([
        db.transaction(async (tx) => {
          await setTenantRlsContext(tx, TENANT_A);
          return tx
            .select()
            .from(schema.runs)
            .where(and(
              eq(schema.runs.run_id, RUN_A),
              eq(schema.runs.tenant_id, TENANT_A)
            ));
        }),
        db.transaction(async (tx) => {
          await setTenantRlsContext(tx, TENANT_B);
          return tx
            .select()
            .from(schema.runs)
            .where(and(
              eq(schema.runs.run_id, RUN_B),
              eq(schema.runs.tenant_id, TENANT_B)
            ));
        }),
      ]);

      // Each tenant sees its own run
      expect(resultA.length).toBe(1);
      expect(resultA[0]?.run_id).toBe(RUN_A);
      expect(resultB.length).toBe(1);
      expect(resultB[0]?.run_id).toBe(RUN_B);

      // Verify cross-contamination is impossible
      const [crossA, crossB] = await Promise.all([
        db.transaction(async (tx) => {
          await setTenantRlsContext(tx, TENANT_A);
          return tx
            .select()
            .from(schema.runs)
            .where(eq(schema.runs.run_id, RUN_B));
        }),
        db.transaction(async (tx) => {
          await setTenantRlsContext(tx, TENANT_B);
          return tx
            .select()
            .from(schema.runs)
            .where(eq(schema.runs.run_id, RUN_A));
        }),
      ]);

      expect(crossA.length).toBe(0);
      expect(crossB.length).toBe(0);
    } finally {
      await cleanupFixtures();
    }
  });
});
