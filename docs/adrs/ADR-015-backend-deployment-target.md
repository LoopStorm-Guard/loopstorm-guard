<!-- SPDX-License-Identifier: MIT -->
# ADR-015: Backend Deployment Target (Vercel Functions)

**Status:** Accepted
**Date:** 2026-04-09
**Author:** Lead Architect

---

## Context

The LoopStorm backend (`packages/backend/`) is a Hono + Bun + tRPC + Drizzle ORM + Better Auth HTTP server. The current `.github/workflows/deploy.yml` (commit 919dcb8) assumes deployment to Cloudflare Workers via `bun run --cwd packages/backend deploy`. However:

1. There is no `deploy` script in `packages/backend/package.json`.
2. There is no `wrangler.toml` anywhere in the repo.
3. The deploy workflow has never successfully run.
4. The backend uses in-process `setInterval` background jobs for `timeout-checker` and `trigger-dispatch`, which are fundamentally incompatible with Cloudflare Workers' request-response execution model.

The v1.1 production readiness audit (`docs/v1.1-production-readiness-audit-2026-04-07.md`, Section 1B) flagged this as a P0 blocker: "The Cloudflare Workers deployment is a fiction." The OSS/SaaS commercialization plan requires a working backend deployment target before any Mode 2/3 work can proceed.

External infrastructure has already been provisioned (per HANDOFF.md §2):

- **Vercel Pro organization:** GMW Solutions LLC
- **Vercel project `loopstorm-api`** (ID `prj_12a7q0JjxJrXvIIJz00V8xL2gG8S`)
- **Custom domain:** `api.loop-storm.com` attached to `loopstorm-api`
- **Environment variables** already set on `loopstorm-api`: `DATABASE_URL`, `PRODUCTION_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY`

The frontend (`packages/web/`) is already on Vercel under the `loopstorm-web` project with `app.loop-storm.com`. Deploying the backend to the same platform removes a platform boundary.

### The Three Options Considered

**Option 1: Stay with Cloudflare Workers.** Rewrite background jobs as Cloudflare Cron Triggers or Durable Objects. Add `wrangler.toml`. Use the Workers adapter for Hono.

- Pros: Edge execution (low latency globally), generous free tier, already configured in `deploy.yml`.
- Cons: `setInterval` does not work. `timeout-checker` and `trigger-dispatch` must be rewritten. Background jobs become Cron Triggers (minimum interval 1 minute) or Durable Objects (stateful, more complex). Node.js compatibility layer is partial — some Bun/Node APIs used by Drizzle, Better Auth, and the session cache may not work. Postgres.js requires the `nodejs_compat_v2` flag. The `@hono/node-server` adapter does not apply — a Workers-specific fetch handler is required. Estimated effort: 3-5 days of rewrite, with unknown risk on auth compatibility. External infrastructure (Vercel projects, domains) would need to be reprovisioned or orphaned.

**Option 2: Vercel Functions.** Deploy the backend as Vercel serverless functions. Background jobs move to Vercel Cron (`vercel.json` cron field). Use `@hono/node-server` or Vercel's Hono adapter.

- Pros: `loopstorm-api` Vercel project already exists with env vars, custom domain, and DNS. `@hono/node-server` is well-documented and stable. Vercel Cron replaces `setInterval` with minimal code changes. Frontend and backend live under one provider, simplifying DNS, SSL, env var management, and logging. Zero new accounts to provision. Fastest path from "broken" to "working." Node.js runtime on Vercel is fully compatible with Drizzle, Better Auth, postgres.js.
- Cons: Serverless cold-start latency (typically 200-800ms for the first request on an idle instance). Every request holds a transaction open (under ADR-020), so long-lived connections are not possible in serverless. Vercel Cron minimum interval is 1 minute (acceptable for the supervisor's 60-second timeout-checker, tight but workable). Vercel Pro plan cost (~$20/month) is already being paid. Vendor lock-in to Vercel's build system, but Hono itself is portable.

**Option 3: Fly.io or Railway (long-lived Bun process).** Deploy the backend as a long-lived containerized Bun process. Keep `setInterval` as-is. Use a Dockerfile.

- Pros: Zero code changes to the backend. `setInterval` works unchanged. Persistent connections possible. Closer to the development environment. Cheaper per-request at high volume. Fly.io has global regions.
- Cons: New account and platform. New CI/CD wiring. No existing Vercel project can be reused. Backend and frontend live under different providers (more DNS, SSL, secret management surface). Dockerfile, health checks, restart policies, and autoscaling all must be designed from scratch. Estimated effort: 2-3 days minimum, plus ongoing operational burden of a long-lived service.

---

## Decision

**Adopt Option 2: Deploy the backend to Vercel Functions under the existing `loopstorm-api` project. Background jobs migrate from in-process `setInterval` to Vercel Cron jobs declared in `packages/backend/vercel.json`.**

### Implementation Contract

#### 1. Backend entry point for Vercel

A new file `packages/backend/api/index.ts` (or equivalent, following Vercel's routing conventions) exports a Hono fetch handler. The existing `packages/backend/src/index.ts` is refactored to export the Hono app without calling `.listen()`. The Vercel entry point imports the app and exports it as the default handler.

Exact shape (sketch):

```typescript
// packages/backend/api/index.ts — Vercel Function entry
import { handle } from "@hono/node-server/vercel";
import app from "../src/app"; // the Hono app, no .listen()
export const config = { runtime: "nodejs20.x" };
export default handle(app);
```

Note: the exact adapter may be `@hono/vercel` depending on what Hono publishes. The implementation PR confirms the final package.

#### 2. `packages/backend/vercel.json`

A new file `packages/backend/vercel.json` declares:

- The serverless function runtime (`nodejs20.x` or equivalent, matching Bun's Node compatibility baseline).
- Route rewrites: all `/api/**` requests go to the Hono handler. Static files (none expected in the backend) are not served.
- Cron jobs:
  - `timeout-checker`: runs every 1 minute (Vercel Cron minimum), path `/api/internal/cron/timeout-checker`, protected by `VERCEL_CRON_SECRET`.
  - `trigger-dispatch`: **does NOT move to cron.** See below.
- Function config: memory, timeout, region (match Supabase region: `us-east-1`).

#### 3. Background job migration

The backend currently runs two `setInterval` loops:

- **`timeout-checker`** (every 60 seconds): scans `supervisor_proposals` and `supervisor_escalations` tables for items past their deadline and marks them `expired`.
- **`trigger-dispatch`** (bounded async channel worker): drains the in-process trigger queue and HTTP-POSTs to the supervisor.

These migrate as follows:

**`timeout-checker` → Vercel Cron.** A new route `/api/internal/cron/timeout-checker` is added. It is guarded by a `VERCEL_CRON_SECRET` header check (Vercel automatically adds this header on cron invocations). The route runs the same scan-and-expire logic that the `setInterval` loop currently runs. Vercel Cron schedule: `* * * * *` (every minute).

**`trigger-dispatch` does NOT become a cron job.** The trigger queue is in-process and bounded (capacity 100, per ADR-014 Gate 3). In a serverless model, there is no long-lived process to hold the queue. Two options:

- **Option A (chosen for v1.1):** Dispatch synchronously. When `events.ingest` evaluates a trigger and decides to dispatch, it fires the HTTP POST to the supervisor **inside the request handler**, with a tight timeout (3 seconds). If the POST succeeds, great. If it fails or times out, log the failure and continue — the trigger is lost but the next qualifying event will re-trigger. This is acceptable under ADR-014 Gate 3's trigger-loss tolerance ("if the backend restarts, pending triggers are lost, but the same conditions will re-trigger on the next relevant event").
- **Option B (deferred to v1.2):** Persist triggers in a `pending_triggers` table and have a cron job drain it. This adds a table, RLS policies, and a polling loop. It is the correct answer for high-volume production, but overkill for v1.1.

v1.1 uses Option A. The in-process bounded channel from ADR-014 Gate 3 is removed. `events.ingest` directly calls the dispatch function (which returns a Promise). The dispatch function wraps the HTTP POST with a 3-second timeout and swallows errors into a warning log.

#### 4. CORS, sessions, cookies, and `BETTER_AUTH_URL`

- **CORS:** `ALLOWED_ORIGINS=https://app.loop-storm.com` is already set on `loopstorm-api` Vercel env vars (per HANDOFF.md §2). The Hono CORS middleware reads this unchanged.
- **Cookies:** Better Auth sets `HttpOnly; Secure; SameSite=Lax` cookies scoped to `.loop-storm.com`. Because both `api.loop-storm.com` and `app.loop-storm.com` share a parent domain, cookies set by the backend are readable by the frontend. This works on Vercel identically to how it works on any HTTPS host.
- **Sessions:** Better Auth's session cache has a 5-minute TTL, stored in-memory per Function instance. Under serverless, different invocations may hit different instances, so the cache hit rate is lower than under a long-lived process. This is acceptable — the fallback is a database read, which is already the existing path.
- **`BETTER_AUTH_URL`:** must be set to `https://api.loop-storm.com` in Vercel env vars for `loopstorm-api`. HANDOFF.md §6 flags this as currently missing. It must be added before first deploy.
- **`NEXT_PUBLIC_BETTER_AUTH_URL`:** must be set to `https://api.loop-storm.com` in Vercel env vars for `loopstorm-web`. Also flagged in HANDOFF.md §6 as missing.

#### 5. `deploy.yml` changes

The existing `.github/workflows/deploy.yml` is updated:

- **Remove:** the `deploy-backend` job's Cloudflare Workers step and all references to `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **Add:** a Vercel deploy step using `bunx vercel --prod --token=${{ secrets.VERCEL_TOKEN }}` with `working-directory: packages/backend`.
- **Keep:** the `drizzle-kit migrate` step — this runs before deploy and uses `DATABASE_URL` from GitHub Secrets.
- **Keep:** the typecheck step.
- **Update:** the environment to `production` on the new Vercel deploy step.
- **GitHub Secrets:** Remove dead `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from `docs/secrets-inventory.md` after verifying they're unused. Add a note that `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` now apply to both frontend and backend deploys (with different project IDs).

#### 6. Interaction with ADR-020 (RLS transaction wrapping)

ADR-020 wraps every authenticated request in `db.transaction()`. Under Vercel Functions, each request is handled by a (potentially) different process instance, with connection pool state held per-instance. Combined with Supabase's PgBouncer pooling:

- Each Function instance holds a small pool (configurable, default 10 connections).
- Each request opens a transaction on a pooled connection, sets `request.jwt.claims` LOCAL, runs its queries, commits or rolls back, returns the connection to the pool.
- This is the exact pattern ADR-020 requires. Vercel Functions + PgBouncer transaction-mode + `db.transaction()` middleware is a correct composition.

The only subtlety is cold starts: a fresh Function instance establishes new connections on first request, which adds connection-establishment latency to the cold-start penalty. This is bounded and acceptable.

### Rationale

- **Zero new platform accounts.** All external infrastructure needed is already provisioned. The Vercel project exists. The domain exists. Env vars exist. Going live is a matter of pushing code, not operations work.
- **Fastest path to a working backend.** Option 1 (Workers) is 3-5 days of rewrite with unknown risk. Option 3 (Fly.io) is 2-3 days plus ongoing ops. Option 2 is code changes only, measured in hours.
- **Simpler DNS and SSL.** Frontend and backend under one provider. Both custom domains managed via Vercel. SSL is automatic. Cookies work across subdomains without special config.
- **Vercel Cron adequately replaces `setInterval` for `timeout-checker`.** The 1-minute minimum interval is acceptable for proposal/escalation expiry checks (the deadlines are measured in hours, not seconds).
- **Synchronous trigger dispatch is acceptable under ADR-014 Gate 3's loss tolerance.** Gate 3 already specified that pending triggers are lost on backend restart. Moving to synchronous dispatch-on-ingest changes the loss window from "between restart and re-trigger" to "when the HTTP POST fails" — both are bounded and both are recoverable via re-triggering.
- **Node.js runtime compatibility.** Drizzle, Better Auth, postgres.js, and the Hono Node server adapter all run on Vercel's `nodejs20.x` runtime without modification. No compatibility shims required.

---

## Consequences

### Positive

1. **Working backend deployment.** The P0 blocker from the production readiness audit is resolved.
2. **No new operational burden.** No new platform, no Dockerfiles, no container registry, no autoscaler config.
3. **Unified logging and monitoring.** Frontend and backend share Vercel's built-in logs, metrics, and request tracing.
4. **Single-provider billing.** One monthly invoice from Vercel (Pro plan, ~$20/month) covers both frontend and backend.
5. **Simpler cookie domain scoping.** `*.loop-storm.com` cookies work identically for both subdomains.
6. **Compatible with ADR-020.** The middleware-based transaction wrapping composes cleanly with serverless execution.
7. **CI/CD simplification.** One `deploy.yml` job structure for both frontend and backend.
8. **Instant rollback.** Vercel's deploy-preview model allows instant rollback to the previous deployment.

### Negative

1. **Cold-start latency (R4 from commercialization plan).** First request to an idle Vercel Function instance incurs a cold-start penalty, typically 200-800ms on Node.js runtimes. This affects login latency, first request after quiet periods, and any endpoint that's infrequently called. For `events.ingest`, a customer's engine is sending continuous events, so cold starts should be rare in steady state. For Better Auth session validation, the first login after idle is slower. Mitigation: measure cold-start p99 in staging; if unacceptable, enable Vercel's "always warm" feature (extra cost) or move to Fly.io.
2. **Vercel Cron 1-minute minimum interval (R5 from commercialization plan).** The `timeout-checker` currently runs every 60 seconds in the `setInterval` loop. Vercel Cron's minimum is exactly 1 minute (`* * * * *`). If future product requirements demand a tighter interval (e.g., 15-second timeout granularity), Vercel Cron is insufficient and we must either (a) accept the 1-minute granularity, (b) split the check into multiple overlapping cron jobs, or (c) move to Fly.io. For v1.1, 1-minute granularity is acceptable because proposal/escalation deadlines are measured in hours.
3. **In-memory session cache is less effective.** Better Auth's 5-minute in-memory session cache has lower hit rate under serverless because different invocations may hit different instances. Each cache miss triggers a database read. Under ADR-020, these reads are inside a transaction, so the overhead is the transaction + the query. Acceptable but noted.
4. **Vendor lock-in to Vercel.** The backend is now coupled to Vercel's Function runtime, build system, and cron system. Portability is preserved at the Hono app level (the Hono app is pure), but the deploy config is Vercel-specific. If Vercel's pricing or behavior becomes unacceptable, migration to Fly.io requires a new Dockerfile and new CI/CD wiring but no application code changes.
5. **Trigger dispatch becomes synchronous on the ingest path.** `events.ingest` now pays the HTTP POST latency to the supervisor when a trigger fires. This is a small cost (3-second timeout, typically sub-second when the supervisor is healthy) but it's on the hot path.
6. **Function timeout ceiling.** Vercel Functions have a maximum execution time (10s on Hobby, 60s on Pro, 15 minutes on Enterprise). `events.ingest` with a 1000-event batch must complete within the timeout. Measured batch insert performance suggests this is not a constraint in practice, but it's a ceiling to monitor.

### Neutral

1. **The `@hono/node-server` adapter is unchanged.** The backend continues to use a Node-compatible runtime, consistent with local Bun development (Bun implements most Node APIs).
2. **Drizzle migrations still run in CI.** `bun run --cwd packages/backend drizzle-kit migrate` continues to execute before deploy. No change.
3. **Testing is unchanged.** Unit tests, adversarial RLS tests, and integration tests all run in CI as before. Vercel-specific behavior (cold starts, cron invocations) is tested only at the staging level.

---

## Migration Path

### From broken Cloudflare deploy to working Vercel deploy

1. **Add `packages/backend/vercel.json`** with function config, cron jobs, and rewrites.
2. **Add `packages/backend/api/index.ts`** (or equivalent Vercel entry point) that imports the Hono app and exports a handler.
3. **Refactor `packages/backend/src/index.ts`** to export the Hono app without calling `.listen()` in production mode. Keep `.listen()` for local development (`bun --hot src/index.ts`).
4. **Add `deploy` script to `packages/backend/package.json`:** `"deploy": "vercel --prod"` (or use the CI step directly).
5. **Remove `setInterval` calls** for `timeout-checker` and `trigger-dispatch`. Leave the underlying functions in place; they're now called from the cron route handler and the ingest handler respectively.
6. **Add `/api/internal/cron/timeout-checker` route** that validates the Vercel cron secret and runs the timeout check.
7. **Update `events.ingest`** to call `dispatchTrigger()` synchronously (with a 3-second timeout) instead of enqueueing to the in-process channel. Remove the channel.
8. **Add `VERCEL_CRON_SECRET` to GitHub Secrets and Vercel env vars.**
9. **Add `BETTER_AUTH_URL=https://api.loop-storm.com` to `loopstorm-api` Vercel env vars.**
10. **Add `NEXT_PUBLIC_BETTER_AUTH_URL=https://api.loop-storm.com` to `loopstorm-web` Vercel env vars.**
11. **Update `.github/workflows/deploy.yml`:** remove Cloudflare steps, add Vercel deploy for backend. Remove Cloudflare secrets from the job's `env` blocks.
12. **Update `docs/secrets-inventory.md`:** remove Cloudflare secrets, add `VERCEL_CRON_SECRET`, document `BETTER_AUTH_URL` requirement.
13. **Verify via `workflow_dispatch`:** trigger the deploy manually, verify `api.loop-storm.com` returns 200 on `/health`, verify the Vercel Cron job fires on schedule.
14. **Amend ADR-014 Gate 3:** add a note that in v1.1 Vercel deployment, the trigger queue is degenerate (capacity 0, synchronous dispatch). The interface is unchanged; the implementation is simpler.

### Future migrations

- **If cold-start latency is unacceptable:** measure in staging. If p99 exceeds 1 second on session validation, evaluate Vercel's "always warm" feature or move the backend to Fly.io. Fly.io migration requires a Dockerfile and an update to `deploy.yml`. Hono app code is unchanged.
- **If trigger dispatch loss rate is high under load:** implement Option B (persistent `pending_triggers` table + cron drain). New migration, new table, new cron route. Deferred to v1.2 or later.
- **If horizontal scaling requires per-tenant provider selection:** unchanged by this ADR — that's a session-level concern, not a deployment concern.
- **If Vercel pricing becomes untenable:** Fly.io is the designated fallback.

---

## Risk: Cold-Start Latency (R4 from commercialization plan)

**Risk:** Vercel Function cold starts may add 200-800ms to the first request served by a fresh instance. This affects:

1. **Login latency.** The first POST to `/api/auth/sign-in` after an idle period is slow.
2. **First event ingest.** The first POST to `/api/trpc/events.ingest` after an idle period is slow.
3. **Dashboard first-page loads.** tRPC queries after dashboard open may hit cold functions.

**Mitigation:**

1. **Measure in staging.** Before production launch, run a cold-start latency test against `loopstorm-api` (staged deployment). Record p50, p95, p99 for `/health`, `/api/auth/session`, and `/api/trpc/runs.list`. If p99 < 1 second, accept. If p99 > 1 second, escalate.
2. **Vercel warm instances.** Vercel's "fluid compute" / pre-warming features reduce cold-start frequency. Evaluate the cost and enable if needed.
3. **Keep-alive traffic.** The customer's engine (via the Mode 2 forwarder) sends continuous events in steady state, keeping at least one instance warm. Cold starts are expected to be rare in production.
4. **Escape valve.** If cold starts remain unacceptable after all mitigations, migrate to Fly.io per the migration path above. Migration effort: ~2 days.

## Risk: Vercel Cron 1-Minute Minimum (R5 from commercialization plan)

**Risk:** The `timeout-checker` runs every 60 seconds currently. Vercel Cron's minimum interval is exactly 1 minute. If v1.1 or beyond requires tighter granularity, Vercel Cron is insufficient.

**Mitigation:**

1. **Verify 1-minute granularity is acceptable.** Supervisor proposal and escalation deadlines are measured in hours. A 60-second check interval means items expire at most 60 seconds late. This is well within product requirements.
2. **Cron overlap pattern.** If sub-minute granularity is needed later, multiple overlapping crons (each with `* * * * *` and a phase offset stored in the handler) can approximate 30-second or 15-second intervals. Complex but possible.
3. **Escape valve.** If neither option is acceptable, move the backend to Fly.io and restore `setInterval` granularity.

---

## Acceptance Criteria

- **AC-15-1:** `packages/backend/vercel.json` exists with function runtime, cron declarations, and route rewrites.
- **AC-15-2:** `packages/backend/api/index.ts` (or equivalent Vercel entry point) exports a Hono handler.
- **AC-15-3:** `packages/backend/src/index.ts` is refactored to export the Hono app without auto-listening in production.
- **AC-15-4:** `setInterval` calls for `timeout-checker` and `trigger-dispatch` are removed from production code paths.
- **AC-15-5:** `/api/internal/cron/timeout-checker` route exists, validates `VERCEL_CRON_SECRET`, and runs the timeout expiry logic.
- **AC-15-6:** `events.ingest` dispatches triggers synchronously with a 3-second timeout; errors are logged but do not fail the ingest request.
- **AC-15-7:** `VERCEL_CRON_SECRET` is added to GitHub Secrets, Vercel env vars, and `docs/secrets-inventory.md`.
- **AC-15-8:** `BETTER_AUTH_URL=https://api.loop-storm.com` is set in `loopstorm-api` Vercel env vars.
- **AC-15-9:** `NEXT_PUBLIC_BETTER_AUTH_URL=https://api.loop-storm.com` is set in `loopstorm-web` Vercel env vars.
- **AC-15-10:** `.github/workflows/deploy.yml` no longer references Cloudflare secrets; backend deploys via `bunx vercel --prod`.
- **AC-15-11:** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are removed from `docs/secrets-inventory.md`.
- **AC-15-12:** A `workflow_dispatch` on `deploy.yml` successfully deploys the backend to `api.loop-storm.com` and the frontend to `app.loop-storm.com`.
- **AC-15-13:** `api.loop-storm.com/health` returns 200 in production.
- **AC-15-14:** Vercel Cron dashboard shows `timeout-checker` firing on schedule.
- **AC-15-15:** Cold-start p99 latency for `/api/auth/session` is measured and recorded in staging. If above 1 second, escalation per Risk R4.
- **AC-15-16:** ADR-014 Gate 3 is amended with a note that the trigger queue capacity is effectively 0 under Vercel deployment (synchronous dispatch).

---

## References

- ADR-011 — Better Auth
- ADR-014 — v1.1 Gate Resolutions (Gate 3 trigger queue is amended by this ADR)
- ADR-020 — RLS Transaction Scoping (this ADR's transaction pattern composes with Vercel Functions)
- `docs/v1.1-production-readiness-audit-2026-04-07.md` — Section 1B (backend deployment gap)
- `docs/oss-saas-business-model.md` — the broader commercial context
- `HANDOFF.md` §2 (provisioned Vercel infrastructure), §5A (deployment blocker), §6 (missing env vars)
- `.github/workflows/deploy.yml` — current broken deploy pipeline
- `packages/backend/src/index.ts` — current server entry point
