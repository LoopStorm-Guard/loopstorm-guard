# LoopStorm Guard — Claude Code Handoff Brief

**Date:** 2026-04-09
**Purpose:** Full project context + outstanding work for the next Claude Code session

---

## 1. What This Project Is

LoopStorm Guard is a runtime enforcement layer and AI agent safety platform.
It intercepts AI agent tool calls, enforces policy rules, enforces budget caps,
detects loops, and writes tamper-evident JSONL hash-chain audit logs.

Read `CLAUDE.md` for the absolute rules (fail-closed, enforcement/observation
plane separation, SPDX headers, Better Auth only, etc.). Those rules are
inviolable and apply to every file you touch.

---

## 2. Infrastructure That Has Been Provisioned Externally

The following external services are **already set up** — do NOT re-create them:

| Service | Detail |
|---|---|
| **Domain** | `loop-storm.com` registered on Cloudflare |
| **DNS** | `api.loop-storm.com` → `cname.vercel-dns.com`; `app.loop-storm.com` → `a731bf097c31597a.vercel-dns-016.com` |
| **Supabase** | Project `loopstorm-prod`, region `us-east-1`, project ID `gejeptgympmaemllhljo`, URL `https://gejeptgympmaemllhljo.supabase.co` |
| **Vercel** | Org: GMW Solutions LLC (Pro). Two projects: `loopstorm-api` (ID `prj_12a7q0JjxJrXvIIJz00V8xL2gG8S`) and `loopstorm-web` |
| **Custom domains** | `api.loop-storm.com` on `loopstorm-api` ✅; `app.loop-storm.com` on `loopstorm-web` ✅ |
| **GitHub Secrets** | All 15 secrets set on the repo (see `docs/secrets-inventory.md`) |
| **Vercel env vars** | `loopstorm-api`: `DATABASE_URL`, `PRODUCTION_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY` (holds DeepSeek key). `loopstorm-web`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` |

> **Note on LLM:** The supervisor now uses DeepSeek V3.2 (model ID `deepseek-chat`) via the OpenAI-compatible API at `https://api.deepseek.com`. The env var is still named `ANTHROPIC_API_KEY` — it holds the DeepSeek key. Do not rename the env var.

---

## 3. Code Changes Already Made (Commit These If Not Yet Done)

Three files were modified locally in the last session and may not be committed:

```bash
git add apps/supervisor/src/llm/deepseek.ts \
        apps/supervisor/src/index.ts \
        apps/supervisor/src/config.ts
git commit -m "feat: swap LLM provider from Anthropic to DeepSeek V3.2"
git push
```

**What changed:**
- `apps/supervisor/src/llm/deepseek.ts` — **NEW FILE**: `DeepSeekProvider` class
  implementing `LLMProvider` via `fetch` (no new SDK dep). Uses OpenAI tool format.
- `apps/supervisor/src/index.ts` — `AnthropicProvider` import/instantiation replaced
  with `DeepSeekProvider`
- `apps/supervisor/src/config.ts` — default model changed from
  `claude-3-5-haiku-latest` to `deepseek-chat`

Also: `@anthropic-ai/sdk` is still in `apps/supervisor/package.json` but is no
longer imported. Remove it:

```bash
bun remove @anthropic-ai/sdk --cwd apps/supervisor
```

---

## 4. Domain Mismatch — Must Fix

The codebase still references `loopstorm.dev`, `docs.loopstorm.dev`,
`contact@loopstorm.dev`, and `security@loopstorm.dev` throughout the frontend.
The actual domain is `loop-storm.com`. Find all occurrences and update them:

| Old | New |
|---|---|
| `loopstorm.dev` | `loop-storm.com` |
| `docs.loopstorm.dev` | `docs.loop-storm.com` (or remove until docs site exists) |
| `contact@loopstorm.dev` | `contact@loop-storm.com` |
| `security@loopstorm.dev` | `security@loop-storm.com` |
| `app.loopstorm.dev` | `app.loop-storm.com` |
| `api.loopstorm.dev` | `api.loop-storm.com` |

Search with: `grep -r "loopstorm\.dev" packages/web/`

---

## 5. Blocking Gaps To Fix (Ordered by Priority)

These are all **P0** items from `docs/v1.1-production-readiness-audit-2026-04-07.md`.
Nothing can go to production until these are resolved.

---

### 5A. Backend Deployment Target — RESOLVED (ADR-015)

**Resolution:** ADR-015 (2026-04-09) selected Vercel Functions as the backend
deployment target. Cloudflare Workers were rejected because `setInterval` is
incompatible with the Workers runtime and the backend uses long-lived processes.

**What this means:**
- The old `deploy.yml` (Cloudflare Workers) has been deleted (Phase 0 cleanup).
- A new Vercel-based deploy workflow must be created as part of Phase 1 infra.
- Background cron jobs move to Vercel Cron (configured in `vercel.json`).
- No `wrangler.toml` is needed — Wrangler is superseded entirely.

**Remaining work (Phase 1):**
- Create `vercel.json` in `packages/backend/` with Vercel Cron configuration
- Write the new `deploy.yml` workflow (Vercel Functions for backend, Vercel for web)
- Run DB migrations before deploy (migration-before-deploy ordering per platform rules)

---

### 5B. Email Verification Broken — No Email Transport

**Problem:** `packages/backend/src/auth.ts` has `requireEmailVerification: true`
but no `sendEmail` adapter is configured in the `betterAuth()` call. Users
who sign up cannot verify their email — they are permanently locked out.

**Fix:** Configure Resend as the email provider (simplest option for production).
Better Auth supports Resend natively.

Steps:
1. Create a Resend account at `resend.com`, add domain `loop-storm.com`
2. Get a Resend API key
3. Install: `bun add resend --cwd packages/backend`
4. Add `RESEND_API_KEY` to `packages/backend/.env.local` and Vercel env vars
5. Add to `auth.ts` in the `betterAuth()` options:

```typescript
emailVerification: {
  sendVerificationEmail: async ({ user, url }) => {
    await resend.emails.send({
      from: "LoopStorm <noreply@loop-storm.com>",
      to: user.email,
      subject: "Verify your LoopStorm account",
      html: `<a href="${url}">Click to verify your email</a>`,
    });
  },
},
```

Also add `RESEND_API_KEY` to `packages/backend/src/env.ts` validation.

As a temporary workaround during development, you can set
`requireEmailVerification: false` in `auth.ts` — but NOT for production.

---

### 5C. CORS Blocks All Requests in Production

**Problem:** `packages/backend/src/index.ts` lines 46-47: if `ALLOWED_ORIGINS`
is not set and `NODE_ENV=production`, `allowedOrigins = []`. All cross-origin
requests are rejected.

**Fix:** Add `ALLOWED_ORIGINS` to the Vercel env vars for `loopstorm-api`:
```
ALLOWED_ORIGINS=https://app.loop-storm.com
```

Also document this in `docs/secrets-inventory.md` as a required production env var.

---

### 5D. Dead Env Var Blocks Backend Startup

**Problem:** `packages/backend/src/env.ts` validates `SUPABASE_SERVICE_ROLE_KEY`
as required, but this variable is **never used anywhere** in the backend code.
It blocks startup if not set.

**Fix (option 1 — safer):** Remove the validation requirement in `env.ts`:
change `SUPABASE_SERVICE_ROLE_KEY: z.string().min(1)` to optional or remove.

**Fix (option 2):** If there is a future use case for it (e.g., admin operations),
keep it but make it optional: `SUPABASE_SERVICE_ROLE_KEY: z.string().optional()`.

---

### 5E. RLS Context Leaks on Pooled Connections

**Problem:** `packages/backend/src/db.ts` uses `set_config('request.jwt.claims',
..., true)` (LOCAL scope, scoped to current transaction). But most tRPC handlers
make bare queries outside a transaction — only `events.ingest` uses
`db.transaction()`. If the connection is reused from a pool, the previous
request's tenant claims may bleed through.

**Fix:** Wrap every Drizzle query that accesses RLS-protected tables in an
explicit `db.transaction(async (tx) => { ... })` call, or use a middleware
that wraps each request in a transaction automatically.

This is the highest-risk security gap. Fix before accepting real user data.

---

### 5F. Database Migrations Never Run Against Live Supabase

**Problem:** The Supabase project (`gejeptgympmaemllhljo`) was provisioned
externally but no migrations have been run. The database is empty — no tables,
no RLS policies, no seed data.

**Also:** The migrations reference database roles (`loopstorm_ingest`,
`loopstorm_supervisor`) that must be created manually before running migrations.

**Steps to fix:**
1. Connect to the Supabase project using the CLI:
   ```bash
   bunx supabase login
   bunx supabase link --project-ref gejeptgympmaemllhljo
   ```
2. Create the required roles. Run this in the Supabase SQL editor:
   ```sql
   CREATE ROLE loopstorm_ingest NOLOGIN;
   CREATE ROLE loopstorm_supervisor NOLOGIN;
   ```
3. Run migrations:
   ```bash
   bunx drizzle-kit migrate --config packages/backend/drizzle.config.ts
   ```
   Or use Supabase CLI:
   ```bash
   bunx supabase db push
   ```
4. Run seed data (dev only): `bunx supabase db seed`

---

### 5G. Next.js Version Pin Is Broken

**Problem:** `packages/web/package.json` has `"next": "^16.2.1"`. Next.js 16
does not exist as of April 2026. Latest is 15.x. `bun install` will fail.

**Fix:** Change to `"next": "^15.0.0"` (or pin to the exact 15.x version
currently installed).

---

## 6. P1 Items (Important But Not Blocking First Deploy)

- **Forgot Password page** — Better Auth supports it but frontend has no route.
  Add `/forgot-password` and `/reset-password` pages.
- **`BETTER_AUTH_URL` env var** — Required by Better Auth for callback URLs.
  Must be set to `https://api.loop-storm.com` in Vercel env vars for `loopstorm-api`.
  Currently missing from the Vercel env vars that were configured.
- **Landing page version/test count** — Page says "v0.1.0 is live" and "67+
  Unit Tests". Update to `v1.1.0` and `332+ Unit Tests`.
- **Google OAuth redirect URI** — Must be configured in Google Cloud Console:
  - Authorized JS origin: `https://api.loop-storm.com`
  - Redirect URI: `https://api.loop-storm.com/api/auth/callback/google`
- **`NEXT_PUBLIC_BETTER_AUTH_URL`** — Not yet set in Vercel env vars for
  `loopstorm-web`. Add: `https://api.loop-storm.com`

---

## 7. Missing GitHub Secrets (Not Yet Configured)

Two secrets from `docs/secrets-inventory.md` were not set up:

| Secret | Purpose | When Needed |
|---|---|---|
| `VERCEL_CRON_SECRET` | Secures backend cron endpoints | Before enabling cron jobs |
| `RELEASE_GPG_KEY` | Signs binary releases | Before tagging a public release |
| `RELEASE_GPG_PASSPHRASE` | GPG key passphrase | Same as above |
| `RESEND_API_KEY` | Email sending (see 5B above) | Before first real signup |

---

## 8. Recommended Work Order

```
1. git commit + push DeepSeek changes (5 min)
2. Fix Next.js version pin in packages/web/package.json (5 min)
3. Remove @anthropic-ai/sdk from apps/supervisor/package.json (5 min)
4. Fix domain references: loopstorm.dev → loop-storm.com in packages/web/ (30 min)
5. Fix dead SUPABASE_SERVICE_ROLE_KEY validation in packages/backend/src/env.ts (15 min)
6. Add BETTER_AUTH_URL env var to Vercel loopstorm-api (5 min, external)
7. Add ALLOWED_ORIGINS env var to Vercel loopstorm-api (5 min, external)
8. Fix CORS config: add ALLOWED_ORIGINS to docs/secrets-inventory.md (15 min)
9. Configure Resend in auth.ts (email verification) (4-8 hours)
10. Run Supabase migrations against live project (1-2 hours)
11. Fix RLS transaction wrapping gap (1-2 days)
12. Create Vercel deploy workflow and `vercel.json` config (ADR-015 resolved Workers vs Vercel) (2-3 days)
13. First full deploy via GitHub Actions workflow_dispatch
```

---

## 9. How to Trigger a Deploy

The old `deploy.yml` (Cloudflare Workers) was deleted in Phase 0 cleanup.
A new Vercel-based deploy workflow is part of Phase 1 infra work (ADR-015).

**Until Phase 1 is complete:** Deploy manually via the Vercel dashboard or
`bunx vercel --prod` from each package directory with the correct env vars set.

**Do not push a `v*` tag until the production readiness blockers (5A–5G) are
resolved.** The release pipeline (`release.yml`) is separate from the deploy
workflow and handles SDK publishing only.

---

## 10. Key Files To Know

| File | Purpose |
|---|---|
| `CLAUDE.md` | Absolute rules — read first |
| `VERIFY.md` | SHA-256 hashes of all schema files |
| `docs/v1.1-production-readiness-audit-2026-04-07.md` | Full gap analysis |
| `docs/secrets-inventory.md` | All secrets and env vars |
| `docs/plans/v1.1-implementation-plan.md` | v1.1 feature specs |
| `packages/backend/src/auth.ts` | Better Auth config |
| `packages/backend/src/env.ts` | Env var validation |
| `packages/backend/src/index.ts` | CORS + server entry |
| `apps/supervisor/src/llm/deepseek.ts` | DeepSeek LLM provider (NEW) |
| `.github/workflows/deploy.yml` | Deploy pipeline — DELETED in Phase 0. New Vercel workflow is Phase 1 work. |
| `supabase/` | Migrations and config |

---

## 11. Do Not Change

- The enforcement/observation plane separation (ADR-012)
- Fail-closed behavior anywhere in the engine
- The `escalate_to_human` rule — it can never be blocked
- The auth library — it is Better Auth, not Supabase Auth (ADR-011)
- The package manager — Bun only, never npm/yarn/pnpm
- SPDX license headers on any file you create or modify
