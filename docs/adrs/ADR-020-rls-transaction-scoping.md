<!-- SPDX-License-Identifier: MIT -->
# ADR-020: RLS Transaction Scoping via tRPC Middleware

**Status:** Accepted
**Date:** 2026-04-09
**Author:** Lead Architect

---

## Context

The v1.1 production readiness audit (`docs/v1.1-production-readiness-audit-2026-04-07.md`, Section 2A and Section 8B) identified a high-severity security gap: Row-Level Security (RLS) context may leak between requests when database connections are pooled.

### The Problem

The backend uses PostgreSQL RLS to enforce tenant isolation on six tables: `runs`, `events`, `policy_packs`, `api_keys`, `supervisor_proposals`, and `supervisor_escalations`. The tenant context is injected at request time via:

```typescript
await sql`SELECT set_config('request.jwt.claims', ${claims}, true)`;
```

The third argument `true` means **LOCAL** scope: the setting is valid only for the duration of the current transaction. When the transaction commits or rolls back, the setting is reset.

This is the correct pattern if every query runs inside an explicit transaction. However, in the current backend:

- `events.ingest` is correctly wrapped in `db.transaction(async (tx) => { ... })`.
- All other tRPC handlers (`runs.list`, `runs.get`, `runs.getEvents`, `policies.list`, `policies.get`, `policies.create`, `policies.update`, `supervisor.listProposals`, `supervisor.approveProposal`, `supervisor.rejectProposal`, `supervisor.listEscalations`, `supervisor.acknowledgeEscalation`, `apiKeys.create`, `apiKeys.list`, `apiKeys.revoke`, `verify.chain`) issue bare queries **outside** an explicit transaction.

When `set_config(..., true)` is called outside a transaction, its scope becomes ambiguous — in practice, it becomes session-local (valid until the connection returns to the pool or the session ends). With a connection pool (which Supabase uses via PgBouncer), the same physical connection can serve multiple requests sequentially. If request A sets `request.jwt.claims` for tenant X and then request B reuses the connection **before** setting its own claims, request B briefly sees tenant X's RLS context.

In the worst case, a timing error or a bug in the middleware (`setTenantRlsContext`) could cause request B to read tenant X's data. This is a **cross-tenant data leak** — the single highest-severity security risk in the audit.

### The Three Options Considered

**Option 1: Manual transaction wrapping per handler.** Add `db.transaction(async (tx) => { ... })` to every tRPC procedure and rewrite every query to use `tx` instead of `db`.

- Pros: Explicit, handler-by-handler. No middleware magic.
- Cons: ~17 procedures to rewrite. Easy to forget on the next new procedure. No compile-time guarantee. Every code reviewer must remember to check for the pattern. The adversarial RLS tests would need one case per procedure.

**Option 2: tRPC middleware that opens a transaction per authenticated request.** Add a middleware that wraps the entire procedure call in `db.transaction(async (tx) => { ... })`, calls `setTenantRlsContext(tx, tenant_id)` inside the transaction, and injects `tx` into the tRPC context. Every procedure uses `ctx.db` which is always a transaction-scoped client.

- Pros: One diff. Impossible to forget on new procedures. Compile-time enforced via context shape. One set of adversarial RLS tests covers every procedure because the middleware is the single enforcement point.
- Cons: Adds one extra round-trip (BEGIN/COMMIT) per request. Every request holds a transaction open for its entire duration.

**Option 3: Drizzle-wide connection hook.** Use a Drizzle client wrapper or a `postgres.js` `onconnect` / `onquery` hook to automatically start a transaction on every query.

- Pros: Fully transparent to procedure authors.
- Cons: Drizzle does not expose such a hook cleanly in v0.44. Implementing it requires forking or monkey-patching the client, which is brittle. The behavior becomes implicit and harder to debug. Not idiomatic.

---

## Decision

**Adopt Option 2: a tRPC middleware that wraps every authenticated procedure in a database transaction, sets the RLS tenant context inside the transaction, and injects the transaction client into the tRPC context.**

### Implementation Contract

A new middleware `withTenantTransaction` is added to `packages/backend/src/trpc/middleware.ts` (or an equivalent location). It is applied to every procedure that accesses RLS-protected tables. In practice this means it is applied to `protectedProcedure` (session-authenticated) and `apiKeyProcedure` (API-key-authenticated), which together cover every authenticated procedure in the backend.

```typescript
// Sketch, not final code — AC-20-3 below is the authoritative shape.
export const withTenantTransaction = t.middleware(async ({ ctx, next }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return db.transaction(async (tx) => {
    await setTenantRlsContext(tx, ctx.tenantId);
    return next({
      ctx: {
        ...ctx,
        db: tx, // Shadow the global db with the transaction client.
      },
    });
  });
});
```

- `ctx.db` is shadowed so that every query inside the procedure uses the transaction client. Procedures must never import `db` directly — they must use `ctx.db`. This is enforced via an ESLint rule or a type-level trick (see AC-20-4).
- `setTenantRlsContext(tx, tenantId)` must be called **inside** the transaction, using the same `tx` client, so the `set_config('request.jwt.claims', ..., true)` is bound to this transaction's scope exclusively.
- When the procedure returns normally, the transaction commits and the RLS context is automatically cleared. If the procedure throws, the transaction rolls back and the RLS context is cleared. Either way, the connection returns to the pool with no lingering state.

### Exclusions

The middleware does NOT apply to:
- `/api/auth/*` (Better Auth routes) — these do not run through tRPC and have their own session-level tenant provisioning.
- Unauthenticated tRPC procedures (health check, public metadata) — these do not access RLS-protected tables.

### Rationale

- **Single enforcement point.** The audit's core concern is that non-transactional handlers slip through code review. A single middleware makes it structurally impossible.
- **Testability.** Adversarial RLS tests can hit a single mock procedure that exercises the middleware. Every other procedure inherits the guarantee.
- **Drizzle-native.** `db.transaction()` returns a `tx` client with the same API surface as `db`. No client wrapping, no proxying, no runtime surprises.
- **Matches existing patterns.** `events.ingest` already uses `db.transaction()`. This change generalizes that pattern to every authenticated procedure.
- **Audit traceability.** Every RLS-protected query is now provably inside a transaction that called `setTenantRlsContext`. A reviewer can verify correctness by inspecting the middleware, not by auditing 17 separate procedures.

### Test Strategy

The existing adversarial RLS tests in `packages/backend/tests/adversarial-rls.test.ts` (added in PR #17/#18) must be extended with these new scenarios:

1. **Pooled connection leak test** (new). Two sequential requests from two different tenants on a stub pool that forces connection reuse. Assert that request B sees only tenant B's data and cannot read tenant A's rows even when the connection is literally the same underlying socket.
2. **Middleware bypass test** (new). Confirm that any procedure wired without `withTenantTransaction` fails at type-check time (or runtime) when it tries to use `ctx.db`, preventing a new procedure from silently skipping the middleware.
3. **Transaction rollback test** (new). If a procedure throws mid-query, the RLS context must be cleared and the next request on the same pooled connection must not inherit it.
4. **Existing cross-tenant read tests** (kept). All existing adversarial tests continue to pass — `db.select()` from tenant A cannot return tenant B's rows.
5. **Nested transaction guard** (new). If a procedure tries to call `db.transaction()` inside the middleware, it either no-ops (Drizzle's savepoint behavior) or fails fast. The test must pin the chosen behavior.

These tests must run against a real PostgreSQL instance (not a mock), because PgBouncer's pooling behavior cannot be simulated in a unit test. The existing CI job `test-backend` runs against a local Postgres; these new tests slot into that job.

---

## Consequences

### Positive

1. **Structural fix.** Cross-tenant data leaks via connection pooling become architecturally impossible, not just unlikely.
2. **One source of truth.** Every authenticated tRPC procedure is now guaranteed to run in a transaction with the correct RLS context set exactly once.
3. **Simpler procedure code.** Procedure authors no longer need to remember to wrap their handlers manually. They write `ctx.db.select(...)` and the middleware handles the rest.
4. **Better test coverage.** A single set of adversarial RLS tests verifies the guarantee for every procedure.
5. **Audit-friendly.** Security review is reduced to "does the middleware do the right thing?" rather than "does every procedure do the right thing?"
6. **No schema changes.** This is a pure backend refactor. No migrations, no schema version bumps, no client-side impact.

### Negative

1. **Per-request transaction overhead.** Every authenticated request now holds a transaction open for its full duration. For read-only operations this is an extra BEGIN/COMMIT round-trip. Measured impact: ~1-3ms additional latency per request. For `events.ingest` and other write operations, the overhead was already paid. This is acceptable.
2. **Refactor surface.** ~17 tRPC procedures must be updated to use `ctx.db` instead of the imported `db`. This is a mechanical change but requires care to not break tests.
3. **Long-held connections.** Each request now holds a pooled connection for its entire duration (not just for individual query execution). Under high concurrency, this increases pool pressure. Mitigation: monitor pool utilization after rollout; increase pool size if needed.
4. **R6 risk (documented below).** PgBouncer transaction-mode pooling interacts with LOCAL config in a subtle way — see Risk section.

### Neutral

1. **Drizzle savepoints.** If a procedure explicitly calls `ctx.db.transaction()`, Drizzle issues a SAVEPOINT rather than a nested transaction. This is the desired behavior and does not need special handling.
2. **Connection pool sizing.** The backend's `postgres.js` client configuration may need tuning (`max` connections) after this change. This is operational, not architectural.

---

## Risk: PgBouncer Transaction-Mode Pooling (R6 from commercialization plan)

Supabase uses PgBouncer in **transaction-mode pooling** by default. In transaction mode, a client session holds the underlying PostgreSQL connection only for the duration of a transaction. Between transactions, the connection returns to the pool.

This is the **correct** pairing for our middleware: as long as we always operate inside a transaction, PgBouncer transaction-mode and our LOCAL `set_config` are both scoped to the same transaction boundary. When the transaction commits, the RLS context is cleared AND the connection returns to the pool simultaneously. There is no window during which a pooled connection exists without an active transaction.

However, there is a subtle failure mode: **if any procedure accidentally issues a query outside the transaction**, PgBouncer might route it to a different backend connection with an uninitialized (or worse, stale) session state. The middleware prevents this by shadowing `ctx.db` with the `tx` client, but a bug in the middleware or a procedure that imports `db` directly could silently bypass the protection.

**Mitigation:**
1. **ESLint rule** (or custom lint) that forbids importing `db` from `packages/backend/src/db/client.ts` anywhere except the middleware itself and the Drizzle migration tooling. All procedures must use `ctx.db`.
2. **Type-level enforcement.** The tRPC context type is defined so that `ctx.db` is required; procedures that try to use the global `db` get a type error when they pass `db` to a Drizzle helper expecting the transaction client.
3. **Connection mode test.** In CI, spin up a real PgBouncer in transaction mode (Supabase-like setup) and run the adversarial RLS tests through it. This catches pooling-specific bugs that a direct connection would miss.
4. **Prepared statements.** `postgres.js` is configured with `prepare: false` for PgBouncer compatibility. This remains correct under this ADR.

This risk is documented as R6 in the OSS/SaaS commercialization plan. This ADR accepts the risk with the mitigations above.

---

## Migration Path

### From current code to ADR-020 compliance

1. **Add middleware.** Write `withTenantTransaction` in `packages/backend/src/trpc/middleware.ts`. Add unit tests for the middleware itself.
2. **Update procedure builders.** Apply the middleware to `protectedProcedure` and `apiKeyProcedure` in `packages/backend/src/trpc/trpc.ts` (or wherever the procedure builders live).
3. **Update procedures.** For each of the ~17 authenticated procedures, replace `db.select(...)` with `ctx.db.select(...)`. Mechanical find-and-replace with careful review.
4. **Remove manual transactions.** In `events.ingest`, the existing `db.transaction()` call becomes redundant (the middleware already wraps the whole procedure). Remove it. If `events.ingest` needs a savepoint inside the outer transaction, use `ctx.db.transaction()` explicitly — this produces a SAVEPOINT under Drizzle.
5. **Add ESLint rule.** Forbid `import { db } from "./db/client"` in all files except the middleware and Drizzle tooling.
6. **Extend adversarial RLS tests.** Add the five new test cases listed in the Test Strategy section above.
7. **Run full test suite.** All existing tests must pass. Any regression indicates a procedure that was relying on bare-query behavior — fix it to use `ctx.db`.
8. **Deploy to staging.** Verify latency impact is within acceptable bounds (< 5ms p99 increase).
9. **Deploy to production.** Monitor connection pool utilization for the first week.

### From ADR-020 to future work

- **Horizontal scaling.** When the backend scales to multiple instances, the middleware pattern continues to work unchanged. Each instance holds its own pool; the middleware's per-request transaction is instance-local.
- **Read replicas.** If read traffic is routed to Supabase read replicas, the middleware must be updated to route read-only procedures to the replica pool. The transaction wrapping pattern remains the same; only the pool selection changes.
- **Schema changes.** Future migrations that add new RLS-protected tables automatically benefit from the middleware. No per-table plumbing is required.

---

## Acceptance Criteria

- **AC-20-1:** A new `withTenantTransaction` middleware exists in `packages/backend/src/trpc/middleware.ts` and wraps every authenticated procedure.
- **AC-20-2:** All ~17 authenticated tRPC procedures use `ctx.db` instead of the global `db` import.
- **AC-20-3:** The `setTenantRlsContext` call happens inside the transaction, on the transaction client, before any user-code query executes.
- **AC-20-4:** An ESLint rule (or equivalent) forbids importing `db` from outside the middleware and the Drizzle migration tooling.
- **AC-20-5:** Adversarial RLS tests include a pooled-connection leak test that runs against a real Postgres (or PgBouncer) and passes.
- **AC-20-6:** Adversarial RLS tests include a transaction rollback test that confirms a thrown error does not leak RLS context to the next request.
- **AC-20-7:** `events.ingest` no longer calls `db.transaction()` directly; the outer middleware transaction covers it.
- **AC-20-8:** CI runs the backend test suite against a PgBouncer-like pooling setup, not just a direct connection.
- **AC-20-9:** Backend p99 latency increase is within 5ms after rollout, measured on staging.
- **AC-20-10:** No cross-tenant read is possible under any adversarial test scenario.

---

## References

- `docs/v1.1-production-readiness-audit-2026-04-07.md` — Section 2A (Database gaps), Section 8B (Security gaps)
- ADR-011 — Better Auth (defines how `ctx.tenantId` is populated)
- PR #17, PR #18 — existing adversarial RLS tests
- `packages/backend/src/db/client.ts` — current Drizzle client setup
- `packages/backend/src/trpc/` — current tRPC procedure builders
