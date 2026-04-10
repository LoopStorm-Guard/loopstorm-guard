<!-- SPDX-License-Identifier: MIT -->
# ADR-022: Rate Limiting (Multi-Layer, Postgres-Backed, Plan-Aware)

**Status:** Accepted
**Date:** 2026-04-10
**Author:** Lead Architect
**Deciders:** Lead Architect, Founder (GMW Solutions LLC)
**Supersedes:** None
**Related ADRs:** ADR-011 (Better Auth), ADR-015 (Vercel Cron for quota reset), ADR-018 (Event Forwarder ingest endpoint), ADR-019 (Billing and Plan Enforcement — placeholder), ADR-020 (RLS Transaction Scoping — bucket table access), ADR-021 (Email Transport — caps email-triggering endpoints)
**Modes affected:** Mode 2, Mode 3 (primary). Mode 0 and Mode 1 use in-memory limiter only.

---

## Context

### The problem

A prior architect audit identified **finding B-9: no rate limiting anywhere in the stack**. The exposed attack surface today:

1. **Auth endpoints** (`/api/auth/sign-in`, `/api/auth/sign-up`, `/api/auth/forget-password`, `/api/auth/verify-email`) accept unlimited requests. An attacker can brute-force credentials, enumerate registered email addresses via timing differences, or drain the Resend email free tier (ADR-021) by flooding password-reset requests with valid email addresses.
2. **Event ingest endpoint** (`POST /api/events/ingest`, per ADR-018) accepts unlimited requests. A stolen API key or a misconfigured customer engine can flood the endpoint with millions of events, driving up database cost and triggering billing explosions under the SaaS plan model (ADR-019 forthcoming).
3. **tRPC authenticated procedures** (`runs.list`, `policies.update`, `supervisor.approveProposal`, etc.) accept unlimited requests from any authenticated session. A compromised session token becomes an unbounded read/write key.
4. **No plan-based quotas.** The SaaS billing plan defined in ADR-019 (forthcoming) will have free, pro, and enterprise tiers with monthly event ingest caps. Without rate limiting infrastructure, plan enforcement has nowhere to live.

The v1.1 production readiness audit flagged rate limiting as a P1 blocker for Mode 2/3 deployment. For Mode 0 and Mode 1 self-hosted deployments, rate limiting is desirable but not strictly required.

### Constraints

- **Must compose with ADR-015 Vercel Functions deployment.** Rate limit state cannot live in a single-process memory — each request may hit a different Function instance. State must be durable and shared across instances.
- **Must compose with ADR-020 RLS transaction scoping.** The rate limit bucket table must either be outside RLS (service-scoped) or have RLS policies that permit the middleware's queries.
- **Must compose with ADR-018 event forwarder.** The ingest endpoint rate limit key is the tenant's API key, not the requesting IP — customer engines behind NAT share an IP.
- **Must integrate with Better Auth's built-in rate limiter.** Better Auth 1.5.x ships with a rate limiter. Using it for auth endpoints avoids reinventing the wheel.
- **Must support plan-based quotas.** ADR-019 will define per-plan event quotas; this ADR's infrastructure must be the enforcement point.
- **Must degrade safely.** If the rate limit store is unavailable, the correct fail-safe depends on the endpoint: auth endpoints fail closed (deny the request), ingest fails open with an alert (to avoid dropping customer events during a bucket store outage).

### Storage options considered

**Option A: In-memory (per-Function-instance).**

- Pros: Zero latency. Zero new dependencies.
- Cons: Vercel Functions are serverless and multi-instance. Each instance has a separate memory space, so a per-instance limit of N requests/minute means the global limit is N × instance_count, which is unbounded in practice. Useless for Mode 2/3. Acceptable only for Mode 0/1 self-hosted single-instance deployments.

**Option B: Redis / Upstash Redis.**

- Pros: Atomic `INCR` operations, battle-tested rate-limiting patterns (token bucket, sliding window), sub-millisecond latency. Upstash has a Vercel-native integration.
- Cons: New infrastructure dependency. New account, new credentials, new cost (Upstash free tier is generous but a new bill to manage). Redis is a single point of failure without replication. Adds operational surface.

**Option C: Postgres-backed bucket table.**

- Pros: Reuses the existing Supabase Postgres. No new infrastructure. Atomic via `INSERT ... ON CONFLICT ... DO UPDATE SET count = count + 1 RETURNING count`. Durable across Function instance restarts. RLS-compatible. Transaction-scoped reads compose cleanly with ADR-020.
- Cons: Adds one DB round-trip per request (~5-15ms on Supabase pooled connection). Adds write load to Postgres (N writes per minute across all rate-limited endpoints). At extreme scale (>10K req/sec), Postgres-based rate limiting is a bottleneck — but v1.1 targets hundreds of req/sec, not tens of thousands.

**Option D: Better Auth built-in + custom Postgres for non-auth.**

- Pros: Better Auth's built-in limiter is battle-tested and already ships with `storage: "database"` mode that uses the existing Drizzle connection. Non-auth endpoints get Postgres buckets. Best-of-both.
- Cons: Two rate limit systems (Better Auth's internal table and our `rate_limit_buckets` table) — mitigated because Better Auth's table is managed entirely by its migration plugin, no cross-dependencies.

---

## Decision

**Adopt Option D: a 4-layer rate limiting strategy using Better Auth's built-in rate limiter for auth endpoints, tRPC middleware for authenticated procedures, Hono middleware for the event ingest endpoint, and per-tenant plan-based quota enforcement at the router layer. Non-auth layers use a Postgres-backed `rate_limit_buckets` table. In-memory limiting is used for Mode 0/1 single-instance deployments.**

### Implementation Contract

#### Layer 1: Better Auth built-in rate limiter (auth endpoints)

Configured in `packages/backend/src/auth.ts` via Better Auth's `rateLimit` option:

```typescript
betterAuth({
  // ...existing config...
  rateLimit: {
    enabled: true,
    window: 60,           // seconds
    max: 10,              // default: 10 requests per window per IP
    storage: "database",  // uses Better Auth's internal rate limit table
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 3600, max: 20 },
      "/forget-password": { window: 3600, max: 5 },
      "/verify-email": { window: 3600, max: 5 },
    },
  },
});
```

Better Auth creates its own `rate_limit` table via its migration plugin. No manual Drizzle migration required for this layer.

The limiter keys on `request.ip` (extracted from Vercel headers, see Security Considerations). Exceeded limits return HTTP 429 with `Retry-After` header.

#### Layer 2: tRPC middleware (authenticated procedures)

A new middleware `rateLimitMiddleware` is added to `packages/backend/src/trpc/middleware/rate-limit.ts`. It is applied to `protectedProcedure` and `apiKeyProcedure` (both authenticated procedure builders). It is NOT applied to `publicProcedure`.

The middleware:

1. Computes a bucket key: `trpc:{identity}:{procedure_path}` where `identity` is the `user.id` for session auth or `api_key.id` for API-key auth, and `procedure_path` is the tRPC router path (e.g., `"runs.list"`).
2. Inserts into `rate_limit_buckets` with `ON CONFLICT DO UPDATE SET count = count + 1` inside the ADR-020 transaction (so it composes with RLS).
3. If the returned `count` exceeds the per-procedure limit, throws `TRPCError({code: "TOO_MANY_REQUESTS", message: "rate_limited", cause: {retryAfter: secondsUntilWindowEnd}})`.
4. Emits an OTel metric `rate_limit_hits_total{layer="trpc", procedure, identity_type}`.

Default limits (overrideable per-procedure via middleware options):

| Procedure type | Default limit |
|---|---|
| Read-only (`.list`, `.get`) | 120 req/min per identity |
| Write (`.create`, `.update`, `.revoke`) | 30 req/min per identity |
| Heavy (`.ingest` via tRPC — deprecated path) | 10 req/min per identity |
| Supervisor approval/rejection (`supervisor.approveProposal`, `supervisor.rejectProposal`) | 60 req/min per identity |

Per-procedure overrides live in a single constant object in the middleware file so the whole table is auditable in one place.

#### Layer 3: Hono middleware (event ingest endpoint)

A new middleware `ingestRateLimitMiddleware` is added to `packages/backend/src/middleware/rate-limit.ts`. It is applied via `app.use("/api/events/ingest", ingestRateLimitMiddleware)` before any tRPC routing.

The middleware:

1. Reads the `Authorization: Bearer lsg_...` header and resolves it to an API key id (without validating the full key — validation happens in the ingest handler itself).
2. Looks up the API key's tenant id and the tenant's plan tier (`free`, `pro`, `enterprise`).
3. Computes two bucket keys:
   - `ingest:{tenant_id}:{current_second}` for the per-second rate (burst protection)
   - `quota:{tenant_id}:{YYYY-MM}` for the monthly quota (ADR-019 integration)
4. Atomically increments both buckets (two statements in a single transaction).
5. Checks the per-second rate against the plan's `requests_per_second` limit. On exceed: HTTP 429 with `Retry-After: 1`.
6. Checks the monthly quota against the plan's `event_quota_monthly` limit. On exceed: HTTP 402 with JSON body `{error: "quota_exceeded", plan, quota, used, upgrade_url}`.
7. On both checks passing, proceeds to the ingest handler.

Default plan limits (placeholder values; ADR-019 will finalize):

| Plan | requests_per_second | event_quota_monthly |
|---|---|---|
| Free | 100 | 10,000 |
| Pro | 1,000 | 1,000,000 |
| Enterprise | 10,000 | unlimited |

These are stored in a `plans` table (ADR-019) but for v1.1 can be hardcoded in a `PLAN_LIMITS` constant with a TODO referencing ADR-019.

**Fail-open on bucket store outage.** If the Postgres `rate_limit_buckets` insert fails (connection error, timeout > 200ms), the middleware logs a warning, emits `rate_limit_store_errors_total{layer="ingest"}`, and allows the request through. This prevents a database outage from dropping customer events. Auth and tRPC layers fail closed instead — see Security Considerations.

#### Layer 4: Plan quota enforcement (monthly)

The `quota:{tenant_id}:{YYYY-MM}` bucket is incremented by Layer 3 on every ingest request (by the number of events in the batch, not per-request). Monthly reset happens naturally via the key including `YYYY-MM`: the bucket for `quota:tenant_x:2026-04` is distinct from `quota:tenant_x:2026-05`, so no explicit reset is needed.

A Vercel Cron job (per ADR-015) named `rate-limit-bucket-cleanup` runs daily at 03:00 UTC and deletes rows from `rate_limit_buckets` where `window_start < now() - INTERVAL '7 days'`. This prevents unbounded bucket table growth.

Monthly quota counters are kept longer (90 days) to support billing dispute lookups; the cleanup query excludes `key LIKE 'quota:%'` rows.

#### Database schema

New Drizzle migration `packages/backend/drizzle/NNNN_rate_limit_buckets.sql`:

```sql
CREATE TABLE rate_limit_buckets (
  key            TEXT         NOT NULL,
  window_start   TIMESTAMPTZ  NOT NULL,
  count          INTEGER      NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX rate_limit_buckets_window_start_idx
  ON rate_limit_buckets (window_start);

-- No RLS on this table: it is service-scoped. The middleware uses the
-- service connection pool, not the per-request RLS-scoped client.
-- This is intentional. See ADR-022 Security Considerations.
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY rate_limit_buckets_deny_all ON rate_limit_buckets
  FOR ALL USING (false) WITH CHECK (false);

-- Only the service role bypasses this policy.
```

The bucket table does NOT compose with ADR-020's per-request RLS transaction. The rate limit middleware uses a separate service-scoped connection (via a dedicated Drizzle client or by running the `INSERT ... ON CONFLICT` as the service role). This is necessary because the rate limit check must run *before* the tenant context is set (for auth endpoints) and must operate across tenants (for cross-tenant abuse detection).

#### HTTP response contracts

**429 Too Many Requests** (all layers):

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{"error":"rate_limited","layer":"trpc","retryAfter":60}
```

**402 Payment Required** (Layer 4 quota only):

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{"error":"quota_exceeded","plan":"free","quota":10000,"used":10001,"resetAt":"2026-05-01T00:00:00Z","upgradeUrl":"https://app.loop-storm.com/billing/upgrade"}
```

### Rationale

- **Why 4 layers, not 1?** Different endpoints have different abuse profiles. Auth endpoints need IP-based limiting (attacker controls the user id, not the IP); ingest endpoints need tenant-based limiting (attacker may control many IPs but one API key); tRPC procedures need per-user limiting (abuse of valid sessions). A single layer cannot model all three without an explosion of configuration complexity.
- **Why Postgres over Redis?** Zero new infrastructure. Transactional atomicity via `ON CONFLICT`. Composes with existing Drizzle client. Acceptable performance at v1.1 target scale. If future load requires it, Redis can replace the Postgres path behind the same middleware interface (the middleware is the abstraction boundary).
- **Why soft quotas (HTTP 402) over hard kills?** Customers on the free plan who hit their quota mid-month need a clear upgrade path, not a silent failure. HTTP 402 is a first-class signal that the client is expected to surface ("upgrade to continue"). Hard kills would look like outages.
- **Why fail-open on ingest and fail-closed on auth?** Ingest outage costs customer events (unacceptable); auth outage during a bucket store failure means sign-in fails (acceptable — users retry). The fail modes are chosen per-layer based on blast radius.
- **Why bucket table is not RLS-scoped?** The rate limiter must run before tenant context is known (auth endpoints) and must operate across tenants. RLS on the bucket table would break both use cases. Instead, the table is locked behind a deny-all policy, bypassed only by the service role. The middleware uses a dedicated service-scoped client.
- **Why Better Auth's built-in limiter for Layer 1?** Reusing battle-tested code. Better Auth's limiter already handles IP extraction, key format, reset timing, and the integration with its own sign-in/sign-up routes. Writing a custom auth rate limiter is work for no benefit.
- **Why fixed-window over token-bucket?** Fixed-window is simpler to implement in Postgres (one key per window), auditable, and acceptable for v1.1. Token-bucket allows burst smoothing but requires more complex state. Upgrade is possible later if bursty traffic patterns emerge.

---

## Consequences

### Positive

1. **Protects against credential stuffing and brute-force login.** Layer 1 caps sign-in attempts at 10/minute per IP — a 100K-password dictionary takes ~7 days per IP to exhaust.
2. **Protects the email free tier.** Layer 1 caps password-reset requests at 5/hour per IP, preventing Resend (ADR-021) quota drain.
3. **Protects against ingest flood and billing explosions.** Layer 3 caps per-tenant ingest at the plan's RPS limit; Layer 4 caps monthly event volume at the plan's quota.
4. **Unblocks ADR-019 billing enforcement.** The `quota:{tenant_id}:{YYYY-MM}` bucket is the exact counter ADR-019 needs. Billing integration becomes a matter of reading the bucket, not building new infrastructure.
5. **Composes cleanly with ADR-020 RLS.** The bucket table bypass is surgical and documented.
6. **Observable.** OTel metrics (`rate_limit_hits_total`, `rate_limit_store_errors_total`) feed existing dashboards.
7. **Single migration path to Redis if needed.** The middleware is the abstraction boundary. Swapping the store is a one-file change.

### Negative

1. **Adds 5-15ms latency per authenticated request.** The bucket lookup is a Postgres round-trip. On hot paths (dashboard queries), this is noticeable but acceptable.
2. **Adds write load to Postgres.** Every ingest request becomes two additional writes (per-second bucket + per-month quota bucket). At 1,000 events/sec sustained, that's 2,000 additional writes/sec across the tenant population. Supabase's default pool handles this, but it's not free.
3. **Bucket table must be cleaned up.** The daily Vercel Cron cleanup job adds operational surface.
4. **Plan limits are hardcoded in v1.1.** Until ADR-019 ships the `plans` table, plan limits live in a `PLAN_LIMITS` constant. An operator cannot adjust limits without a code deploy. Documented as a v1.1 limitation.
5. **Fixed-window algorithm allows 2x burst at window boundaries.** A client sending 10 requests at second 59 and 10 more at second 61 passes both windows but exceeds the "10 req/60s" intent briefly. Acceptable for v1.1; upgrade to sliding window possible later.
6. **Rate limit bucket state is lost on Postgres restart.** Acceptable: the cleanup window is tighter than any plausible outage window.
7. **Per-endpoint custom limits require middleware-code changes.** No runtime UI for operators. Deferred.

### Neutral

1. **Better Auth's rate limit table is managed by its own migrations.** No cross-dependency with our Drizzle migrations.
2. **Mode 0 and Mode 1 use an in-memory limiter.** Smaller blast radius; single-instance deployments tolerate in-memory state.
3. **429 and 402 responses are cacheable by CDNs.** Vercel's edge caching respects the response headers; a hot limit response is served from cache if the same client retries.

---

## Migration Path

### From "no rate limiting" to 4-layer coverage

1. **Create Drizzle migration** `packages/backend/drizzle/NNNN_rate_limit_buckets.sql` with the `rate_limit_buckets` table, indexes, and deny-all RLS policy.
2. **Configure Better Auth rate limiter** in `packages/backend/src/auth.ts` with `rateLimit: { enabled: true, storage: "database", ... }` and the custom rules for `sign-in`, `sign-up`, `forget-password`, `verify-email`.
3. **Create `packages/backend/src/trpc/middleware/rate-limit.ts`** implementing the tRPC middleware with per-procedure limit overrides.
4. **Apply the tRPC middleware to `protectedProcedure` and `apiKeyProcedure`** in the tRPC builder file.
5. **Create `packages/backend/src/middleware/rate-limit.ts`** implementing the Hono ingest middleware with per-tenant, per-plan limits.
6. **Apply the Hono middleware** to `POST /api/events/ingest` in the Hono app wiring.
7. **Create `packages/backend/src/lib/rate-limit-store.ts`** — a shared module that wraps the `INSERT ... ON CONFLICT` logic and is used by both middlewares. Uses a dedicated service-scoped Drizzle client (not the per-request RLS-scoped client).
8. **Add `PLAN_LIMITS` constant** in `packages/backend/src/lib/plan-limits.ts` with hardcoded `free`, `pro`, `enterprise` values. Mark as `// TODO(ADR-019)`.
9. **Add Vercel Cron job** `rate-limit-bucket-cleanup` in `packages/backend/vercel.json` running daily at 03:00 UTC, hitting `/api/internal/cron/rate-limit-cleanup`.
10. **Create `/api/internal/cron/rate-limit-cleanup`** handler that validates `VERCEL_CRON_SECRET` and runs the cleanup DELETE.
11. **Add OTel metric registrations** for `rate_limit_hits_total{layer, ...}` and `rate_limit_store_errors_total{layer}`.
12. **Write unit tests** per AC list below.
13. **Write integration tests** for each layer against a real Postgres test database.
14. **Smoke test in staging:** hit `/api/auth/sign-in` 11 times in 60 seconds, expect the 11th to 429. Hit `/api/events/ingest` beyond the free plan's quota, expect a 402.
15. **Add docs:** `docs/operators/rate-limiting.md` documenting the four layers, default limits, and troubleshooting.

### Future migrations

- **If Postgres bucket latency becomes a bottleneck:** swap the store implementation in `lib/rate-limit-store.ts` to use Upstash Redis. Middleware interfaces unchanged. ADR amendment documents the migration.
- **If burst smoothing is needed:** upgrade from fixed-window to sliding-window or token-bucket. Store schema gets a second column. Middleware logic updated. ADR amendment required.
- **When ADR-019 ships:** replace `PLAN_LIMITS` constant with runtime reads from the `plans` table. Remove the TODO.
- **If per-endpoint operator-configurable limits are needed:** add a `rate_limit_overrides` table and a middleware hot-reload path. Deferred.

---

## Security Considerations

1. **IP extraction must be correct.** On Vercel, the trusted client IP is in the `x-vercel-forwarded-for` header (Vercel strips upstream `x-forwarded-for` values it doesn't trust). The rate limiter MUST use `x-vercel-forwarded-for` (or `request.ip` if the runtime exposes it), NOT the raw `x-forwarded-for` header, which is client-controllable. A bug here allows attackers to trivially bypass IP-based limits by rotating the `x-forwarded-for` value.
2. **Rate limit checks must run BEFORE authentication on auth endpoints.** If the limiter runs after auth, attackers can probe username existence via timing differences in the "auth failed" vs "rate limited" responses. Better Auth's built-in limiter handles this correctly; our custom layers must preserve the property.
3. **Ingest endpoint limits are per-tenant (API key), not per-IP.** Customers behind NAT may share an IP but will never share an API key. IP-based limiting on ingest would accidentally punish large tenants. Tenant-based limiting is correct but requires resolving the API key to a tenant before the limiter runs — this adds one DB lookup that itself should be rate-limited (see next point).
4. **API key lookup in the ingest middleware must be cached.** A naive implementation does a DB lookup for every ingest request to resolve `lsg_...` → tenant id, which defeats the purpose. v1.1 uses an in-memory LRU cache with a 60-second TTL per Function instance. Stale cache entries are acceptable because API key revocation takes effect within 60 seconds worst case.
5. **Bucket table must not be readable via RLS-scoped queries.** The deny-all policy on `rate_limit_buckets` prevents tenant code paths from accidentally reading or writing the table. Only the service-scoped Drizzle client bypasses it.
6. **Fail-closed vs fail-open per layer is security-critical.** Auth endpoints fail closed on store outage (deny the request) — a rate limiter that silently allows unlimited login attempts during a DB hiccup is worse than a login outage. Ingest endpoints fail open — a rate limiter that drops customer events during a DB hiccup is worse than a brief over-quota window.
7. **Rate limit bypass for internal endpoints.** The `/api/internal/cron/*` endpoints (ADR-015) are reached only via Vercel's cron secret. They are NOT subject to rate limiting (otherwise a slow cleanup cron could rate-limit itself). The Hono middleware skips rate limiting when the path prefix is `/api/internal/cron/`.
8. **Observability cannot leak PII.** OTel metrics use `{layer, procedure, identity_type}` labels, NOT the raw user id or API key. Tenant ids are acceptable in metrics if the metrics backend is tenant-scoped; in v1.1 they are replaced with `tenant_id_hash` (SHA-256 first 8 bytes).
9. **Monthly quota counter must not reset early.** The cleanup cron excludes `quota:%` keys. A bug here would silently reset a tenant's monthly usage, allowing unlimited ingest. Include a test for this.
10. **Service-scoped bucket client must not log queries with keys.** The bucket key contains user ids and tenant ids. Drizzle's query logger must be disabled (or scrubbed) for the bucket-store connection.

---

## Acceptance Criteria

- **AC-22-1:** Drizzle migration `NNNN_rate_limit_buckets.sql` creates `rate_limit_buckets` table with composite PK `(key, window_start)`, index on `window_start`, and deny-all RLS policy.
- **AC-22-2:** `packages/backend/src/auth.ts` Better Auth config sets `rateLimit: { enabled: true, storage: "database" }` with custom rules for `sign-in`, `sign-up`, `forget-password`, `verify-email`.
- **AC-22-3:** `packages/backend/src/trpc/middleware/rate-limit.ts` exports a `rateLimitMiddleware` applied to `protectedProcedure` and `apiKeyProcedure` in the tRPC builder.
- **AC-22-4:** Default tRPC limits match the table in this ADR: 120/min read, 30/min write, 10/min heavy, 60/min supervisor.
- **AC-22-5:** `packages/backend/src/middleware/rate-limit.ts` exports a `ingestRateLimitMiddleware` applied to `POST /api/events/ingest`.
- **AC-22-6:** Ingest middleware resolves the API key header to a tenant id and plan tier via an LRU cache with 60-second TTL.
- **AC-22-7:** Free plan default limits: 100 req/sec, 10,000 events/month. Pro: 1,000 req/sec, 1M events/month. Enterprise: 10,000 req/sec, unlimited.
- **AC-22-8:** 429 responses include `Retry-After` header and JSON body `{error: "rate_limited", layer, retryAfter}`.
- **AC-22-9:** 402 quota responses include JSON body `{error: "quota_exceeded", plan, quota, used, resetAt, upgradeUrl}`.
- **AC-22-10:** `packages/backend/src/lib/rate-limit-store.ts` exposes an `incrementBucket(key, windowStart, limit)` helper that uses a service-scoped Drizzle client (not the RLS-scoped per-request client).
- **AC-22-11:** Auth and tRPC layers fail CLOSED on bucket store errors (return 429 or 503). Ingest layer fails OPEN on bucket store errors (allows request, logs warning, emits `rate_limit_store_errors_total`).
- **AC-22-12:** Vercel Cron job `rate-limit-bucket-cleanup` runs daily at 03:00 UTC and deletes rows with `window_start < now() - INTERVAL '7 days'`, excluding `quota:%` keys.
- **AC-22-13:** Cron route `/api/internal/cron/rate-limit-cleanup` validates `VERCEL_CRON_SECRET` before executing the DELETE.
- **AC-22-14:** OTel metrics registered: `rate_limit_hits_total{layer, procedure, identity_type}` and `rate_limit_store_errors_total{layer}`.
- **AC-22-15:** Rate limit keys use `x-vercel-forwarded-for` (or equivalent trusted IP source), NOT the raw `x-forwarded-for` header.
- **AC-22-16:** Unit test: Layer 1 — the 11th sign-in request within 60 seconds from the same IP returns 429.
- **AC-22-17:** Unit test: Layer 2 — the 121st `runs.list` request within 60 seconds for the same user returns `TRPCError(TOO_MANY_REQUESTS)`.
- **AC-22-18:** Unit test: Layer 3 — the 101st ingest request within 1 second for the same tenant on the free plan returns 429.
- **AC-22-19:** Unit test: Layer 4 — the 10,001st event ingested in the current month for a free-plan tenant returns 402 with correct `upgradeUrl`.
- **AC-22-20:** Unit test: `/api/internal/cron/*` paths bypass the Hono rate limit middleware.
- **AC-22-21:** Unit test: bucket store outage on auth path fails closed; bucket store outage on ingest path fails open and logs.
- **AC-22-22:** Unit test: cleanup cron does NOT delete `quota:%` rows older than 7 days (the monthly counter must persist 90 days).
- **AC-22-23:** Integration test: sign-in limiter hits 429 at the 11th attempt in staging, resets after 60 seconds.
- **AC-22-24:** Integration test: ingest limiter returns 402 when the tenant has reached its monthly quota, and the response contains the correct `upgradeUrl`.
- **AC-22-25:** `docs/operators/rate-limiting.md` documents the four layers, default limits, and how to tune them.

---

## Out of Scope (Deferred)

1. **Dynamic quota adjustment via Stripe webhook.** When a tenant upgrades from free to pro, the `plans` table (ADR-019) is the source of truth. The rate limit middleware will read from it. v1.1 hardcodes plan limits in a constant; dynamic plan changes require a backend restart.
2. **Per-endpoint custom limits UI for operators.** A future operator dashboard could allow adjusting the limits table without code deploys. Not in v1.1.
3. **Burst tokens / leaky bucket algorithm.** v1.1 uses fixed-window for simplicity. Upgrade to sliding-window or token-bucket is possible later if bursty traffic patterns emerge.
4. **Per-user-agent or per-device-id limiting.** v1.1 limits per-IP, per-user, or per-API-key only.
5. **Rate limit bypass for trusted internal services.** v1.1 only bypasses `/api/internal/cron/*`. Future internal service-to-service calls need their own allowlist mechanism.
6. **Distributed rate limiting via Redis.** Considered and rejected for v1.1. Postgres is sufficient at target scale.
7. **Rate limit response caching.** CDNs can cache 429 responses, but v1.1 does not set explicit `Cache-Control` for rate limit responses. Relying on default behavior.
8. **Geographic rate limit variance.** e.g., higher limits for specific regions. Not in v1.1.
9. **Per-tenant abuse detection and automatic suspension.** Repeated quota violations should alert and potentially suspend a tenant. v1.1 just returns 402; suspension is manual via ops.

---

## References

- ADR-011 — Better Auth (Layer 1 uses Better Auth's built-in rate limiter)
- ADR-015 — Backend Deployment Target (Vercel Cron used for bucket cleanup; Vercel headers used for trusted IP extraction)
- ADR-018 — Event Forwarder (ingest endpoint whose Layer 3/4 limits are defined here)
- ADR-019 — Billing and Plan Enforcement (pending — will finalize plan limits and the `plans` table)
- ADR-020 — RLS Transaction Scoping (bucket table is intentionally outside RLS; composition documented)
- ADR-021 — Email Transport (email-triggering endpoints are protected by Layer 1)
- `docs/v1.1-production-readiness-audit-2026-04-07.md` — finding B-9 no rate limiting
- Better Auth rate limit docs: https://www.better-auth.com/docs/concepts/rate-limit
- Vercel headers docs: https://vercel.com/docs/edge-network/headers
- OWASP ASVS V11.1 Business Logic Security (rate limiting and anti-automation)
- OWASP Agentic AI Top 10 AA8 (Resource Overload) — rate limiting is a partial control
