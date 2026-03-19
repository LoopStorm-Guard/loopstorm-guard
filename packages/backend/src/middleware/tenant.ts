// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tenant RLS context middleware for LoopStorm Guard.
 *
 * Sets the PostgreSQL session variable `request.jwt.claims` so that all
 * RLS policies in the database can read the current tenant ID.
 *
 * RLS policy example (from drizzle/0002_enable_rls.sql):
 *   CREATE POLICY "tenant_isolation" ON runs
 *     USING (
 *       tenant_id = (
 *         current_setting('request.jwt.claims', true)::json->>'tenant_id'
 *       )::uuid
 *     );
 *
 * The `true` flag in `set_config(..., true)` makes the setting LOCAL to the
 * current transaction. If there is no active transaction, it is LOCAL to the
 * current statement. Either way, the setting does not leak to other requests.
 *
 * IMPORTANT: This must be called inside a transaction for the setting to be
 * properly scoped. The tRPC auth middleware calls this before any query.
 * For the ingest endpoint, the ingest handler calls this directly.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * Sets the PostgreSQL `request.jwt.claims` session variable so RLS policies
 * can resolve the current tenant ID.
 *
 * Must be called before any tenant-scoped query in the same transaction.
 * The setting is local to the current transaction (will not affect concurrent
 * requests sharing the same connection pool).
 *
 * @param tenantId - UUID of the current tenant
 */
export async function setTenantRlsContext(tenantId: string): Promise<void> {
  const claims = JSON.stringify({ tenant_id: tenantId });
  await db.execute(sql`SELECT set_config('request.jwt.claims', ${claims}, true)`);
}

/**
 * Clears the PostgreSQL `request.jwt.claims` session variable.
 *
 * Call this after a transaction completes if the connection is being returned
 * to the pool without a full transaction scope. In practice, the `LOCAL`
 * scoping in setTenantRlsContext handles cleanup automatically within
 * transactions, so this is mainly useful for integration tests.
 */
export async function clearTenantRlsContext(): Promise<void> {
  await db.execute(sql`SELECT set_config('request.jwt.claims', '', true)`);
}
