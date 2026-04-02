// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adversarial Row-Level Security (RLS) integration tests.
 *
 * These tests are the authoritative proof that cross-tenant data isolation
 * holds at the PostgreSQL layer — independent of application-level checks.
 *
 * THREAT MODEL
 * ============
 * For each RLS-protected table we verify three classes of threat:
 *
 *   T1 — Cross-tenant SELECT: Tenant A querying data owned by Tenant B.
 *          Expected result: 0 rows returned (never an error).
 *
 *   T2 — Cross-tenant UPDATE/DELETE: Tenant A mutating rows owned by Tenant B.
 *          Expected result: 0 rows affected (command succeeds but touches nothing).
 *
 *   T3 — Cross-tenant INSERT with foreign tenant_id: Tenant A inserting a row
 *          claiming Tenant B's tenant_id.
 *          Expected result: RLS violation error or 0 rows inserted.
 *
 * RLS-protected tables (ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY):
 *   - api_keys
 *   - runs
 *   - events
 *   - supervisor_proposals
 *   - supervisor_escalations
 *   - policy_packs
 *
 * Tables NOT protected by RLS (access controlled at application layer):
 *   - tenants, users, sessions, accounts, verifications
 *
 * HOW RLS IS SET
 * ==============
 * The `current_tenant_id()` function reads `request.jwt.claims` session config.
 * Tests set it via:
 *   SELECT set_config('request.jwt.claims', '{"tenant_id":"<uuid>"}', true)
 * The `true` flag makes the setting LOCAL to the current transaction.
 *
 * FORCE ROW LEVEL SECURITY means even the table owner (postgres superuser in
 * tests) is subject to the policy. This is the critical invariant we exercise.
 *
 * SERVICE-ROLE BEHAVIOUR
 * ======================
 * Supabase's service_role key bypasses RLS because it connects as the postgres
 * superuser and sets `set_config('role', 'service_role', true)`, then relies on
 * Supabase's internal bypass policy. In our schema, we use FORCE ROW LEVEL
 * SECURITY which means the postgres superuser IS subject to our policies.
 * The test database connects as the postgres user (same as the migration role)
 * and we verify that FORCE RLS applies even to that role.
 *
 * PREREQUISITES
 * =============
 * 1. A running PostgreSQL instance with both migrations applied:
 *      drizzle/0001_create_tables.sql
 *      drizzle/0002_enable_rls.sql
 * 2. TEST_DATABASE_URL or DATABASE_URL environment variable set.
 *    Falls back to postgres://postgres:postgres@localhost:54322/postgres.
 *
 * If no database is reachable, tests pass vacuously (no error) so they do not
 * block local unit-test runs. In CI the database is always present.
 *
 * BLOCKING CRITERIA (S3)
 * ======================
 * All assertions must pass before v1.1 ships. Any failure is a P0 security
 * incident. See docs/v1-go-nogo-2026-03-30.md.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TenantRow {
  id: string;
  name: string;
  slug: string;
}

interface RunRow {
  run_id: string;
  tenant_id: string;
}

interface EventRow {
  id: string;
  tenant_id: string;
}

interface ApiKeyRow {
  id: string;
  tenant_id: string;
}

interface ProposalRow {
  id: string;
  tenant_id: string;
}

interface EscalationRow {
  id: string;
  tenant_id: string;
}

interface PolicyPackRow {
  id: string;
  tenant_id: string;
}

// ---------------------------------------------------------------------------
// Database connection management
// ---------------------------------------------------------------------------

/**
 * The test connection connects as the postgres superuser. Because our schema
 * uses FORCE ROW LEVEL SECURITY, this role is STILL subject to RLS policies.
 * This is what we want to test: FORCE RLS means "no bypass, ever".
 */
let sql: ReturnType<typeof postgres>;

/** Whether the database is reachable. Tests pass vacuously when false. */
let dbReachable = false;

beforeAll(async () => {
  const url =
    process.env["TEST_DATABASE_URL"] ??
    process.env["DATABASE_URL"] ??
    "postgres://postgres:postgres@localhost:54322/postgres";

  sql = postgres(url, {
    max: 3,
    idle_timeout: 10,
    connect_timeout: 5,
    prepare: false,
    max_lifetime: 30,
  });

  try {
    await sql`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    await sql.end().catch(() => undefined);
  }
});

afterAll(async () => {
  if (dbReachable) {
    await sql.end();
  }
});

// ---------------------------------------------------------------------------
// Test data state
// ---------------------------------------------------------------------------

let tenantA: TenantRow;
let tenantB: TenantRow;
let sharedUserId: string;
let tenantBRun: RunRow;
let tenantBEvent: EventRow;
let tenantBApiKey: ApiKeyRow;
let tenantBProposal: ProposalRow;
let tenantBEscalation: EscalationRow;
let tenantBPolicyPack: PolicyPackRow;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the database is reachable and the test should proceed.
 * Returns false if not — the caller must return immediately.
 *
 * In CI the database is always reachable (migrations applied before tests).
 * Locally, if no DB is available, tests pass vacuously to avoid blocking
 * developers who have not set up the database stack.
 */
function requireDb(): boolean {
  return dbReachable;
}

/**
 * Execute a callback inside a tenant-scoped transaction.
 *
 * Sets `request.jwt.claims` to the given tenant_id using set_config with the
 * `true` (LOCAL) flag — identical to what the tRPC middleware does per request.
 * The setting is scoped to the transaction and cleaned up on COMMIT/ROLLBACK.
 */
async function withTenantContext<T>(
  tenantId: string,
  fn: (conn: ReturnType<typeof postgres>) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({ tenant_id: tenantId });
  await sql`BEGIN`;
  try {
    await sql`SELECT set_config('request.jwt.claims', ${claims}, true)`;
    const result = await fn(sql);
    await sql`COMMIT`;
    return result;
  } catch (err) {
    await sql`ROLLBACK`;
    throw err;
  }
}

/**
 * Execute a callback inside a transaction with empty JWT claims.
 * current_tenant_id() returns NULL → all RLS policies evaluate to false → 0 rows.
 */
async function withNoTenantContext<T>(
  fn: (conn: ReturnType<typeof postgres>) => Promise<T>,
): Promise<T> {
  await sql`BEGIN`;
  try {
    await sql`SELECT set_config('request.jwt.claims', '', true)`;
    const result = await fn(sql);
    await sql`COMMIT`;
    return result;
  } catch (err) {
    await sql`ROLLBACK`;
    throw err;
  }
}

/**
 * Execute an insert inside a transaction with `SET LOCAL row_security = off`.
 *
 * This is a superuser-only operation (unavailable to application connections)
 * used exclusively in test setup to seed tenant B's data into RLS-protected
 * tables without requiring a tenant context.
 */
async function insertRowBypassingRls<T extends object>(
  insertFn: () => Promise<T>,
): Promise<T> {
  await sql`BEGIN`;
  try {
    await sql`SET LOCAL row_security = off`;
    const result = await insertFn();
    await sql`COMMIT`;
    return result;
  } catch (err) {
    await sql`ROLLBACK`;
    throw err;
  }
}

async function insertTenant(name: string, slug: string): Promise<TenantRow> {
  const rows = await sql<TenantRow[]>`
    INSERT INTO tenants (id, name, slug)
    VALUES (${randomUUID()}, ${name}, ${slug})
    RETURNING id, name, slug
  `;
  const row = rows[0];
  if (!row) throw new Error("Failed to insert tenant");
  return row;
}

async function insertUser(tenantId: string): Promise<string> {
  const id = `usr_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await sql`
    INSERT INTO users (id, name, email, tenant_id, email_verified)
    VALUES (
      ${id},
      'Test User',
      ${"rls-test-" + id + "@example.com"},
      ${tenantId},
      true
    )
  `;
  return id;
}

// ---------------------------------------------------------------------------
// Test fixture setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  if (!dbReachable) return;

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

  tenantA = await insertTenant("Tenant Alpha", `alpha-${Date.now()}`);
  tenantB = await insertTenant("Tenant Beta", `beta-${Date.now()}`);
  sharedUserId = await insertUser(tenantA.id);

  tenantBRun = await insertRowBypassingRls(async () => {
    const rows = await sql<RunRow[]>`
      INSERT INTO runs (run_id, tenant_id, status, event_count, last_seq,
                        total_cost_usd, total_input_tokens, total_output_tokens,
                        total_call_count)
      VALUES (${randomUUID()}, ${tenantB.id}, 'started', 0, 0, 0, 0, 0, 0)
      RETURNING run_id, tenant_id
    `;
    const row = rows[0];
    if (!row) throw new Error("Failed to insert tenantB run");
    return row;
  });

  tenantBEvent = await insertRowBypassingRls(async () => {
    const rows = await sql<EventRow[]>`
      INSERT INTO events (
        id, run_id, tenant_id, schema_version, event_type, seq,
        hash, ts
      ) VALUES (
        ${randomUUID()},
        ${tenantBRun.run_id},
        ${tenantB.id},
        1,
        'run_started',
        1,
        ${"a".repeat(64)},
        NOW()
      )
      RETURNING id, tenant_id
    `;
    const row = rows[0];
    if (!row) throw new Error("Failed to insert tenantB event");
    return row;
  });

  tenantBApiKey = await insertRowBypassingRls(async () => {
    const rows = await sql<ApiKeyRow[]>`
      INSERT INTO api_keys (
        id, tenant_id, user_id, name, key_prefix, key_hash, scopes
      ) VALUES (
        ${randomUUID()},
        ${tenantB.id},
        ${sharedUserId},
        'TenantB Key',
        'lsg_b1b2',
        ${"b".repeat(64)},
        ARRAY['ingest']
      )
      RETURNING id, tenant_id
    `;
    const row = rows[0];
    if (!row) throw new Error("Failed to insert tenantB api_key");
    return row;
  });

  tenantBProposal = await insertRowBypassingRls(async () => {
    const rows = await sql<ProposalRow[]>`
      INSERT INTO supervisor_proposals (
        id, tenant_id, proposal_id, supervisor_run_id,
        proposal_type, rationale, status
      ) VALUES (
        ${randomUUID()},
        ${tenantB.id},
        ${"prop_" + randomUUID().replace(/-/g, "").slice(0, 24)},
        ${"sup_" + randomUUID().replace(/-/g, "").slice(0, 24)},
        'flag_for_review',
        'Test rationale for TenantB',
        'pending'
      )
      RETURNING id, tenant_id
    `;
    const row = rows[0];
    if (!row) throw new Error("Failed to insert tenantB supervisor_proposal");
    return row;
  });

  tenantBEscalation = await insertRowBypassingRls(async () => {
    const rows = await sql<EscalationRow[]>`
      INSERT INTO supervisor_escalations (
        id, tenant_id, escalation_id, supervisor_run_id,
        severity, rationale, status
      ) VALUES (
        ${randomUUID()},
        ${tenantB.id},
        ${"esc_" + randomUUID().replace(/-/g, "").slice(0, 24)},
        ${"sup_" + randomUUID().replace(/-/g, "").slice(0, 24)},
        'high',
        'Test escalation rationale for TenantB',
        'open'
      )
      RETURNING id, tenant_id
    `;
    const row = rows[0];
    if (!row) throw new Error("Failed to insert tenantB supervisor_escalation");
    return row;
  });

  tenantBPolicyPack = await insertRowBypassingRls(async () => {
    const rows = await sql<PolicyPackRow[]>`
      INSERT INTO policy_packs (
        id, tenant_id, name, content, schema_version
      ) VALUES (
        ${randomUUID()},
        ${tenantB.id},
        'TenantB Policy',
        ${{ schema_version: 1, rules: [] }},
        1
      )
      RETURNING id, tenant_id
    `;
    const row = rows[0];
    if (!row) throw new Error("Failed to insert tenantB policy_pack");
    return row;
  });
});

// ---------------------------------------------------------------------------
// Sanity: tenantB can read its own data (verifies setup is correct)
// ---------------------------------------------------------------------------

describe("RLS setup sanity: tenantB reads its own data", () => {
  test("tenantB can read its own run", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantB.id, async () => {
      return sql`SELECT run_id FROM runs WHERE run_id = ${tenantBRun.run_id}`;
    });

    expect(rows).toHaveLength(1);
  });

  test("tenantB can read its own event", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantB.id, async () => {
      return sql`SELECT id FROM events WHERE id = ${tenantBEvent.id}`;
    });

    expect(rows).toHaveLength(1);
  });

  test("tenantB can read its own api_key", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantB.id, async () => {
      return sql`SELECT id FROM api_keys WHERE id = ${tenantBApiKey.id}`;
    });

    expect(rows).toHaveLength(1);
  });

  test("tenantB can read its own supervisor_proposal", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantB.id, async () => {
      return sql`SELECT id FROM supervisor_proposals WHERE id = ${tenantBProposal.id}`;
    });

    expect(rows).toHaveLength(1);
  });

  test("tenantB can read its own supervisor_escalation", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantB.id, async () => {
      return sql`SELECT id FROM supervisor_escalations WHERE id = ${tenantBEscalation.id}`;
    });

    expect(rows).toHaveLength(1);
  });

  test("tenantB can read its own policy_pack", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantB.id, async () => {
      return sql`SELECT id FROM policy_packs WHERE id = ${tenantBPolicyPack.id}`;
    });

    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T1: Cross-tenant SELECT returns 0 rows
// ---------------------------------------------------------------------------

describe("T1 — Cross-tenant SELECT: Tenant A cannot read Tenant B data", () => {
  test("runs: SELECT by primary key returns 0 rows when scoped to tenantA", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql`SELECT run_id FROM runs WHERE run_id = ${tenantBRun.run_id}`;
    });

    expect(rows).toHaveLength(0);
  });

  test("runs: SELECT * returns only tenantA rows, not tenantB rows", async () => {
    if (!requireDb()) return;

    await insertRowBypassingRls(async () => {
      await sql`
        INSERT INTO runs (run_id, tenant_id, status, event_count, last_seq,
                          total_cost_usd, total_input_tokens, total_output_tokens,
                          total_call_count)
        VALUES (${randomUUID()}, ${tenantA.id}, 'started', 0, 0, 0, 0, 0, 0)
      `;
      return {};
    });

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql<{ tenant_id: string }[]>`SELECT tenant_id FROM runs`;
    });

    for (const row of rows) {
      expect(row.tenant_id).toBe(tenantA.id);
    }
    const leakFound = rows.some((r) => r.tenant_id === tenantB.id);
    expect(leakFound).toBe(false);
  });

  test("events: SELECT by primary key returns 0 rows when scoped to tenantA", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql`SELECT id FROM events WHERE id = ${tenantBEvent.id}`;
    });

    expect(rows).toHaveLength(0);
  });

  test("events: SELECT via run_id still returns 0 rows (RLS checks tenant_id, not run_id)", async () => {
    if (!requireDb()) return;

    // Even knowing tenantB's run_id, events are filtered by tenant_id.
    const rows = await withTenantContext(tenantA.id, async () => {
      return sql`SELECT id FROM events WHERE run_id = ${tenantBRun.run_id}`;
    });

    expect(rows).toHaveLength(0);
  });

  test("api_keys: SELECT by primary key returns 0 rows when scoped to tenantA", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql`SELECT id FROM api_keys WHERE id = ${tenantBApiKey.id}`;
    });

    expect(rows).toHaveLength(0);
  });

  test("api_keys: SELECT * returns only tenantA api_keys", async () => {
    if (!requireDb()) return;

    await insertRowBypassingRls(async () => {
      await sql`
        INSERT INTO api_keys (id, tenant_id, user_id, name, key_prefix, key_hash, scopes)
        VALUES (
          ${randomUUID()}, ${tenantA.id}, ${sharedUserId},
          'A Key', 'lsg_a1a2', ${"c".repeat(64)}, ARRAY['ingest']
        )
      `;
      return {};
    });

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql<{ tenant_id: string }[]>`SELECT tenant_id FROM api_keys`;
    });

    for (const row of rows) {
      expect(row.tenant_id).toBe(tenantA.id);
    }
    const leakFound = rows.some((r) => r.tenant_id === tenantB.id);
    expect(leakFound).toBe(false);
  });

  test("supervisor_proposals: SELECT by primary key returns 0 rows when scoped to tenantA", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql`SELECT id FROM supervisor_proposals WHERE id = ${tenantBProposal.id}`;
    });

    expect(rows).toHaveLength(0);
  });

  test("supervisor_proposals: SELECT * returns only tenantA proposals", async () => {
    if (!requireDb()) return;

    await insertRowBypassingRls(async () => {
      await sql`
        INSERT INTO supervisor_proposals (
          id, tenant_id, proposal_id, supervisor_run_id,
          proposal_type, rationale, status
        ) VALUES (
          ${randomUUID()}, ${tenantA.id},
          ${"prop_a" + randomUUID().replace(/-/g, "").slice(0, 22)},
          ${"sup_a" + randomUUID().replace(/-/g, "").slice(0, 22)},
          'flag_for_review', 'TenantA rationale', 'pending'
        )
      `;
      return {};
    });

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql<{ tenant_id: string }[]>`SELECT tenant_id FROM supervisor_proposals`;
    });

    for (const row of rows) {
      expect(row.tenant_id).toBe(tenantA.id);
    }
    const leakFound = rows.some((r) => r.tenant_id === tenantB.id);
    expect(leakFound).toBe(false);
  });

  test("supervisor_escalations: SELECT by primary key returns 0 rows when scoped to tenantA", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql`SELECT id FROM supervisor_escalations WHERE id = ${tenantBEscalation.id}`;
    });

    expect(rows).toHaveLength(0);
  });

  test("supervisor_escalations: SELECT * returns only tenantA escalations", async () => {
    if (!requireDb()) return;

    await insertRowBypassingRls(async () => {
      await sql`
        INSERT INTO supervisor_escalations (
          id, tenant_id, escalation_id, supervisor_run_id,
          severity, rationale, status
        ) VALUES (
          ${randomUUID()}, ${tenantA.id},
          ${"esc_a" + randomUUID().replace(/-/g, "").slice(0, 22)},
          ${"sup_a" + randomUUID().replace(/-/g, "").slice(0, 22)},
          'medium', 'TenantA escalation', 'open'
        )
      `;
      return {};
    });

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql<{ tenant_id: string }[]>`SELECT tenant_id FROM supervisor_escalations`;
    });

    for (const row of rows) {
      expect(row.tenant_id).toBe(tenantA.id);
    }
    const leakFound = rows.some((r) => r.tenant_id === tenantB.id);
    expect(leakFound).toBe(false);
  });

  test("policy_packs: SELECT by primary key returns 0 rows when scoped to tenantA", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql`SELECT id FROM policy_packs WHERE id = ${tenantBPolicyPack.id}`;
    });

    expect(rows).toHaveLength(0);
  });

  test("policy_packs: SELECT * returns only tenantA packs", async () => {
    if (!requireDb()) return;

    await insertRowBypassingRls(async () => {
      await sql`
        INSERT INTO policy_packs (id, tenant_id, name, content, schema_version)
        VALUES (
          ${randomUUID()}, ${tenantA.id},
          'A Policy', ${{ schema_version: 1, rules: [] }}, 1
        )
      `;
      return {};
    });

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql<{ tenant_id: string }[]>`SELECT tenant_id FROM policy_packs`;
    });

    for (const row of rows) {
      expect(row.tenant_id).toBe(tenantA.id);
    }
    const leakFound = rows.some((r) => r.tenant_id === tenantB.id);
    expect(leakFound).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T2: Cross-tenant UPDATE/DELETE affects 0 rows
// ---------------------------------------------------------------------------

describe("T2 — Cross-tenant UPDATE/DELETE: Tenant A cannot mutate Tenant B data", () => {
  test("runs: UPDATE tenantB run while scoped to tenantA affects 0 rows", async () => {
    if (!requireDb()) return;

    await withTenantContext(tenantA.id, async () => {
      await sql`
        UPDATE runs SET status = 'terminated_budget'
        WHERE run_id = ${tenantBRun.run_id}
      `;
    });

    // Verify tenantB's run is unchanged (bypass RLS to read actual state).
    await sql`BEGIN`;
    await sql`SET LOCAL row_security = off`;
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM runs WHERE run_id = ${tenantBRun.run_id}
    `;
    await sql`COMMIT`;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("started");
  });

  test("runs: DELETE tenantB run while scoped to tenantA affects 0 rows", async () => {
    if (!requireDb()) return;

    await withTenantContext(tenantA.id, async () => {
      await sql`DELETE FROM runs WHERE run_id = ${tenantBRun.run_id}`;
    });

    await sql`BEGIN`;
    await sql`SET LOCAL row_security = off`;
    const rows = await sql`SELECT run_id FROM runs WHERE run_id = ${tenantBRun.run_id}`;
    await sql`COMMIT`;

    expect(rows).toHaveLength(1);
  });

  test("events: UPDATE tenantB event while scoped to tenantA affects 0 rows", async () => {
    if (!requireDb()) return;

    await withTenantContext(tenantA.id, async () => {
      await sql`
        UPDATE events SET event_type = 'tampered'
        WHERE id = ${tenantBEvent.id}
      `;
    });

    await sql`BEGIN`;
    await sql`SET LOCAL row_security = off`;
    const rows = await sql<{ event_type: string }[]>`
      SELECT event_type FROM events WHERE id = ${tenantBEvent.id}
    `;
    await sql`COMMIT`;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe("run_started");
  });

  test("events: DELETE tenantB event while scoped to tenantA affects 0 rows", async () => {
    if (!requireDb()) return;

    await withTenantContext(tenantA.id, async () => {
      await sql`DELETE FROM events WHERE id = ${tenantBEvent.id}`;
    });

    await sql`BEGIN`;
    await sql`SET LOCAL row_security = off`;
    const rows = await sql`SELECT id FROM events WHERE id = ${tenantBEvent.id}`;
    await sql`COMMIT`;

    expect(rows).toHaveLength(1);
  });

  test("api_keys: UPDATE tenantB api_key while scoped to tenantA affects 0 rows", async () => {
    if (!requireDb()) return;

    await withTenantContext(tenantA.id, async () => {
      await sql`
        UPDATE api_keys SET is_revoked = true
        WHERE id = ${tenantBApiKey.id}
      `;
    });

    await sql`BEGIN`;
    await sql`SET LOCAL row_security = off`;
    const rows = await sql<{ is_revoked: boolean }[]>`
      SELECT is_revoked FROM api_keys WHERE id = ${tenantBApiKey.id}
    `;
    await sql`COMMIT`;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_revoked).toBe(false);
  });

  test("api_keys: DELETE tenantB api_key while scoped to tenantA affects 0 rows", async () => {
    if (!requireDb()) return;

    await withTenantContext(tenantA.id, async () => {
      await sql`DELETE FROM api_keys WHERE id = ${tenantBApiKey.id}`;
    });

    await sql`BEGIN`;
    await sql`SET LOCAL row_security = off`;
    const rows = await sql`SELECT id FROM api_keys WHERE id = ${tenantBApiKey.id}`;
    await sql`COMMIT`;

    expect(rows).toHaveLength(1);
  });

  test("supervisor_proposals: UPDATE tenantB proposal while scoped to tenantA affects 0 rows", async () => {
    if (!requireDb()) return;

    await withTenantContext(tenantA.id, async () => {
      await sql`
        UPDATE supervisor_proposals SET status = 'approved'
        WHERE id = ${tenantBProposal.id}
      `;
    });

    await sql`BEGIN`;
    await sql`SET LOCAL row_security = off`;
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM supervisor_proposals WHERE id = ${tenantBProposal.id}
    `;
    await sql`COMMIT`;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");
  });

  test("supervisor_escalations: UPDATE tenantB escalation while scoped to tenantA affects 0 rows", async () => {
    if (!requireDb()) return;

    await withTenantContext(tenantA.id, async () => {
      await sql`
        UPDATE supervisor_escalations SET status = 'resolved'
        WHERE id = ${tenantBEscalation.id}
      `;
    });

    await sql`BEGIN`;
    await sql`SET LOCAL row_security = off`;
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM supervisor_escalations WHERE id = ${tenantBEscalation.id}
    `;
    await sql`COMMIT`;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("open");
  });

  test("policy_packs: UPDATE tenantB policy_pack while scoped to tenantA affects 0 rows", async () => {
    if (!requireDb()) return;

    await withTenantContext(tenantA.id, async () => {
      await sql`
        UPDATE policy_packs SET name = 'hacked'
        WHERE id = ${tenantBPolicyPack.id}
      `;
    });

    await sql`BEGIN`;
    await sql`SET LOCAL row_security = off`;
    const rows = await sql<{ name: string }[]>`
      SELECT name FROM policy_packs WHERE id = ${tenantBPolicyPack.id}
    `;
    await sql`COMMIT`;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("TenantB Policy");
  });

  test("policy_packs: DELETE tenantB policy_pack while scoped to tenantA affects 0 rows", async () => {
    if (!requireDb()) return;

    await withTenantContext(tenantA.id, async () => {
      await sql`DELETE FROM policy_packs WHERE id = ${tenantBPolicyPack.id}`;
    });

    await sql`BEGIN`;
    await sql`SET LOCAL row_security = off`;
    const rows = await sql`SELECT id FROM policy_packs WHERE id = ${tenantBPolicyPack.id}`;
    await sql`COMMIT`;

    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T3: Cross-tenant INSERT raises RLS violation or inserts 0 rows
//
// PostgreSQL RLS WITH CHECK semantics: a USING-only policy (no separate WITH
// CHECK clause) applies the USING expression to both reads and writes. On
// INSERT, if the new row's tenant_id does not satisfy current_tenant_id() =
// tenant_id, PostgreSQL raises:
//   ERROR: new row violates row-level security policy for table "..."
//
// We accept either outcome — error OR silent no-op — and verify the row was
// NOT inserted in both cases.
// ---------------------------------------------------------------------------

describe("T3 — Cross-tenant INSERT: Tenant A cannot INSERT rows with Tenant B's tenant_id", () => {
  test("runs: INSERT with tenantB tenant_id raises RLS error or inserts 0 rows", async () => {
    if (!requireDb()) return;

    let insertError: unknown = null;
    try {
      await withTenantContext(tenantA.id, async () => {
        await sql`
          INSERT INTO runs (
            run_id, tenant_id, status, event_count, last_seq,
            total_cost_usd, total_input_tokens, total_output_tokens,
            total_call_count
          ) VALUES (
            ${randomUUID()}, ${tenantB.id},
            'started', 0, 0, 0, 0, 0, 0
          )
        `;
      });
    } catch (err) {
      insertError = err;
    }

    if (insertError !== null) {
      // PostgreSQL raised a row-level security policy violation. Correct.
      const errMsg = String(insertError).toLowerCase();
      expect(errMsg).toMatch(/row.level security|rls|policy/);
    } else {
      // No error: verify the row count for tenantB is still exactly 1 (setup row).
      await sql`BEGIN`;
      await sql`SET LOCAL row_security = off`;
      const rows = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM runs WHERE tenant_id = ${tenantB.id}
      `;
      await sql`COMMIT`;
      expect(rows[0]!.count).toBe(1);
    }
  });

  test("events: INSERT with tenantB tenant_id raises RLS error or inserts 0 rows", async () => {
    if (!requireDb()) return;

    let insertError: unknown = null;
    try {
      await withTenantContext(tenantA.id, async () => {
        await sql`
          INSERT INTO events (
            id, run_id, tenant_id, schema_version, event_type, seq, hash, ts
          ) VALUES (
            ${randomUUID()}, ${tenantBRun.run_id}, ${tenantB.id},
            1, 'run_started', 99, ${"f".repeat(64)}, NOW()
          )
        `;
      });
    } catch (err) {
      insertError = err;
    }

    if (insertError !== null) {
      const errMsg = String(insertError).toLowerCase();
      expect(errMsg).toMatch(/row.level security|rls|policy/);
    } else {
      await sql`BEGIN`;
      await sql`SET LOCAL row_security = off`;
      const rows = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM events WHERE tenant_id = ${tenantB.id}
      `;
      await sql`COMMIT`;
      expect(rows[0]!.count).toBe(1);
    }
  });

  test("api_keys: INSERT with tenantB tenant_id raises RLS error or inserts 0 rows", async () => {
    if (!requireDb()) return;

    let insertError: unknown = null;
    try {
      await withTenantContext(tenantA.id, async () => {
        await sql`
          INSERT INTO api_keys (
            id, tenant_id, user_id, name, key_prefix, key_hash, scopes
          ) VALUES (
            ${randomUUID()}, ${tenantB.id}, ${sharedUserId},
            'Injected Key', 'lsg_x1x2', ${"d".repeat(64)}, ARRAY['ingest']
          )
        `;
      });
    } catch (err) {
      insertError = err;
    }

    if (insertError !== null) {
      const errMsg = String(insertError).toLowerCase();
      expect(errMsg).toMatch(/row.level security|rls|policy/);
    } else {
      await sql`BEGIN`;
      await sql`SET LOCAL row_security = off`;
      const rows = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM api_keys WHERE tenant_id = ${tenantB.id}
      `;
      await sql`COMMIT`;
      expect(rows[0]!.count).toBe(1);
    }
  });

  test("supervisor_proposals: INSERT with tenantB tenant_id raises RLS error or inserts 0 rows", async () => {
    if (!requireDb()) return;

    let insertError: unknown = null;
    try {
      await withTenantContext(tenantA.id, async () => {
        await sql`
          INSERT INTO supervisor_proposals (
            id, tenant_id, proposal_id, supervisor_run_id,
            proposal_type, rationale, status
          ) VALUES (
            ${randomUUID()}, ${tenantB.id},
            ${"prop_x" + randomUUID().replace(/-/g, "").slice(0, 22)},
            ${"sup_x" + randomUUID().replace(/-/g, "").slice(0, 22)},
            'flag_for_review', 'Injected rationale', 'pending'
          )
        `;
      });
    } catch (err) {
      insertError = err;
    }

    if (insertError !== null) {
      const errMsg = String(insertError).toLowerCase();
      expect(errMsg).toMatch(/row.level security|rls|policy/);
    } else {
      await sql`BEGIN`;
      await sql`SET LOCAL row_security = off`;
      const rows = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM supervisor_proposals WHERE tenant_id = ${tenantB.id}
      `;
      await sql`COMMIT`;
      expect(rows[0]!.count).toBe(1);
    }
  });

  test("supervisor_escalations: INSERT with tenantB tenant_id raises RLS error or inserts 0 rows", async () => {
    if (!requireDb()) return;

    let insertError: unknown = null;
    try {
      await withTenantContext(tenantA.id, async () => {
        await sql`
          INSERT INTO supervisor_escalations (
            id, tenant_id, escalation_id, supervisor_run_id,
            severity, rationale, status
          ) VALUES (
            ${randomUUID()}, ${tenantB.id},
            ${"esc_x" + randomUUID().replace(/-/g, "").slice(0, 22)},
            ${"sup_x" + randomUUID().replace(/-/g, "").slice(0, 22)},
            'high', 'Injected escalation', 'open'
          )
        `;
      });
    } catch (err) {
      insertError = err;
    }

    if (insertError !== null) {
      const errMsg = String(insertError).toLowerCase();
      expect(errMsg).toMatch(/row.level security|rls|policy/);
    } else {
      await sql`BEGIN`;
      await sql`SET LOCAL row_security = off`;
      const rows = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM supervisor_escalations WHERE tenant_id = ${tenantB.id}
      `;
      await sql`COMMIT`;
      expect(rows[0]!.count).toBe(1);
    }
  });

  test("policy_packs: INSERT with tenantB tenant_id raises RLS error or inserts 0 rows", async () => {
    if (!requireDb()) return;

    let insertError: unknown = null;
    try {
      await withTenantContext(tenantA.id, async () => {
        await sql`
          INSERT INTO policy_packs (id, tenant_id, name, content, schema_version)
          VALUES (
            ${randomUUID()}, ${tenantB.id},
            'Injected Pack', ${{ schema_version: 1, rules: [] }}, 1
          )
        `;
      });
    } catch (err) {
      insertError = err;
    }

    if (insertError !== null) {
      const errMsg = String(insertError).toLowerCase();
      expect(errMsg).toMatch(/row.level security|rls|policy/);
    } else {
      await sql`BEGIN`;
      await sql`SET LOCAL row_security = off`;
      const rows = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM policy_packs WHERE tenant_id = ${tenantB.id}
      `;
      await sql`COMMIT`;
      expect(rows[0]!.count).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// T4: No tenant context — empty claims returns 0 rows
//
// Simulates a missing or malformed JWT (expired session, auth bypass attempt).
// current_tenant_id() returns NULL when claims are empty.
// NULL != any uuid → all RLS policies evaluate to false → 0 rows.
//
// Defense-in-depth: even if the application layer fails to set tenant context,
// the database returns nothing.
// ---------------------------------------------------------------------------

describe("T4 — No tenant context: empty claims returns 0 rows on all tables", () => {
  test("runs: empty jwt claims returns 0 rows", async () => {
    if (!requireDb()) return;

    const rows = await withNoTenantContext(async () => {
      return sql`SELECT run_id FROM runs`;
    });

    expect(rows).toHaveLength(0);
  });

  test("events: empty jwt claims returns 0 rows", async () => {
    if (!requireDb()) return;

    const rows = await withNoTenantContext(async () => {
      return sql`SELECT id FROM events`;
    });

    expect(rows).toHaveLength(0);
  });

  test("api_keys: empty jwt claims returns 0 rows", async () => {
    if (!requireDb()) return;

    const rows = await withNoTenantContext(async () => {
      return sql`SELECT id FROM api_keys`;
    });

    expect(rows).toHaveLength(0);
  });

  test("supervisor_proposals: empty jwt claims returns 0 rows", async () => {
    if (!requireDb()) return;

    const rows = await withNoTenantContext(async () => {
      return sql`SELECT id FROM supervisor_proposals`;
    });

    expect(rows).toHaveLength(0);
  });

  test("supervisor_escalations: empty jwt claims returns 0 rows", async () => {
    if (!requireDb()) return;

    const rows = await withNoTenantContext(async () => {
      return sql`SELECT id FROM supervisor_escalations`;
    });

    expect(rows).toHaveLength(0);
  });

  test("policy_packs: empty jwt claims returns 0 rows", async () => {
    if (!requireDb()) return;

    const rows = await withNoTenantContext(async () => {
      return sql`SELECT id FROM policy_packs`;
    });

    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T5: FORCE ROW LEVEL SECURITY — superuser without set_config sees 0 rows
//
// Standard PostgreSQL RLS (without FORCE) allows the table owner to bypass
// policies. FORCE ROW LEVEL SECURITY closes this gap.
//
// Without FORCE: postgres superuser → bypass RLS → sees all tenant data.
// With FORCE:    postgres superuser → subject to RLS → sees 0 rows when no
//                claims are set.
//
// This test proves FORCE is configured correctly and hasn't been accidentally
// removed from the migration.
// ---------------------------------------------------------------------------

describe("T5 — FORCE RLS: superuser without set_config sees 0 rows", () => {
  test("runs: superuser without set_config sees 0 rows (FORCE RLS active)", async () => {
    if (!requireDb()) return;

    // Direct query on the connection — no BEGIN, no set_config.
    // Simulates a "raw" database connection with no JWT claims set.
    // With FORCE RLS: current_tenant_id() = NULL → policy = false → 0 rows.
    // Without FORCE RLS: table owner bypasses → all rows visible.
    const rows = await sql`SELECT run_id FROM runs`;

    expect(rows).toHaveLength(0);
  });

  test("events: superuser without set_config sees 0 rows (FORCE RLS active)", async () => {
    if (!requireDb()) return;

    const rows = await sql`SELECT id FROM events`;
    expect(rows).toHaveLength(0);
  });

  test("api_keys: superuser without set_config sees 0 rows (FORCE RLS active)", async () => {
    if (!requireDb()) return;

    const rows = await sql`SELECT id FROM api_keys`;
    expect(rows).toHaveLength(0);
  });

  test("supervisor_proposals: superuser without set_config sees 0 rows (FORCE RLS active)", async () => {
    if (!requireDb()) return;

    const rows = await sql`SELECT id FROM supervisor_proposals`;
    expect(rows).toHaveLength(0);
  });

  test("supervisor_escalations: superuser without set_config sees 0 rows (FORCE RLS active)", async () => {
    if (!requireDb()) return;

    const rows = await sql`SELECT id FROM supervisor_escalations`;
    expect(rows).toHaveLength(0);
  });

  test("policy_packs: superuser without set_config sees 0 rows (FORCE RLS active)", async () => {
    if (!requireDb()) return;

    const rows = await sql`SELECT id FROM policy_packs`;
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T6: Aggregate leakage — COUNT(*) returns 0 with wrong tenant context
//
// A subtle attack: even if SELECT rows returns nothing, a COUNT(*) might
// return the real row count if the query planner evaluates the aggregate
// before the RLS filter. PostgreSQL applies RLS before aggregation, so
// COUNT(*) should also return 0 when tenant context is absent or wrong.
// ---------------------------------------------------------------------------

describe("T6 — Aggregate leakage: COUNT(*) returns 0 with wrong tenant context", () => {
  test("runs: COUNT(*) returns 0 when scoped to tenantA (no tenantA runs exist)", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM runs`;
    });

    // tenantA has no runs; tenantB has 1. If RLS leaks, count would be > 0.
    expect(rows[0]!.count).toBe(0);
  });

  test("events: COUNT(*) returns 0 when scoped to tenantA (no tenantA events exist)", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM events`;
    });

    expect(rows[0]!.count).toBe(0);
  });

  test("api_keys: COUNT(*) returns 0 when scoped to tenantA (no tenantA api_keys exist)", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM api_keys`;
    });

    expect(rows[0]!.count).toBe(0);
  });

  test("supervisor_proposals: COUNT(*) returns 0 when scoped to tenantA", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql<{
        count: number;
      }[]>`SELECT COUNT(*)::int AS count FROM supervisor_proposals`;
    });

    expect(rows[0]!.count).toBe(0);
  });

  test("supervisor_escalations: COUNT(*) returns 0 when scoped to tenantA", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql<{
        count: number;
      }[]>`SELECT COUNT(*)::int AS count FROM supervisor_escalations`;
    });

    expect(rows[0]!.count).toBe(0);
  });

  test("policy_packs: COUNT(*) returns 0 when scoped to tenantA", async () => {
    if (!requireDb()) return;

    const rows = await withTenantContext(tenantA.id, async () => {
      return sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM policy_packs`;
    });

    expect(rows[0]!.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T7: RLS context is transaction-scoped (does not leak between requests)
//
// set_config with the `true` flag makes the setting LOCAL to the current
// transaction. This means the tenant context from one request cannot bleed
// into the next request on the same pooled connection.
//
// This is critical for connection-pooled deployments (Supabase + pgBouncer).
// ---------------------------------------------------------------------------

describe("T7 — Context isolation: RLS context does not leak between transactions", () => {
  test("tenantB context ends at transaction commit; next query sees 0 rows", async () => {
    if (!requireDb()) return;

    // Scope tenantB context to a transaction.
    const insideTxRows = await withTenantContext(tenantB.id, async () => {
      return sql`SELECT run_id FROM runs`;
    });
    expect(insideTxRows).toHaveLength(1); // tenantB sees its own run

    // After the transaction commits, the setting should be gone.
    // A direct query on the connection should see 0 rows.
    const afterTxRows = await sql`SELECT run_id FROM runs`;
    expect(afterTxRows).toHaveLength(0);
  });

  test("sequential tenant contexts do not bleed: tenantA context clears before tenantB query", async () => {
    if (!requireDb()) return;

    // First request scoped to tenantA — has no runs.
    const tenantARows = await withTenantContext(tenantA.id, async () => {
      return sql`SELECT run_id FROM runs`;
    });
    expect(tenantARows).toHaveLength(0);

    // Second request scoped to tenantB — must NOT be contaminated by tenantA context.
    const tenantBRows = await withTenantContext(tenantB.id, async () => {
      return sql`SELECT run_id FROM runs`;
    });
    expect(tenantBRows).toHaveLength(1);
    expect((tenantBRows[0] as RunRow).run_id).toBe(tenantBRun.run_id);
  });
});
