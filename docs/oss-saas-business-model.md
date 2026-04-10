<!-- SPDX-License-Identifier: MIT -->
# LoopStorm Guard -- Open Source + SaaS Business Model

**Date:** 2026-04-07
**Author:** Lead Architect
**Audience:** Founder / business stakeholders

---

## Table of Contents

1. [How Open Source + SaaS Works](#1-how-open-source--saas-works)
2. [What Is Public vs What Is Secret](#2-what-is-public-vs-what-is-secret)
3. [How Competitors Can and Cannot Copy You](#3-how-competitors-can-and-cannot-copy-you)
4. [The Deployment Modes Through This Lens](#4-the-deployment-modes-through-this-lens)
5. [Publishing Strategy: What Goes Where](#5-publishing-strategy-what-goes-where)
6. [Revenue Protection: Why This Actually Works](#6-revenue-protection-why-this-actually-works)
7. [Concrete Next Steps](#7-concrete-next-steps)

---

## 1. How Open Source + SaaS Works

### The Core Idea

Every successful open-source SaaS business rests on the same insight: **the
code is the product's blueprint, but the running service is the product.** A
restaurant publishes its recipes in a cookbook. People still eat at the
restaurant because they do not want to buy the ingredients, hire a chef,
maintain a kitchen, and handle health inspections themselves.

LoopStorm Guard publishes its source code on GitHub. Customers still pay for
the hosted service because they do not want to provision a database, deploy a
backend, configure auth, manage uptime, handle security patches, run the AI
Supervisor on their own infrastructure, or build their own web dashboard.

### The Major Open Source Business Models

There are three common models. LoopStorm Guard uses Model 1.

**Model 1: Open Core** (LoopStorm Guard's model)

The core product is genuinely free and open source. Premium features (hosted
dashboard, AI Supervisor, collaboration) are open source under a restrictive
copyleft license (AGPL) that discourages competitors from offering them as a
service without contributing back.

Real-world examples:
- **GitLab**: Core is MIT. EE features were proprietary, later open-sourced
  under a source-available license. Revenue comes from hosted GitLab.com and
  self-managed enterprise licenses.
- **Supabase**: Client libraries are MIT. The platform (dashboard, auth,
  realtime) is Apache-2.0 but the hosted service is the product. Revenue
  comes from hosted databases.
- **Grafana**: Core is AGPL-3.0. Cloud dashboards, alerting, and enterprise
  features drive revenue.

**Model 2: Fully Open, Hosted Service**

Everything is open source under a permissive license. Revenue comes purely
from the convenience and reliability of the hosted version.

Real-world examples:
- **PostHog**: MIT-licensed analytics. Self-host for free or pay for PostHog
  Cloud. Revenue comes from volume-based pricing on the hosted product.
- **Sentry**: BSL (formerly Apache-2.0). Self-host or pay for sentry.io.

**Model 3: Dual License**

The software is available under both an open-source license (for community
use) and a commercial license (for enterprises that cannot comply with the
open-source terms). Sometimes combined with "source available" licenses like
SSPL or BSL.

Real-world examples:
- **HashiCorp** (Terraform, Vault): Changed from MPL to BSL in 2023.
  Competitors cannot offer the software as a competing service. Enterprises
  buy Terraform Cloud / HCP Vault.
- **MongoDB**: SSPL. Competitors cannot offer MongoDB-as-a-service without
  open-sourcing their entire stack.

### Which Model LoopStorm Guard Uses

LoopStorm Guard uses **Open Core with a dual-license option.** This is
defined in ADR-013 (`docs/adrs/ADR-013-open-core-licensing.md`). The
codebase is split into two license tiers:

**MIT-licensed (the free core):**

| Package | Path | What It Does |
|---------|------|-------------|
| Engine | `apps/engine/` | Rust binary that enforces policies, detects loops, tracks budgets, writes JSONL |
| CLI | `apps/cli/` | `loopstorm verify`, `loopstorm replay`, `loopstorm validate` |
| Python shim | `apps/shim-python/` | `pip install loopstorm` -- wraps OpenAI/Anthropic tool calls |
| TypeScript shim | `apps/shim-ts/` | `bun add @loopstorm/shim-ts` -- wraps tool calls in TS agents |
| Schemas | `packages/schemas/` | JSON Schema definitions for IPC, events, policies |
| MCP Proxy | `apps/mcp-proxy/` | Model Context Protocol proxy for MCP-native agents |
| OTel Exporter | `apps/otel-exporter/` | Converts JSONL audit logs to OpenTelemetry spans |
| Supervisor | `apps/supervisor/` | AI Supervisor agent process |
| IPC Client | `packages/ipc-client/` | Shared IPC client library for TS packages |

Anyone can use, modify, distribute, sell, or embed these components.
Enterprises can fork and build proprietary products on top. No restrictions.

**AGPL-3.0-only (the commercial moat):**

| Package | Path | What It Does |
|---------|------|-------------|
| Backend | `packages/backend/` | Hono + tRPC API, Drizzle ORM, Better Auth, event ingest, chain verification |
| Web UI | `packages/web/` | Next.js 15 dashboard, run timelines, policy editor, supervisor UI, landing page |

Anyone can read, modify, and run these. But AGPL-3.0 requires that **if you
modify the backend or web UI and offer it as a network service to others, you
must publish your entire modified source code under AGPL-3.0.** This is the
key mechanism. A competitor who wants to run a hosted LoopStorm service using
your backend code must open-source all their modifications, their deployment
scripts, their custom integrations -- everything. Most commercial competitors
will not do this.

**The dual-license option:** Enterprises that want to self-host the control
plane (Mode 1) but cannot comply with AGPL obligations -- for example,
because their legal department prohibits AGPL in their infrastructure -- can
purchase a commercial license from GMW Solutions LLC. This is a separate
revenue stream on top of the SaaS subscription.

### The License Boundary in Practice

The boundary is enforced by CI. Every source file has an SPDX license header
as its first comment:

```
// SPDX-License-Identifier: MIT          (in apps/engine/, apps/shim-ts/, etc.)
// SPDX-License-Identifier: AGPL-3.0-only  (in packages/backend/, packages/web/)
```

The CI job `license-boundary` (`scripts/check-license-boundary.sh`) verifies
that MIT packages never import from AGPL packages. The dependency direction
is one-way: **AGPL code may depend on MIT code, but MIT code must never
depend on AGPL code.** This prevents "license contamination" -- if an MIT
package imported AGPL code, the entire MIT package would become AGPL,
destroying the free-adoption value of the engine and shims.

---

## 2. What Is Public vs What Is Secret

This is the most important concept to internalize: **code is public,
configuration is private.** The code tells the software WHAT to do. The
secrets tell it WHERE to connect and WHO it is.

### An Analogy

Imagine you publish the complete blueprint for a bank vault door -- every
gear, every bolt, every tumbler diagram. Is this a security risk? No. The
security of a vault does not come from the secrecy of its design. It comes
from the combination that only you know. Publishing the blueprint lets
locksmiths verify the design is sound. The combination stays in your head.

LoopStorm Guard is the same. The code is the blueprint. The secrets are the
combination.

### What Is Public (on GitHub)

Everything in the repository is public. All source code, all documentation,
all schemas, all test fixtures. This includes:

- The exact SQL migrations that create your database tables
- The exact tRPC procedure definitions that define your API
- The exact policy evaluation logic in the Rust engine
- The exact Better Auth configuration (how sessions work, how OAuth works)
- The exact CORS configuration, rate limiting, and RLS policies

This is intentional. Public code means:
- Security researchers can audit it
- Customers can verify what the product does before buying
- Contributors can submit fixes
- The community builds trust in the product

### What Is Secret (never in the repository)

Secrets are values that, if exposed, would give an attacker access to your
specific running instance. They exist only in environment variables on your
servers and in your CI/CD provider's secret storage. The `.gitignore` file
in the repository explicitly excludes all secret files:

```
.env
.env.local
.env.*.local
.env.production
.env.staging
.env.development
.env.test
```

Here is every secret the system uses, where it lives, and what it does:

#### Backend Secrets (`packages/backend`)

| Secret | What It Does | Where It Lives | What Happens If Leaked |
|--------|-------------|----------------|----------------------|
| `DATABASE_URL` | PostgreSQL connection string with username and password (e.g., `postgresql://user:password@host:5432/db`) | Hosting provider env vars (Cloudflare Workers secrets / Fly.io secrets) | Attacker gets full read/write access to your database. All customer data compromised. |
| `BETTER_AUTH_SECRET` | 32+ byte random string used to sign session cookies and JWTs. Generated with `openssl rand -base64 32`. | Hosting provider env vars | Attacker can forge session tokens, impersonate any user, bypass all auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase JWT that bypasses RLS. Used for administrative operations. | Hosting provider env vars | Attacker bypasses row-level security. Can read/write any tenant's data. |
| `GOOGLE_CLIENT_ID` | OAuth client ID for "Sign in with Google." Obtained from Google Cloud Console. | Hosting provider env vars | Low risk alone. Attacker cannot complete OAuth flow without the secret. |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret. Paired with the client ID. | Hosting provider env vars | Attacker can impersonate your app in Google OAuth flows. |
| `LOOPSTORM_SUPERVISOR_INTERNAL_KEY` | Shared secret between the backend and the AI Supervisor process. Authenticates trigger dispatch requests. | Hosting provider env vars (both backend and supervisor) | Attacker can send fake triggers to the supervisor, causing unnecessary LLM spend. |
| `LOOPSTORM_API_KEY` | API key for the supervisor to authenticate with the backend's tRPC API. Created via the backend's `apiKeys.create` procedure. Format: `lsg_` + 32 hex chars. | Hosting provider env vars (supervisor) | Attacker can read event data and create proposals through the backend API. |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins (e.g., `https://app.loopstorm.dev`). | Hosting provider env vars | Not a secret per se, but misconfiguration allows cross-origin attacks. |

#### Supervisor Secrets (`apps/supervisor`)

| Secret | What It Does | Where It Lives |
|--------|-------------|----------------|
| `ANTHROPIC_API_KEY` | API key for Anthropic's Claude API. This is YOUR key, billed to YOUR Anthropic account. The supervisor uses it to call Claude for run analysis. | Hosting provider env vars |
| `LOOPSTORM_SUPERVISOR_MODEL` | Which Claude model to use (default: `claude-3-5-haiku-latest`). Not secret, but operational config. | Hosting provider env vars |

#### Frontend Secrets (`packages/web`)

| Secret | What It Does | Where It Lives |
|--------|-------------|----------------|
| `NEXT_PUBLIC_API_URL` | The URL of your backend API (e.g., `https://api.loopstorm.dev`). Public by design -- the browser needs to know where to send requests. | Vercel project env vars |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | The URL for auth endpoints. Also public by design. | Vercel project env vars |

Note: Frontend "secrets" prefixed with `NEXT_PUBLIC_` are not secret at all.
They are intentionally exposed to the browser. This is normal -- the browser
needs to know the API URL to make requests. The security comes from the
backend validating every request with session cookies and API keys.

#### CI/CD Secrets (GitHub Actions)

| Secret | What It Does | Where It Lives |
|--------|-------------|----------------|
| `PYPI_TOKEN` | Authenticates `twine upload` to publish the Python shim to PyPI. | GitHub repository secrets |
| `NPM_TOKEN` | Authenticates `npm publish` to publish the TypeScript shim to npm. | GitHub repository secrets |
| `CLOUDFLARE_API_TOKEN` | Authenticates `wrangler deploy` to deploy the backend to Cloudflare Workers. | GitHub repository secrets |
| `CLOUDFLARE_ACCOUNT_ID` | Identifies your Cloudflare account. | GitHub repository secrets |
| `VERCEL_TOKEN` | Authenticates deployment to Vercel. | GitHub repository secrets |
| `VERCEL_ORG_ID` | Identifies your Vercel organization. | GitHub repository secrets |
| `VERCEL_PROJECT_ID` | Identifies the Vercel project for the web UI. | GitHub repository secrets |

#### How Secrets Get to Running Code

The flow is:

1. You create the secret once (e.g., generate a random string, sign up for
   Anthropic and copy the API key, create a Supabase project and copy the
   connection string).

2. You paste the secret into your hosting provider's dashboard. For example:
   - Cloudflare Workers dashboard > Settings > Environment Variables
   - Vercel dashboard > Project > Settings > Environment Variables
   - GitHub > Repository > Settings > Secrets and variables > Actions

3. When the code runs, it reads the secret from `process.env.SECRET_NAME`.
   The file `packages/backend/src/env.ts` validates that all required secrets
   are present at startup:

   ```typescript
   const envSchema = z.object({
     DATABASE_URL: z.string().url(),
     SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
     BETTER_AUTH_SECRET: z.string().min(32),
     BETTER_AUTH_URL: z.string().url(),
     // ... etc
   });
   ```

   If a required secret is missing, the backend refuses to start. This is
   fail-closed behavior -- it is better to crash at startup than to run
   without proper auth.

4. The secret is never logged, never committed, never included in error
   responses. The `gitleaks` configuration (`.gitleaks.toml`) scans every
   commit for accidentally leaked secrets, and CI blocks the merge if any
   are found.

### The Key Insight

A competitor can read every line of your code on GitHub. They can see exactly
how `DATABASE_URL` is used in `packages/backend/src/db/client.ts`:

```typescript
export const sql = postgres(env.DATABASE_URL, { ... });
```

But they cannot connect to YOUR database because they do not have YOUR
connection string. They do not have your Supabase project. They do not have
your customers' data. They do not have your Anthropic API key (so they
cannot run your AI Supervisor without paying Anthropic themselves). They do
not have your Stripe account (so they cannot collect your payments). They do
not have your domain (so they cannot impersonate your brand).

**The code is the recipe. The secrets are the keys to your kitchen.**

---

## 3. How Competitors Can and Cannot Copy You

### What They Can Do With the MIT Code

The engine, CLI, shims, schemas, MCP proxy, OTel exporter, and supervisor
are all MIT-licensed. A competitor can:

- Fork the engine and build a competing product on top of it.
- Embed the Python shim in their own agent framework.
- Redistribute the CLI as part of their own developer toolkit.
- Build a completely different backend and web UI that uses the same engine.
- Sell a hosted service built on the engine without owing you anything.

This is by design. MIT on the enforcement core maximizes adoption. Every
developer who uses the LoopStorm engine, even in a competitor's product,
validates the LoopStorm event schema as a standard. This makes your hosted
platform more valuable as the "official" implementation.

### What They Can Do With the AGPL Code

The backend (`packages/backend/`) and web UI (`packages/web/`) are
AGPL-3.0-only. A competitor can:

- Read the code and learn from it.
- Run it internally for their own use.
- Modify it and run the modified version.

But if they offer the modified version as a service to others (which is
what "competing with your SaaS" means), AGPL requires them to:

- Publish their entire modified source code under AGPL-3.0.
- Make it available to every user who interacts with the service.
- Include all deployment scripts, configuration templates, and custom
  integrations they built on top.

Most commercial competitors will not do this. Publishing their proprietary
modifications defeats the purpose of competing. The AGPL is not a technical
barrier -- it is a legal and business barrier.

### What They Cannot Do Regardless of License

Even if a competitor forked everything and built their own hosted service:

- They cannot use your **brand** ("LoopStorm Guard" and the loopstorm.dev
  domain are yours).
- They cannot access your **customers** (customer relationships, contracts,
  support history).
- They cannot use your **database** (your Supabase instance with all
  customer data).
- They cannot use your **Stripe account** (your payment processing, your
  revenue).
- They cannot use your **Anthropic API key** (they must pay for their own
  LLM usage).
- They cannot replicate your **cross-customer intelligence** (Mode 3's
  aggregated pattern data across all customers).
- They cannot match your **update velocity** (you know the codebase best,
  you ship fastest).

### Real Companies That Thrive Despite Being Open Source

| Company | License | Revenue Model | Why Open Source Helps |
|---------|---------|--------------|---------------------|
| GitLab | MIT (core) + proprietary (EE) | Hosted + self-managed licenses | Trust. Enterprises can audit the code. |
| Supabase | Apache-2.0 | Hosted Postgres + premium features | Developer adoption. 60k+ GitHub stars drive signups. |
| Grafana | AGPL-3.0 | Grafana Cloud subscriptions | Standard. Everyone uses Grafana dashboards, pays for hosted. |
| PostHog | MIT | Volume-based hosted pricing | Transparency. Product analytics requires trust about data handling. |
| Sentry | BSL | Volume-based hosted pricing | Ecosystem. 100k+ projects use Sentry SDK. Free tier converts to paid. |
| HashiCorp | BSL (was MPL) | Terraform Cloud, HCP Vault | Ubiquity. Terraform is the standard. Training, support, governance drive paid. |

The pattern is consistent: **open source creates the market, the hosted
service captures the value.**

---

## 4. The Deployment Modes Through This Lens

LoopStorm Guard has four deployment modes (documented in
`docs/deployment-modes.md`). Each mode represents a different point on the
free-to-paid spectrum.

### Mode 0 -- Pure OSS (Free, Air-Gapped)

**Who runs it:** The customer, on their own machine.
**What they get:** Engine + shims + CLI + JSONL audit logs. Full policy
enforcement, budget caps, loop detection, tamper-evident logs.
**What they pay:** Nothing.
**Network required:** No.

**Credentials involved:**
- None. Mode 0 uses zero secrets. The engine reads a YAML policy file from
  disk and writes a JSONL file to disk. No database, no API, no auth.

**Why give this away free?** Mode 0 is the top of your sales funnel. A
developer installs the engine, writes a policy, runs their agent, and sees
the JSONL output. They experience the value of LoopStorm. When their team
grows, when they need a dashboard, when they need the AI Supervisor, they
upgrade. Charging for Mode 0 would kill adoption. Your competitor in Mode 0
is "no guardrails at all" -- you are trying to get developers to adopt
guardrails in the first place.

### Mode 1 -- Self-Hosted Control Plane (Enterprise License)

**Who runs it:** The customer, on their own infrastructure.
**What they get:** Everything -- engine, backend, web UI, supervisor -- all
running inside their own environment.
**What they pay:** Commercial license fee (annual). This is necessary because
the customer is running the AGPL backend/web code and may not want to comply
with AGPL obligations.
**Network required:** Internal only (customer's own network).

**Credentials involved:**
- All secrets are the customer's own. They provision their own Supabase
  project, their own Anthropic API key, their own auth secret.
- You provide nothing except the software and support.

**Revenue model:** Annual license fee for permission to use the AGPL code
without AGPL obligations, plus support and update subscriptions.

### Mode 2 -- Hosted Control Plane (SaaS Tier 1)

**Who runs it:** The customer runs the engine locally. You run the backend
and web UI.
**What they get:** Local enforcement + your hosted dashboard, event storage,
chain verification, team collaboration.
**What they pay:** Monthly SaaS subscription.
**Network required:** Yes -- the engine's HTTP batch sink sends events to
your hosted backend.

**Credentials involved:**

The customer provides:
- Their own engine binary (downloaded from GitHub Releases or installed via
  package manager).
- Their own policy YAML file.
- A LoopStorm API key (created in your dashboard) that the engine uses to
  authenticate event uploads.

You provide (running on your servers):
- `DATABASE_URL` -- your Supabase PostgreSQL connection.
- `BETTER_AUTH_SECRET` -- your session signing key.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` -- your Google OAuth app
  (so customers can "Sign in with Google" on your dashboard).
- `ALLOWED_ORIGINS` -- `https://app.loopstorm.dev`.
- `NEXT_PUBLIC_API_URL` -- `https://api.loopstorm.dev`.

**Revenue model:** Monthly subscription based on event volume, team seats,
or flat tier pricing.

### Mode 3 -- Full Stack with AI Supervisor (SaaS Tier 2)

**Who runs it:** The customer runs the engine locally. You run everything
else, including the AI Supervisor.
**What they get:** Everything in Mode 2, plus live AI analysis, risk scoring,
policy proposals, escalations, mobile approval app.
**What they pay:** Higher monthly subscription.
**Network required:** Yes.

**Additional credentials you provide:**
- `ANTHROPIC_API_KEY` -- your Anthropic API key. The supervisor calls
  Claude on behalf of all your customers. You pay the LLM cost and factor
  it into the subscription price. This is a key part of the value
  proposition: the customer does not need their own Anthropic account.
- `LOOPSTORM_SUPERVISOR_INTERNAL_KEY` -- internal auth between your backend
  and supervisor processes.
- `LOOPSTORM_API_KEY` -- the supervisor's API key for your backend.

**Revenue model:** Premium subscription. The AI Supervisor has a hard budget
cap of $2.00 per session (configurable), so your LLM costs per customer
are bounded and predictable.

### The Revenue Ladder

```
Mode 0 (Free)     --> Developer discovers LoopStorm, uses the engine
                       ↓ Team grows, needs visibility
Mode 2 ($49/mo)   --> Dashboard, event storage, team collaboration
                       ↓ Needs AI assistance, compliance, mobile
Mode 3 ($X/mo)    --> AI Supervisor, mobile approval, cross-customer intel
                       ↓ Needs air-gapped deployment
Mode 1 ($$$/yr)   --> Enterprise license, self-hosted, support contract
```

---

## 5. Publishing Strategy: What Goes Where

| What | Where | Access | Examples |
|------|-------|--------|---------|
| All source code | GitHub (public repo) | Anyone can read, fork, clone | `apps/engine/`, `packages/backend/`, `packages/web/`, all docs, all schemas |
| Rust binaries | GitHub Releases (public) | Anyone can download | `loopstorm-guard-v1.1.0-x86_64-unknown-linux-gnu.tar.gz`, `checksums-sha256.txt` |
| Python shim | PyPI (public) | `pip install loopstorm` | Published by `release.yml` using `PYPI_TOKEN` |
| TypeScript shim | npm (public) | `bun add @loopstorm/shim-ts` | Published by `release.yml` using `NPM_TOKEN` |
| Documentation | GitHub + docs site (public) | Anyone can read | `docs/`, deployed to `docs.loopstorm.dev` |
| JSON schemas | GitHub + npm (public) | Anyone can validate against | `schemas/`, published as `@loopstorm/schemas` |
| CI/CD tokens | GitHub Secrets (private) | Only repository admins | `PYPI_TOKEN`, `NPM_TOKEN`, `VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN` |
| Production database | Supabase (private) | Only your backend code, via `DATABASE_URL` | Customer data, runs, events, proposals, escalations |
| Auth signing key | Hosting provider env vars (private) | Only your backend code, via `BETTER_AUTH_SECRET` | 32-byte random string |
| LLM API key | Hosting provider env vars (private) | Only your supervisor code, via `ANTHROPIC_API_KEY` | Billed to your Anthropic account |
| OAuth credentials | Hosting provider env vars (private) | Only your backend code | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` from Google Cloud Console |
| Payment processing | Stripe Dashboard (private) | Only you | Stripe API keys, webhook signing secrets (future) |
| Domain names | DNS registrar (private) | Only you | `loopstorm.dev`, `api.loopstorm.dev`, `app.loopstorm.dev` |
| SSL certificates | Hosting provider (auto-provisioned) | Transparent | Cloudflare, Vercel handle automatically |
| Customer data backups | Supabase / S3 (private) | Only you | Point-in-time recovery, offsite backups |

### What the Release Pipeline Publishes

When you push a version tag (e.g., `git tag v1.1.0 && git push origin
v1.1.0`), the release workflow (`.github/workflows/release.yml`) runs
four jobs:

1. **build-binaries**: Compiles the Rust engine and CLI for 5 targets
   (Linux x86/arm64, macOS x86/arm64, Windows x86). Produces `.tar.gz` and
   `.zip` archives with SHA-256 checksums.

2. **create-release**: Collects all archives, creates a GitHub Release with
   auto-generated changelog, and uploads the binaries as release assets.

3. **publish-python**: Builds the Python shim (`apps/shim-python/`) and
   uploads to PyPI using `PYPI_TOKEN`.

4. **publish-npm**: Builds the TypeScript shim (`apps/shim-ts/`) and
   publishes to npm using `NPM_TOKEN`.

None of these jobs publish the backend or web UI to any package registry.
The AGPL code is only available as source code on GitHub. Customers who
want to self-host (Mode 1) clone the repo and build it themselves. SaaS
customers (Mode 2/3) never interact with the backend code directly -- they
use your hosted instance.

---

## 6. Revenue Protection: Why This Actually Works

### Addressing the Fear Directly

"If anyone can read my code, why would anyone pay?"

This fear is natural but unfounded. Here is why, in concrete terms:

### The Code Is Not the Value -- the Service Is

Consider what a competitor would need to do to replicate your SaaS using
your public code:

1. **Provision infrastructure.** Set up a Supabase project (or any
   PostgreSQL instance with RLS). Configure connection pooling, backups,
   monitoring, alerting. Estimated ongoing cost: $50-500/month.

2. **Deploy the backend.** Figure out the deployment target (the current
   codebase has no wrangler.toml for Cloudflare Workers -- they would
   need to create their own). Configure CORS, set up all environment
   variables, handle the fact that `setInterval` background jobs do not
   work on serverless platforms.

3. **Deploy the frontend.** Set up a Vercel project, configure environment
   variables, set up a custom domain, SSL certificates, CDN.

4. **Configure auth.** Create a Google OAuth application, configure Better
   Auth with an SMTP provider for email verification, handle session
   management edge cases (the tenant provisioning hook, self-healing
   `ensureTenantId`, session cache invalidation).

5. **Run database migrations.** Execute the three migration files, create
   the `loopstorm_ingest` and `loopstorm_supervisor` database roles, verify
   RLS policies work correctly (your own production readiness audit found
   that RLS context may leak between requests on pooled connections --
   they would need to discover and fix this too).

6. **Run the AI Supervisor.** Provision a long-running server (not
   serverless -- the supervisor needs `setInterval` for its polling loop).
   Get their own Anthropic API key. Pay for LLM usage out of their own
   pocket.

7. **Handle payments.** Build their own Stripe integration (which does not
   exist yet in your codebase either -- they would need to build it from
   scratch, same as you).

8. **Maintain everything.** Apply security patches, handle Supabase
   upgrades, update dependencies, respond to customer support requests,
   handle GDPR data deletion requests, maintain uptime SLAs.

This is months of engineering work and ongoing operational cost. Meanwhile,
you are shipping features. The competitor is always behind because you
know the codebase better than anyone.

### AGPL Forces Transparency on Competitors

If a competitor uses your AGPL backend code in their hosted service, they
must publish all modifications. This means:

- Their custom features are visible to you. You can adopt good ideas.
- Their deployment configuration is visible to their customers, who may
  wonder why they are paying a third party when the original is available.
- Their modifications may diverge from upstream, creating maintenance
  burden. Every time you release a new version, they must merge their
  changes with yours.

Most commercial competitors will choose to build their own backend from
scratch rather than deal with AGPL compliance. This is a significant
barrier -- the LoopStorm backend is thousands of lines of carefully
integrated tRPC procedures, Drizzle schema, RLS policies, and auth hooks.
Replicating it is far more work than reading it.

### Data Gravity

Once a customer's agent runs are stored in your database, switching to a
competitor means:

- Losing historical run data (or paying to export and import it).
- Losing hash chain continuity (the tamper-evident audit trail starts over).
- Losing AI Supervisor learning (patterns, baselines, proposal history).
- Losing team configurations (policies, API keys, alert rules).
- Reconfiguring all their agents to point to a new endpoint.

This is not vendor lock-in by malicious design -- it is the natural
consequence of storing data in a database. It is the same reason people
stay with GitHub, Slack, or any SaaS. The switching cost is real.

### Trust and Brand

Enterprises do not buy software. They buy a vendor relationship. They want:

- A legal entity to sign a contract with.
- An SLA with uptime guarantees.
- A security contact (your `SECURITY.md` with responsible disclosure).
- SOC 2 compliance (future).
- A human to call when something breaks at 2 AM.
- A roadmap they can influence with their feedback.

None of this comes from a GitHub repository. All of it comes from a
company.

### The Numbers

Running a SaaS business involves costs that are invisible to someone
reading source code:

| Cost | Approximate Monthly |
|------|-------------------|
| Supabase (Pro plan + compute) | $25-200 |
| Cloudflare Workers | $5-50 |
| Vercel (Pro plan) | $20 |
| Anthropic API (Supervisor LLM) | $100-2,000+ (scales with customers) |
| Domain registration | $1 |
| Email service (Resend/SendGrid) | $0-20 |
| Monitoring (Grafana Cloud, Sentry) | $0-50 |
| Legal (terms of service, privacy policy) | $500-2,000 one-time |
| Stripe fees | 2.9% + $0.30 per transaction |
| Your time (engineering, support, sales) | Priceless |

A customer who pays $49/month is buying freedom from all of the above. They
are paying you to handle the infrastructure, the security, the uptime, the
updates, the compliance, and the support so they can focus on building their
AI agents.

---

## 7. Concrete Next Steps for LoopStorm

Based on thorough analysis of the codebase and the production readiness
audit (`docs/v1.1-production-readiness-audit-2026-04-07.md`), here are the
specific steps to go from "code on GitHub" to "revenue-generating SaaS."

### Phase 1: Foundation (Week 1-2)

**1. Register and configure the domain.**
- Register `loopstorm.dev` (or your chosen domain).
- Set up DNS with Cloudflare (you are already deploying Workers there).
- Configure subdomains: `api.loopstorm.dev` (backend), `app.loopstorm.dev`
  (dashboard), `docs.loopstorm.dev` (documentation).
- Set up email addresses: `contact@loopstorm.dev`,
  `security@loopstorm.dev`, `support@loopstorm.dev`.

**2. Create accounts with hosting providers.**
- **Supabase**: Create a production project. Copy the `DATABASE_URL`,
  `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
- **Cloudflare**: Create an account. Generate an API token with Workers
  permissions. Note the account ID.
- **Vercel**: Create an account and project for the web UI. Note the
  `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.
- **Anthropic**: Create an account. Generate an API key for the supervisor.
- **Google Cloud Console**: Create an OAuth client for "Sign in with Google"
  on your dashboard. Note the client ID and secret.

**3. Configure GitHub repository secrets.**
Go to your GitHub repository > Settings > Secrets and variables > Actions.
Add these repository secrets:

| Secret Name | Value Source |
|-------------|-------------|
| `PYPI_TOKEN` | PyPI account > API tokens > Create |
| `NPM_TOKEN` | npm account > Access Tokens > Create (automation) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard > API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard > Account ID |
| `VERCEL_TOKEN` | Vercel dashboard > Settings > Tokens |
| `VERCEL_ORG_ID` | Vercel dashboard > Settings > General |
| `VERCEL_PROJECT_ID` | Vercel dashboard > Project > Settings > General |
| `DATABASE_URL` | Supabase dashboard > Settings > Database > Connection string |

### Phase 2: Deploy (Week 2-3)

**4. Create PyPI and npm accounts.**
- PyPI: Register at pypi.org. Create a project-scoped API token for the
  `loopstorm` package.
- npm: Register at npmjs.com. Create an organization `@loopstorm`. Create
  an automation token scoped to `@loopstorm/*`.

**5. Publish SDK packages.**
- Tag a release: `git tag v1.1.0 && git push origin v1.1.0`.
- Verify the release workflow creates the GitHub Release with binaries.
- Verify the Python shim is published to PyPI.
- Verify the TypeScript shim is published to npm.
- Test installation: `pip install loopstorm`, `bun add @loopstorm/shim-ts`.

**6. Fix deployment blockers (from the production readiness audit).**
- Create `wrangler.toml` in `packages/backend/` for Cloudflare Workers
  deployment.
- Configure email transport in Better Auth (Resend or SendGrid adapter).
- Configure `vercel.json` in `packages/web/`.
- Run database migrations against the production Supabase instance.
- Create the `loopstorm_ingest` and `loopstorm_supervisor` database roles.
- Set all production environment variables in Cloudflare and Vercel.

### Phase 3: Payments (Week 3-5)

**7. Set up Stripe.**
- Create a Stripe account at stripe.com.
- Create products and prices:
  - "Pro" plan: $49/month (or your chosen price).
  - "Enterprise" plan: custom pricing (contact sales).
- Generate API keys (publishable key + secret key).
- Set up a webhook endpoint at `https://api.loopstorm.dev/api/stripe/webhook`.
- Add Stripe secrets to your backend's environment variables:
  - `STRIPE_SECRET_KEY` -- for server-side Stripe API calls.
  - `STRIPE_WEBHOOK_SECRET` -- for verifying webhook signatures.
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` -- for the frontend checkout.

**8. Build the billing integration.**
- Add a `subscriptions` table to the database schema.
- Build tRPC procedures for creating checkout sessions, managing
  subscriptions, and handling webhooks.
- Add middleware to enforce plan limits (event volume, team seats).
- Wire the pricing page's "Start Free Trial" button to Stripe Checkout.

### Phase 4: Legal (Week 3-4, parallel with Phase 3)

**9. Create legal documents.**
- **Terms of Service**: Covers acceptable use, data processing, liability.
- **Privacy Policy**: GDPR-compliant data handling description.
- **Data Processing Agreement (DPA)**: For enterprise customers.
- **Commercial License Agreement**: For Mode 1 (self-hosted) customers who
  want to avoid AGPL obligations.
- **Contributor License Agreement (CLA)**: For open-source contributors.
  Allows you to dual-license AGPL contributions under a commercial license.

Consider using a service like Termly, iubenda, or a startup lawyer for
these. Template-based approaches cost $200-500. Custom legal review costs
$2,000-5,000 but is recommended for the commercial license agreement.

### Phase 5: Launch (Week 5-6)

**10. Go-to-market.**
- Publish a launch blog post explaining the five-stage control model.
- Submit to Hacker News, Reddit r/MachineLearning, r/LocalLLaMA.
- Create a Twitter/X account and LinkedIn page.
- Write integration guides for popular agent frameworks (LangChain,
  CrewAI, AutoGen, Claude Code).
- Set up a Discord or Slack community for users.

---

## Summary

The business model works because the code and the service are different
things. Publishing the code builds trust, drives adoption, and creates a
community. The service -- hosting, uptime, support, AI analysis, and the
vendor relationship -- is what customers pay for. AGPL on the commercial
components prevents competitors from freeloading on your backend and UI
without contributing back. MIT on the enforcement core ensures maximum
adoption of the standard you are building.

Your competitive moat is not secrecy. It is velocity, trust, data gravity,
brand, and the operational burden of running infrastructure. Every month
you ship features, gain customers, and accumulate cross-customer
intelligence, the moat deepens -- regardless of how many people read your
source code.

```
CODE (public)     +  SECRETS (private)     =  RUNNING SERVICE (your business)
GitHub repo          Environment variables     Customers pay for this
Anyone can read      Only you have them        Only you can provide it
```
