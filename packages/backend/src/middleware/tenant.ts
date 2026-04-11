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
 * current transaction. Combined with the tRPC middleware that wraps every
 * authenticated procedure in a `db.transaction()` call (ADR-020), this means
 * the setting is ALWAYS scoped to the current transaction and never leaks to
 * other concurrent requests sharing the same pooled connection.
 *
 * IMPORTANT: This MUST be called inside an explicit transaction for the LOCAL
 * scoping to work correctly with PgBouncer in transaction mode (ADR-020).
 * The `withTenantTransaction` middleware in trpc.ts guarantees this invariant.
 *
 * ADR-020: The function signature accepts a `tx` client (Drizzle transaction
 * or the db singleton) so that it can be called on the same client used by
 * the procedure. The caller is responsible for passing the transaction client;
 * using the db singleton here would defeat the purpose of the transaction scope.
 */

import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";

/**
 * A Drizzle client that can execute raw SQL — either the singleton `db`
 * or a transaction `tx` returned by `db.transaction()`.
 *
 * We use structural typing (duck typing) rather than importing the Drizzle
 * transaction type directly, because Drizzle's internal transaction types
 * are deeply generic and change across minor versions. Any object with an
 * `execute` method that accepts a Drizzle `sql` tagged template is sufficient.
 */
export type DrizzleClient = Pick<Database, "execute">;

/**
 * Sets the PostgreSQL `request.jwt.claims` session variable so RLS policies
 * can resolve the current tenant ID.
 *
 * MUST be called on the same `tx` client used by the procedure, inside an
 * active transaction. The setting is LOCAL to the transaction; when the
 * transaction commits or rolls back, the setting is cleared and the connection
 * returns to the pool with no lingering tenant context (ADR-020).
 *
 * @param client - The Drizzle transaction client (tx) from db.transaction().
 *                 NEVER pass the db singleton here — that breaks the LOCAL scope.
 * @param tenantId - UUID of the current tenant
 */
export async function setTenantRlsContext(client: DrizzleClient, tenantId: string): Promise<void> {
  const claims = JSON.stringify({ tenant_id: tenantId });
  await client.execute(sql`SELECT set_config('request.jwt.claims', ${claims}, true)`);
}

/**
 * Clears the PostgreSQL `request.jwt.claims` session variable.
 *
 * In production, the LOCAL scoping in setTenantRlsContext combined with
 * the transaction-per-request middleware (ADR-020) ensures automatic cleanup.
 * This function is retained for integration tests that need explicit cleanup
 * between test cases without a transaction boundary.
 *
 * @param client - The Drizzle client to use for the query
 */
export async function clearTenantRlsContext(client: DrizzleClient): Promise<void> {
  await client.execute(sql`SELECT set_config('request.jwt.claims', '', true)`);
}
