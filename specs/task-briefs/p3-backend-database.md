<!-- SPDX-License-Identifier: MIT -->
# Task Brief: P3 -- Backend + Database

**Priority:** P3
**Assignee:** `backend-senior-engineer` agent
**Branch:** `feat/p3-backend-database` (from `main` at latest)
**Gate:** P3 Backend Architecture -- RESOLVED by this document
**Blocked by:** P0 Engine Core (merged), P1 Python Shim (merged), P2 CLI E2E (in progress, no dependency)
**Blocks:** P4 Web Dashboard, OSS release checklist items related to hosted tier
**Date:** 2026-03-18

---

## 1. Objective

Deliver the complete backend for the LoopStorm Guard hosted control plane:
Drizzle ORM database schema with RLS, Better Auth integration, tRPC router,
and the JSONL event ingest pipeline.

After this PR:

1. Users can register (email+password, Google OAuth) and log in via Better Auth.
2. SDK instances can authenticate via API keys and ingest JSONL events in batches.
3. The web dashboard API (tRPC) can list runs, get run events, manage policies,
   and manage supervisor proposals/escalations.
4. All data is tenant-isolated via Supabase RLS using `tenant_id` from JWT claims.
5. Server-side hash chain verification is available for ingested audit trails.

---

## 2. Constraints

| # | Constraint | Source |
|---|---|---|
| C1 | **AGPL-3.0-only** -- every `.ts` file in `packages/backend/` gets `// SPDX-License-Identifier: AGPL-3.0-only` | ADR-013 |
| C2 | **Better Auth ONLY** -- never Supabase Auth / GoTrue. All auth flows through Better Auth | ADR-011 |
| C3 | **Supabase PostgreSQL** as the database -- but auth logic is in Better Auth, not Supabase Auth | ADR-011 |
| C4 | **Bun runtime** -- never Node.js. Use `bun test` for testing | Tech stack |
| C5 | **Hono framework** -- existing scaffold at `packages/backend/src/index.ts` | Codebase |
| C6 | **Drizzle ORM** -- schema definitions, queries, migrations. Use `postgres` driver | package.json |
| C7 | **tRPC v11** with `@hono/trpc-server` -- type-safe procedures | package.json |
| C8 | **zod** for input validation on all tRPC procedures | package.json |
| C9 | **`@loopstorm/schemas`** (MIT) -- import types from this package. Never duplicate type definitions | ADR-013 |
| C10 | **Biome** for linting/formatting -- 2-space indentation, no tabs | CI config |
| C11 | **Mode 0 irrelevant** -- the backend is a hosted-tier component (Mode 2/3). It does not need to work air-gapped | Product doc |
| C12 | **Enforcement/observation plane separation** -- the backend is on the observation plane. It reads audit data; it never intercepts or modifies enforcement decisions | ADR-012 |
| C13 | **`escalate_to_human` can never be blocked** -- the supervisor proposal/escalation endpoints must always be writable | ADR-012 |

---

## 3. Architectural Decisions

### AD-P3-1: Drizzle ORM with `postgres` Driver (Not `pg`)

**Decision**: Use the `postgres` package (already in `package.json`) as the
Drizzle driver, via `drizzle-orm/postgres-js`. This is the recommended driver
for Bun + Supabase PostgreSQL.

**Rationale**: The `postgres` package (also known as `postgres.js` or
`postgresjs`) is a modern, Promise-based PostgreSQL client that works natively
with Bun. It is faster than `pg` (node-postgres) and does not require
native bindings.

### AD-P3-2: Tenant Isolation via `tenant_id` Column + RLS

**Decision**: Every data table has a `tenant_id` column (UUID, NOT NULL).
Supabase RLS policies filter rows by matching `tenant_id` against the JWT
claim. The backend sets the JWT claim on each connection using
`SET LOCAL request.jwt.claims`.

**Rationale**: RLS provides defense-in-depth. Even if the application layer
has a bug, the database will not return rows for the wrong tenant. This is
critical for a multi-tenant SaaS product.

**Implementation note**: Better Auth issues JWTs with a custom `tenant_id`
claim. The backend extracts this claim and sets it on the PostgreSQL
connection before executing queries. Drizzle's query builder is used for
all data access, but the RLS enforcement happens at the database level
regardless of what queries the application issues.

### AD-P3-3: API Key Authentication for SDK Ingest

**Decision**: SDK instances (engines, shims, CLI `import` command)
authenticate to the ingest endpoint using API keys. API keys are
SHA-256 hashed before storage. The raw key is shown to the user exactly
once at creation time.

**Rationale**: API keys are the standard mechanism for programmatic
authentication. SHA-256 hashing prevents key recovery from a database
breach. This follows the pattern established in ADR-011.

**Flow**:
1. User creates an API key in the web dashboard.
2. Backend generates a random key, hashes it, stores the hash + prefix.
3. The raw key is returned to the user once.
4. SDK includes the key in the `Authorization: Bearer <key>` header.
5. The ingest endpoint hashes the incoming key and looks up the matching row.
6. The `api_key` row contains `tenant_id`, granting the SDK tenant context.

### AD-P3-4: Batch Event Ingest with Server-Side Chain Verification

**Decision**: The ingest endpoint accepts an array of `LoopStormEvent`
objects. The server verifies the hash chain integrity of the batch before
inserting. If chain verification fails, the batch is rejected with a
400 error detailing the break position.

**Rationale**: Server-side chain verification catches tampering or
corruption during transit. The client (CLI `import` or shim batch upload)
sends events in chain order. The server verifies and stores atomically.

**Important**: The ingest endpoint verifies the chain within the batch
but does NOT re-verify against previously ingested events for the same
`run_id`. Partial uploads are supported: the first batch for a run starts
at seq=1 with hash_prev=null; subsequent batches must continue from where
the last batch ended. The server stores the `last_hash` and `last_seq`
on the `runs` table for continuation verification.

### AD-P3-5: Better Auth Session Plugin for `tenant_id` Claim

**Decision**: Use Better Auth's custom session plugin to inject
`tenant_id` into the JWT payload and session object. The tenant is
resolved from the user's `tenant_memberships` at login time.

**Rationale**: Better Auth supports custom session data through plugins.
This is the cleanest way to embed `tenant_id` in the JWT without forking
Better Auth.

### AD-P3-6: Supervisor Tables Are Observation Plane Only

**Decision**: The `supervisor_proposals` and `supervisor_escalations`
tables store proposals and escalations created by the AI Supervisor
(ADR-012). These tables are read/written by the backend API. They have
no connection to the enforcement engine's IPC channel.

**Rationale**: Enforcement/observation plane separation. The supervisor
creates proposals; humans approve/reject them via the API; approved
proposals are applied to policy files outside the backend (a separate
workflow). The backend stores the proposal and its approval state.

### AD-P3-7: `run_id` Is the Primary Key for Runs (Client-Generated)

**Decision**: The `run_id` (client-generated UUID v7, per ADR-004) is
the primary key of the `runs` table. The backend does not generate a
separate server-side ID for runs.

**Rationale**: The `run_id` is the canonical identifier across all
layers (engine, shim, CLI, backend, frontend). Using it as the primary
key avoids a mapping layer. UUID v7 is time-ordered, so it is efficient
as a B-tree primary key.

**Conflict handling**: If a duplicate `run_id` is inserted (same tenant),
the insert is idempotent (ON CONFLICT DO NOTHING on the initial run
metadata). Events are appended via the ingest endpoint.

### AD-P3-8: No Anthropic SDK Usage in P3

**Decision**: The `@anthropic-ai/sdk` dependency in `package.json` is
for the AI Supervisor (P5/Mode 3). It is NOT used in P3. Do not import
it in any P3 code.

**Rationale**: The supervisor is a future feature. Including it in P3
would blur the enforcement/observation plane boundary and add unnecessary
complexity.

---

## 4. Database Schema (Drizzle ORM)

All tables live in the `public` schema. Drizzle table definitions go in
`packages/backend/src/db/schema.ts`.

### 4.1 `tenants`

Multi-tenant isolation root. Every data row traces back to a tenant.

```typescript
import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("free"), // "free" | "pro" | "enterprise"
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### 4.2 `users`

Better Auth manages user creation. This table is Better Auth's user store
(configured via `drizzleAdapter`). The columns here are the minimum Better
Auth requires plus our custom `tenant_id` foreign key.

**IMPORTANT**: Better Auth expects specific column names. The exact schema
depends on the Better Auth version. Use `betterAuth.api.getSchema()` or
check Better Auth docs for the canonical column list. The columns below
are the expected set for v1.2.x:

```typescript
export const users = pgTable("users", {
  id: text("id").primaryKey(), // Better Auth generates string IDs
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  email_verified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  tenant_id: uuid("tenant_id").notNull().references(() => tenants.id),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Note**: Better Auth also needs `sessions` and `accounts` tables. These
should be generated by Better Auth's Drizzle adapter or defined to match
Better Auth's expected schema. Check the Better Auth Drizzle adapter
documentation and define them accordingly. The session table must include
a `tenant_id` column for our custom session plugin.

```typescript
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  ip_address: text("ip_address"),
  user_agent: text("user_agent"),
  tenant_id: uuid("tenant_id").notNull().references(() => tenants.id),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => users.id),
  account_id: text("account_id").notNull(),
  provider_id: text("provider_id").notNull(),
  access_token: text("access_token"),
  refresh_token: text("refresh_token"),
  access_token_expires_at: timestamp("access_token_expires_at", { withTimezone: true }),
  refresh_token_expires_at: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  id_token: text("id_token"),
  password: text("password"), // hashed, for email+password auth
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**CRITICAL**: The exact Better Auth table schemas MUST be verified against
the Better Auth documentation for the version in `package.json` (v1.2.5).
The columns above are based on the Better Auth Drizzle adapter docs. If
the actual adapter expects different columns, use the adapter's schema.
Better Auth provides a `generate` CLI command that can output the expected
schema -- use that as the ground truth.

### 4.3 `api_keys`

SDK authentication. The raw key is never stored.

```typescript
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenant_id: uuid("tenant_id").notNull().references(() => tenants.id),
  user_id: text("user_id").notNull().references(() => users.id), // who created it
  name: text("name").notNull(), // human-readable label, e.g. "prod-agent-1"
  key_prefix: text("key_prefix").notNull(), // first 8 chars for identification, e.g. "lsg_xxxx"
  key_hash: text("key_hash").notNull(), // SHA-256 hex of the full key
  scopes: text("scopes").array().notNull().default([]), // e.g. ["ingest", "read"]
  last_used_at: timestamp("last_used_at", { withTimezone: true }),
  expires_at: timestamp("expires_at", { withTimezone: true }), // null = no expiry
  is_revoked: boolean("is_revoked").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Key generation format**: `lsg_` + 32 random hex characters = 36-char key.
Example: `lsg_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4`.

### 4.4 `runs`

Agent runs, keyed by the client-generated `run_id` (ADR-004).

```typescript
export const runs = pgTable("runs", {
  run_id: uuid("run_id").primaryKey(), // client-generated UUID v7 (ADR-004)
  tenant_id: uuid("tenant_id").notNull().references(() => tenants.id),
  agent_name: text("agent_name"),
  agent_role: text("agent_role"),
  environment: text("environment"),
  policy_pack_id: text("policy_pack_id"),
  status: text("status").notNull().default("started"),
    // "started" | "completed" | "terminated_budget" | "terminated_loop"
    // | "terminated_policy" | "abandoned" | "error"
  event_count: integer("event_count").notNull().default(0),
  last_seq: integer("last_seq").notNull().default(0),
  last_hash: text("last_hash"), // SHA-256 of last ingested line, for continuation
  total_cost_usd: doublePrecision("total_cost_usd").notNull().default(0),
  total_input_tokens: integer("total_input_tokens").notNull().default(0),
  total_output_tokens: integer("total_output_tokens").notNull().default(0),
  total_call_count: integer("total_call_count").notNull().default(0),
  started_at: timestamp("started_at", { withTimezone: true }),
  ended_at: timestamp("ended_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Index**: `(tenant_id, created_at DESC)` for the runs list query.

### 4.5 `events`

Individual audit events. Foreign key to `runs`.

```typescript
import { pgTable, uuid, text, timestamp, integer, doublePrecision, jsonb, index } from "drizzle-orm/pg-core";

export const events = pgTable("events", {
  id: uuid("id").defaultRandom().primaryKey(), // server-generated, for RLS + pagination
  run_id: uuid("run_id").notNull().references(() => runs.run_id),
  tenant_id: uuid("tenant_id").notNull().references(() => tenants.id),
  schema_version: integer("schema_version").notNull(),
  event_type: text("event_type").notNull(),
  seq: integer("seq").notNull(),
  hash: text("hash").notNull(),
  hash_prev: text("hash_prev"), // null for first event
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  agent_name: text("agent_name"),
  agent_role: text("agent_role"),
  tool: text("tool"),
  args_hash: text("args_hash"),
  args_redacted: jsonb("args_redacted"),
  decision: text("decision"),
  rule_id: text("rule_id"),
  reason: text("reason"),
  model: text("model"),
  input_tokens: integer("input_tokens"),
  output_tokens: integer("output_tokens"),
  estimated_cost_usd: doublePrecision("estimated_cost_usd"),
  latency_ms: doublePrecision("latency_ms"),
  policy_pack_id: text("policy_pack_id"),
  environment: text("environment"),
  run_status: text("run_status"),
  dimension: text("dimension"),
  loop_rule: text("loop_rule"),
  loop_action: text("loop_action"),
  cooldown_ms: integer("cooldown_ms"),
  budget: jsonb("budget"),
  // Supervisor-specific fields
  supervisor_run_id: text("supervisor_run_id"),
  trigger: text("trigger"),
  trigger_run_id: text("trigger_run_id"),
  proposal_id: text("proposal_id"),
  proposal_type: text("proposal_type"),
  target_agent: text("target_agent"),
  rationale: text("rationale"),
  confidence: doublePrecision("confidence"),
  supporting_runs: text("supporting_runs").array(),
  status: text("status"),
  escalation_id: text("escalation_id"),
  severity: text("severity"),
  recommendation: text("recommendation"),
  timeout_seconds: integer("timeout_seconds"),
  timeout_action: text("timeout_action"),
  raw_line: text("raw_line"), // original JSONL line for chain re-verification
}, (table) => [
  index("events_run_id_seq_idx").on(table.run_id, table.seq),
  index("events_tenant_id_ts_idx").on(table.tenant_id, table.ts),
  index("events_event_type_idx").on(table.event_type),
]);
```

**Design note**: The `raw_line` column stores the original JSONL line as
ingested. This enables server-side chain re-verification without
reconstructing the serialization. It is nullable for events created
server-side (e.g., supervisor events in the future).

**Unique constraint**: `(run_id, seq)` must be unique. This prevents
duplicate event ingestion.

### 4.6 `supervisor_proposals`

Proposals created by the AI Supervisor requiring human approval.

```typescript
export const supervisorProposals = pgTable("supervisor_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenant_id: uuid("tenant_id").notNull().references(() => tenants.id),
  proposal_id: text("proposal_id").notNull().unique(), // from event schema
  supervisor_run_id: text("supervisor_run_id").notNull(),
  trigger_run_id: text("trigger_run_id"), // the run that triggered the supervisor
  proposal_type: text("proposal_type").notNull(),
    // "budget_adjustment" | "policy_change" | "agent_profile_update" | "flag_for_review"
  target_agent: text("target_agent"),
  rationale: text("rationale").notNull(),
  confidence: doublePrecision("confidence"),
  supporting_runs: text("supporting_runs").array(),
  proposed_changes: jsonb("proposed_changes"), // the actual proposed diff/values
  status: text("status").notNull().default("pending"),
    // "pending" | "approved" | "rejected" | "expired"
  reviewed_by: text("reviewed_by").references(() => users.id),
  reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
  review_notes: text("review_notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### 4.7 `supervisor_escalations`

Escalations raised by the AI Supervisor for human attention.

```typescript
export const supervisorEscalations = pgTable("supervisor_escalations", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenant_id: uuid("tenant_id").notNull().references(() => tenants.id),
  escalation_id: text("escalation_id").notNull().unique(), // from event schema
  supervisor_run_id: text("supervisor_run_id").notNull(),
  trigger_run_id: text("trigger_run_id"),
  severity: text("severity").notNull(), // "low" | "medium" | "high" | "critical"
  rationale: text("rationale").notNull(),
  recommendation: text("recommendation"),
  confidence: doublePrecision("confidence"),
  supporting_runs: text("supporting_runs").array(),
  timeout_seconds: integer("timeout_seconds"),
  timeout_action: text("timeout_action"),
  status: text("status").notNull().default("open"),
    // "open" | "acknowledged" | "resolved" | "expired"
  acknowledged_by: text("acknowledged_by").references(() => users.id),
  acknowledged_at: timestamp("acknowledged_at", { withTimezone: true }),
  resolution_notes: text("resolution_notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### 4.8 `policy_packs`

Stored policy packs for the hosted tier. These are the policies managed
via the web UI, not the local YAML files used in Mode 0.

```typescript
export const policyPacks = pgTable("policy_packs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenant_id: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description"),
  agent_role: text("agent_role"),
  environment: text("environment"),
  content: jsonb("content").notNull(), // the full policy pack as JSON
  schema_version: integer("schema_version").notNull().default(1),
  is_active: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(1), // optimistic concurrency
  created_by: text("created_by").references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Validation**: The `content` field must validate against
`schemas/policy/policy.schema.json` before insert/update. This validation
is done in the tRPC procedure, not in the database.

---

## 5. Row Level Security (RLS) Policies

All tables with a `tenant_id` column get RLS policies. RLS is enforced
at the Supabase PostgreSQL level.

### 5.1 RLS Setup Strategy

The backend sets the tenant context on each request using a PostgreSQL
session variable:

```sql
-- Set by the backend on each connection/transaction
SET LOCAL request.jwt.claims = '{"tenant_id": "uuid-here"}';
```

Then RLS policies reference this variable:

```sql
-- Example RLS policy for the runs table
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON runs
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
  WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
```

### 5.2 Tables Requiring RLS

| Table | RLS Policy |
|---|---|
| `runs` | `tenant_id = jwt.tenant_id` |
| `events` | `tenant_id = jwt.tenant_id` |
| `api_keys` | `tenant_id = jwt.tenant_id` |
| `supervisor_proposals` | `tenant_id = jwt.tenant_id` |
| `supervisor_escalations` | `tenant_id = jwt.tenant_id` |
| `policy_packs` | `tenant_id = jwt.tenant_id` |

The `tenants`, `users`, `sessions`, `accounts`, and `verifications` tables
do NOT use the same RLS pattern. Better Auth manages those tables through
its own adapter. For `tenants`, access is controlled at the application
layer (users can only see their own tenant).

### 5.3 Migration File

RLS policies are created in a Drizzle migration file. Since Drizzle does
not natively generate RLS policies, they are added as raw SQL in a custom
migration:

```
packages/backend/drizzle/0001_create_tables.sql    -- generated by drizzle-kit
packages/backend/drizzle/0002_enable_rls.sql       -- hand-written RLS policies
```

### 5.4 Service Role Bypass

The backend connects to Supabase using the `service_role` key for
operations that need to bypass RLS (e.g., creating tenants during
registration). For tenant-scoped queries, the backend sets the JWT claim
before querying so RLS is enforced.

**Implementation pattern**:

```typescript
// In the tRPC context middleware
async function withTenantContext(tenantId: string) {
  await db.execute(
    sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ tenant_id: tenantId })}, true)`
  );
}
```

The `true` parameter to `set_config` makes it local to the current
transaction, which is what we want.

---

## 6. Better Auth Setup

### 6.1 Configuration

Create `packages/backend/src/auth.ts`:

```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/client";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  session: {
    // Custom session data: inject tenant_id
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  // Additional config as needed by Better Auth v1.2.5
});
```

### 6.2 Better Auth Route Mounting

Mount Better Auth's route handler in Hono:

```typescript
// In index.ts
import { auth } from "./auth";

app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});
```

### 6.3 Tenant-Aware Registration Flow

When a new user registers:

1. Better Auth creates the user row.
2. A Drizzle `afterCreate` hook (or a separate registration endpoint)
   creates a new tenant and sets `user.tenant_id`.
3. For invite flows (v2), the user joins an existing tenant.

For P3 v1: every new user creates a new tenant. Multi-user tenants are
deferred to v2.

### 6.4 Session Middleware for tRPC

Create a middleware that extracts the authenticated user and tenant from
the Better Auth session:

```typescript
// packages/backend/src/middleware/auth.ts
import { auth } from "../auth";
import { TRPCError } from "@trpc/server";

export async function getSession(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  if (!session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return session;
}
```

### 6.5 API Key Authentication Middleware

For SDK ingest endpoints, authentication is via API key, not session:

```typescript
// packages/backend/src/middleware/api-key.ts
import { createHash } from "crypto";
import { db } from "../db/client";
import { apiKeys } from "../db/schema";
import { eq, and } from "drizzle-orm";

export async function authenticateApiKey(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const key = authHeader.slice(7);
  const keyHash = createHash("sha256").update(key).digest("hex");

  const [apiKey] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.key_hash, keyHash), eq(apiKeys.is_revoked, false)))
    .limit(1);

  if (!apiKey) return null;
  if (apiKey.expires_at && apiKey.expires_at < new Date()) return null;

  // Update last_used_at (fire and forget)
  db.update(apiKeys)
    .set({ last_used_at: new Date() })
    .where(eq(apiKeys.id, apiKey.id))
    .execute()
    .catch(() => {}); // non-critical

  return { tenant_id: apiKey.tenant_id, api_key_id: apiKey.id };
}
```

---

## 7. tRPC Router

### 7.1 Router Structure

```
packages/backend/src/
  trpc/
    router.ts          -- root router (merges sub-routers)
    context.ts         -- tRPC context creation
    trpc.ts            -- tRPC instance + middleware (auth, tenant)
    routers/
      runs.ts          -- runs.list, runs.get, runs.getEvents
      events.ts        -- events.ingest
      policies.ts      -- policies.list, policies.get, policies.create, policies.update
      supervisor.ts    -- supervisor.listProposals, supervisor.approveProposal, etc.
      verify.ts        -- verify.chain
      apiKeys.ts       -- apiKeys.create, apiKeys.list, apiKeys.revoke
```

### 7.2 Context

```typescript
// packages/backend/src/trpc/context.ts
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

export interface Context {
  request: Request;
  userId: string | null;
  tenantId: string | null;
}

export function createContext({ req }: FetchCreateContextFnOptions): Context {
  return {
    request: req,
    userId: null,
    tenantId: null,
  };
}

export type TRPCContext = Context;
```

### 7.3 tRPC Instance + Middleware

```typescript
// packages/backend/src/trpc/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import type { TRPCContext } from "./context";
import { getSession } from "../middleware/auth";
import { db } from "../db/client";
import { sql } from "drizzle-orm";

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Authenticated procedure: requires session, sets tenant context
const authMiddleware = t.middleware(async ({ ctx, next }) => {
  const session = await getSession(ctx.request);
  const tenantId = session.user.tenant_id; // custom claim

  if (!tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant associated" });
  }

  // Set RLS context
  await db.execute(
    sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ tenant_id: tenantId })}, true)`
  );

  return next({
    ctx: {
      ...ctx,
      userId: session.user.id,
      tenantId,
    },
  });
});

export const protectedProcedure = t.procedure.use(authMiddleware);
```

### 7.4 Procedure Definitions

#### 7.4.1 `runs.list`

```typescript
// Input
z.object({
  cursor: z.string().uuid().optional(),     // run_id for cursor-based pagination
  limit: z.number().int().min(1).max(100).default(50),
  status: z.enum(["started", "completed", "terminated_budget",
    "terminated_loop", "terminated_policy", "abandoned", "error"]).optional(),
  agent_role: z.string().optional(),
  environment: z.string().optional(),
})
// Output: { items: Run[], nextCursor: string | null }
```

#### 7.4.2 `runs.get`

```typescript
// Input
z.object({
  run_id: z.string().uuid(),
})
// Output: Run (full run details including summary stats)
```

#### 7.4.3 `runs.getEvents`

```typescript
// Input
z.object({
  run_id: z.string().uuid(),
  cursor: z.number().int().optional(), // seq number for pagination
  limit: z.number().int().min(1).max(500).default(100),
  event_type: z.enum([
    "run_started", "policy_decision", "budget_update",
    "budget_soft_cap_warning", "budget_exceeded", "loop_detected",
    "run_ended", "system_event", "supervisor_run_started",
    "supervisor_tool_call", "supervisor_proposal_created",
    "supervisor_escalation_created",
  ]).optional(),
})
// Output: { items: Event[], nextCursor: number | null }
```

#### 7.4.4 `events.ingest`

This is the critical ingestion endpoint. It uses API key auth, not session auth.

```typescript
// Input
z.object({
  run_id: z.string().uuid(),
  events: z.array(z.object({
    schema_version: z.literal(1),
    event_type: z.string(),
    run_id: z.string().uuid(),
    seq: z.number().int().min(1),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    hash_prev: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    ts: z.string().datetime(),
    // ... all optional fields from event.schema.json
    // Use z.passthrough() or explicit optional fields
  })).min(1).max(1000), // batch limit: 1000 events
  raw_lines: z.array(z.string()).optional(), // original JSONL lines for chain verification
})
// Output: { ingested: number, run_id: string }
```

**Authentication**: This endpoint uses `authenticateApiKey()` middleware
instead of `getSession()`. The API key provides the `tenant_id`.

**Chain verification**: If `raw_lines` is provided, the server verifies:
1. Each raw line parses to a JSON object matching the corresponding event.
2. For events after the first: `hash_prev` equals SHA-256 of the previous raw line.
3. For each event: `hash` equals SHA-256 of the event without `hash` and `hash_prev`.

If `raw_lines` is NOT provided, chain verification is best-effort (verify
`hash_prev` chain using re-serialized JSON, which may differ from the
original line bytes).

**Continuation**: If the run already has events, the first event in the
batch must have `seq = last_seq + 1` and (if `raw_lines` is provided)
`hash_prev` must match the stored `last_hash`.

#### 7.4.5 `policies.list`

```typescript
// Input
z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  is_active: z.boolean().optional(),
  agent_role: z.string().optional(),
})
// Output: { items: PolicyPack[], nextCursor: string | null }
```

#### 7.4.6 `policies.get`

```typescript
// Input
z.object({
  id: z.string().uuid(),
})
// Output: PolicyPack
```

#### 7.4.7 `policies.create`

```typescript
// Input
z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  agent_role: z.string().optional(),
  environment: z.string().optional(),
  content: z.record(z.unknown()), // validated against policy schema in handler
})
// Output: { id: string }
```

**Validation**: The `content` field is validated against
`policy.schema.json` using a JSON schema validator (e.g., `ajv` or a
custom zod schema that mirrors the policy schema). If validation fails,
return a 400 with details.

**`escalate_to_human` invariant**: The handler MUST verify that no rule
in the policy content has `action: "deny"` with `tool: "escalate_to_human"`
or `tool_pattern` that would match `escalate_to_human`. If such a rule
exists, reject the policy with a clear error. This enforces ADR-012.

#### 7.4.8 `policies.update`

```typescript
// Input
z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  agent_role: z.string().optional(),
  environment: z.string().optional(),
  content: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
  version: z.number().int(), // optimistic concurrency: must match current version
})
// Output: { id: string, version: number }
```

**Optimistic concurrency**: The update WHERE clause includes
`version = input.version`. If no row is updated, return a conflict error.
On success, increment `version`.

#### 7.4.9 `supervisor.listProposals`

```typescript
// Input
z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
})
// Output: { items: SupervisorProposal[], nextCursor: string | null }
```

#### 7.4.10 `supervisor.approveProposal`

```typescript
// Input
z.object({
  id: z.string().uuid(),
  notes: z.string().max(2000).optional(),
})
// Output: { id: string, status: "approved" }
```

**Side effect**: Sets `status = "approved"`, `reviewed_by = ctx.userId`,
`reviewed_at = now()`, `review_notes = input.notes`.

**Guard**: Only `pending` proposals can be approved. Return error otherwise.

#### 7.4.11 `supervisor.rejectProposal`

```typescript
// Input
z.object({
  id: z.string().uuid(),
  notes: z.string().max(2000).optional(),
})
// Output: { id: string, status: "rejected" }
```

Same guards as `approveProposal`.

#### 7.4.12 `supervisor.listEscalations`

```typescript
// Input
z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  status: z.enum(["open", "acknowledged", "resolved", "expired"]).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
})
// Output: { items: SupervisorEscalation[], nextCursor: string | null }
```

#### 7.4.13 `supervisor.acknowledgeEscalation`

```typescript
// Input
z.object({
  id: z.string().uuid(),
  notes: z.string().max(2000).optional(),
})
// Output: { id: string, status: "acknowledged" }
```

**Guard**: Only `open` escalations can be acknowledged.

#### 7.4.14 `verify.chain`

Server-side hash chain verification for a stored run.

```typescript
// Input
z.object({
  run_id: z.string().uuid(),
})
// Output: { valid: boolean, event_count: number, break_at_seq?: number, error?: string }
```

**Implementation**: Reads all events for the run ordered by `seq`, then
re-verifies the chain using `raw_line` if available. If `raw_line` is not
available, attempts re-verification by re-serializing events (with caveat
that floating-point or field-ordering differences may cause false negatives).

#### 7.4.15 `apiKeys.create`

```typescript
// Input
z.object({
  name: z.string().min(1).max(255),
  scopes: z.array(z.enum(["ingest", "read"])).min(1),
  expires_in_days: z.number().int().min(1).max(365).optional(), // null = no expiry
})
// Output: { id: string, key: string, key_prefix: string }
// NOTE: `key` is the raw key, shown ONCE. Never returned again.
```

#### 7.4.16 `apiKeys.list`

```typescript
// Input
z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
})
// Output: { items: ApiKeyInfo[], nextCursor: string | null }
// ApiKeyInfo includes: id, name, key_prefix, scopes, last_used_at,
//   expires_at, is_revoked, created_at. NEVER includes key_hash or raw key.
```

#### 7.4.17 `apiKeys.revoke`

```typescript
// Input
z.object({
  id: z.string().uuid(),
})
// Output: { id: string, is_revoked: true }
```

---

## 8. Ingest Pipeline

### 8.1 Flow

```
[Engine JSONL] ---> [CLI `import`] ---> [POST /api/trpc/events.ingest]
                                              |
[Python Shim]  ---> [batch upload]  ----------+
                                              |
                                              v
                                    [API Key Auth Middleware]
                                              |
                                              v
                                    [Chain Verification]
                                              |
                                              v
                                    [Insert events + update run]
                                              |
                                              v
                                    [Supabase PostgreSQL]
```

### 8.2 Ingest Endpoint (Non-tRPC)

The ingest endpoint SHOULD be a tRPC mutation for type safety with the
web dashboard. However, it also needs to be callable from the CLI and
SDK using simple HTTP + API key auth.

**Resolution**: Implement as a tRPC mutation (`events.ingest`) that uses
a special middleware for API key auth when no session is present. The
middleware checks:

1. Session cookie present? Use session auth (web dashboard upload).
2. `Authorization: Bearer` header? Use API key auth (SDK/CLI upload).
3. Neither? Return 401.

### 8.3 Transaction Semantics

Event ingestion is atomic per batch:

1. Start a transaction.
2. Verify chain integrity.
3. Upsert the run row (create if not exists, update counters if exists).
4. Bulk insert all events.
5. Update `runs.last_seq`, `runs.last_hash`, `runs.event_count`, and
   accumulator fields (`total_cost_usd`, etc.).
6. If any step fails, roll back the entire batch.
7. Commit.

### 8.4 Run Status Extraction

The ingest pipeline inspects events to update `runs.status`:

- If any event has `event_type = "run_ended"`, extract `run_status` and
  set it on the run.
- If any event has `event_type = "run_started"`, set `runs.started_at`
  from the event's `ts`.
- The `ended_at` is set from the `run_ended` event's `ts`.

### 8.5 Batch Size Limits

- Maximum 1000 events per batch.
- Maximum 10 MB payload size (enforced by Hono body size middleware).
- If the client has more than 1000 events, it must send multiple batches.

---

## 9. File Manifest

### 9.1 New Files

```
packages/backend/
  drizzle.config.ts                          # Drizzle Kit configuration
  src/
    db/
      client.ts                              # PostgreSQL connection + Drizzle instance
      schema.ts                              # All Drizzle table definitions
      migrate.ts                             # Migration runner (for CI/startup)
    auth.ts                                  # Better Auth configuration
    middleware/
      auth.ts                                # Session auth middleware
      api-key.ts                             # API key auth middleware
      tenant.ts                              # Tenant RLS context setter
    trpc/
      trpc.ts                                # tRPC instance, middleware, procedures
      context.ts                             # tRPC context type + factory
      router.ts                              # Root router (merges sub-routers)
      routers/
        runs.ts                              # runs.list, runs.get, runs.getEvents
        events.ts                            # events.ingest
        policies.ts                          # policies.list/get/create/update
        supervisor.ts                        # supervisor proposals + escalations
        verify.ts                            # verify.chain
        api-keys.ts                          # apiKeys.create/list/revoke
    lib/
      chain-verify.ts                        # Server-side hash chain verification
      policy-validate.ts                     # Policy content validation (schema + escalate_to_human invariant)
      api-key-gen.ts                         # API key generation + hashing
    env.ts                                   # Environment variable validation (zod)
  tests/
    setup.ts                                 # Test database setup/teardown
    db/
      schema.test.ts                         # Schema smoke tests
    trpc/
      runs.test.ts                           # Runs router tests
      events.test.ts                         # Ingest pipeline tests
      policies.test.ts                       # Policy CRUD tests
      supervisor.test.ts                     # Supervisor proposal/escalation tests
      verify.test.ts                         # Chain verification tests
      api-keys.test.ts                       # API key management tests
    middleware/
      auth.test.ts                           # Auth middleware tests
      api-key.test.ts                        # API key auth tests
    lib/
      chain-verify.test.ts                   # Chain verification unit tests
      policy-validate.test.ts                # Policy validation tests (incl. escalate_to_human)
    adversarial/
      rls.test.ts                            # Adversarial RLS isolation tests
  drizzle/                                   # Generated migrations directory
```

### 9.2 Modified Files

```
packages/backend/
  src/index.ts                               # MODIFIED: mount tRPC, Better Auth, health check with db ping
  package.json                               # MODIFIED: add any missing deps (see Section 10)
```

### 9.3 Dependency Direction Check

```
packages/backend/ (AGPL) --> packages/schemas/ (MIT)    OK
packages/backend/ (AGPL) --> better-auth (MIT)           OK
packages/backend/ (AGPL) --> drizzle-orm (Apache-2.0)    OK
packages/backend/ (AGPL) --> hono (MIT)                  OK
packages/backend/ (AGPL) --> @trpc/server (MIT)          OK
packages/backend/ (AGPL) --> zod (MIT)                   OK
packages/backend/ (AGPL) --> postgres (Unlicense)        OK
```

No MIT component depends on this AGPL package. Direction is correct.

---

## 10. Additional Dependencies

Check if these are needed beyond what is already in `package.json`:

| Package | Purpose | Status |
|---|---|---|
| `better-auth` | Auth framework | Already in deps |
| `drizzle-orm` | ORM | Already in deps |
| `postgres` | PostgreSQL driver | Already in deps |
| `@hono/trpc-server` | tRPC adapter for Hono | Already in deps |
| `@trpc/server` | tRPC core | Already in deps |
| `zod` | Validation | Already in deps |
| `drizzle-kit` | Migration tooling | Already in devDeps |
| `@anthropic-ai/sdk` | NOT USED IN P3 | Already in deps (for future P5) |

**Potentially needed**:

| Package | Purpose | Add? |
|---|---|---|
| `drizzle-zod` | Generate zod schemas from Drizzle tables | Optional, nice-to-have |
| `@hono/cors` | CORS middleware for web dashboard | Yes, add to deps |
| `superjson` | tRPC transformer for Date serialization | Evaluate: Dates may need proper handling |

The implementor should evaluate and add dependencies as needed, keeping
the total count minimal.

---

## 11. Environment Variables

Create `packages/backend/src/env.ts` with zod validation:

```typescript
import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(), // e.g., "https://api.loopstorm.dev"

  // OAuth (optional for local dev)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Server
  PORT: z.coerce.number().int().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = envSchema.parse(process.env);
```

---

## 12. `drizzle.config.ts`

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

Place at `packages/backend/drizzle.config.ts`.

---

## 13. Test Strategy

### 13.1 Unit Tests

| Test | What It Verifies |
|---|---|
| `chain-verify.test.ts` | Hash chain verification logic: valid chains pass, tampered chains fail at correct position, empty chains pass |
| `policy-validate.test.ts` | Policy content validation against schema. **Critical**: test that a policy with `action: deny, tool: escalate_to_human` is rejected |
| `api-key-gen.test.ts` | Key generation format (`lsg_` prefix), hash computation, prefix extraction |

### 13.2 tRPC Router Tests

Each router test file creates a test caller using `createCallerFactory`
with a mocked context (authenticated user, tenant). Tests use a real test
database (Supabase project or local PostgreSQL).

| Test File | Key Test Cases |
|---|---|
| `runs.test.ts` | List runs (empty, with data, with filters); get run by ID; get run events with pagination |
| `events.test.ts` | Ingest valid batch; reject batch with broken chain; reject batch with invalid schema_version; continuation from previous batch; idempotent run upsert; batch size limit enforced |
| `policies.test.ts` | Create policy; update policy with version check; optimistic concurrency conflict; reject policy with `escalate_to_human` deny rule |
| `supervisor.test.ts` | List proposals (filtered by status); approve pending proposal; reject pending proposal; cannot approve already-rejected proposal; list escalations; acknowledge escalation |
| `verify.test.ts` | Verify valid chain; verify chain with raw_lines; report break position |
| `api-keys.test.ts` | Create key (returns raw key once); list keys (no hash exposed); revoke key; revoked key fails auth |

### 13.3 Middleware Tests

| Test File | Key Test Cases |
|---|---|
| `auth.test.ts` | Valid session extracts userId + tenantId; missing session returns 401; expired session returns 401 |
| `api-key.test.ts` | Valid key returns tenantId; invalid key returns null; revoked key returns null; expired key returns null |

### 13.4 Adversarial RLS Tests

**These are the most critical security tests in P3.**

`adversarial/rls.test.ts` creates two tenants (Tenant A and Tenant B),
creates data for both, then verifies that queries scoped to Tenant A
cannot see Tenant B's data.

| Test | What It Verifies |
|---|---|
| `tenant_a_cannot_read_tenant_b_runs` | SELECT on runs table returns only Tenant A's runs when RLS context is Tenant A |
| `tenant_a_cannot_read_tenant_b_events` | SELECT on events table is tenant-isolated |
| `tenant_a_cannot_update_tenant_b_policy` | UPDATE on policy_packs fails for cross-tenant |
| `tenant_a_cannot_read_tenant_b_api_keys` | API keys are tenant-isolated |
| `tenant_a_cannot_read_tenant_b_proposals` | Supervisor proposals are tenant-isolated |
| `tenant_a_cannot_read_tenant_b_escalations` | Escalations are tenant-isolated |
| `tenant_a_cannot_insert_into_tenant_b_runs` | INSERT with wrong tenant_id fails via RLS WITH CHECK |

**Setup**: These tests connect to the database with the `anon` role (not
`service_role`) and set `request.jwt.claims` to simulate tenant context.
This tests the actual RLS policies, not application-layer filtering.

### 13.5 Test Database

Tests require a PostgreSQL instance. Options:

1. **Supabase local**: `supabase start` (Docker-based local Supabase).
2. **Direct PostgreSQL**: Any PostgreSQL 15+ instance.
3. **CI**: Use the `supabase/setup-cli` GitHub Action to start a local
   Supabase instance in CI.

The test setup script (`tests/setup.ts`) handles:
- Running migrations
- Creating test tenants
- Seeding test data
- Cleanup after each test suite

---

## 14. Health Check Update

Update the existing health check in `src/index.ts` to actually ping the database:

```typescript
app.get("/api/health", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", db: "ok" });
  } catch {
    return c.json({ status: "degraded", db: "error" }, 503);
  }
});
```

---

## 15. What NOT to Touch

- `apps/engine/` -- no changes
- `apps/cli/` -- no changes
- `apps/shim-python/` -- no changes
- `apps/shim-ts/` -- no changes
- `schemas/` -- no changes
- `packages/schemas/` -- no changes (import types only)
- `packages/web/` -- no changes
- `VERIFY.md` -- no changes
- `docs/adrs/` -- no changes

---

## 16. Acceptance Criteria

All must be true before merge:

### Auth
- [ ] Email+password registration creates a user + tenant
- [ ] Login returns a session with `tenant_id` claim
- [ ] Google OAuth flow works (or is correctly configured, testable in staging)
- [ ] API key creation returns a raw key once
- [ ] API key authentication resolves to the correct `tenant_id`
- [ ] Revoked API keys are rejected

### Database
- [ ] All 10 tables created via Drizzle migration
- [ ] RLS enabled on all tenant-scoped tables
- [ ] Adversarial RLS tests pass (cross-tenant reads fail)
- [ ] Indexes exist for primary query patterns

### tRPC
- [ ] `runs.list` returns paginated runs for the authenticated tenant
- [ ] `runs.get` returns a single run with summary stats
- [ ] `runs.getEvents` returns paginated events for a run
- [ ] `events.ingest` accepts and stores a batch of events
- [ ] `events.ingest` rejects batches with broken hash chains
- [ ] `events.ingest` supports continuation (appending to existing runs)
- [ ] `policies.create` validates content against policy schema
- [ ] `policies.create` rejects policies that deny `escalate_to_human`
- [ ] `policies.update` uses optimistic concurrency (version check)
- [ ] `supervisor.approveProposal` transitions pending -> approved
- [ ] `supervisor.rejectProposal` transitions pending -> rejected
- [ ] `supervisor.acknowledgeEscalation` transitions open -> acknowledged
- [ ] `verify.chain` returns correct result for valid and broken chains
- [ ] `apiKeys.create` returns raw key once, stores only the hash
- [ ] `apiKeys.list` never exposes key hash or raw key
- [ ] `apiKeys.revoke` marks key as revoked

### Quality
- [ ] Every `.ts` file in `packages/backend/` has `// SPDX-License-Identifier: AGPL-3.0-only`
- [ ] `bun test` passes all tests
- [ ] Biome lint + format passes (`biome check src/`)
- [ ] TypeScript strict mode passes (`tsc --noEmit`)
- [ ] No imports from AGPL packages in any MIT package
- [ ] Health check endpoint returns database status

### Security
- [ ] API keys are SHA-256 hashed before storage
- [ ] Raw API keys are never logged or returned after creation
- [ ] RLS policies enforce tenant isolation at the database level
- [ ] `escalate_to_human` deny invariant is enforced in policy validation
- [ ] No secrets in committed code (env vars for all credentials)

---

## 17. Sequencing Guidance

Recommended implementation order:

1. **`env.ts`** + **`drizzle.config.ts`** -- environment config, so
   nothing else fails on missing env vars.

2. **`db/schema.ts`** + **`db/client.ts`** -- Drizzle table definitions
   and database connection. Run `bun run db:generate` to create the
   initial migration.

3. **RLS migration** -- Write `0002_enable_rls.sql` by hand after the
   auto-generated table migration.

4. **`auth.ts`** + **`middleware/auth.ts`** -- Better Auth config and
   session middleware. Mount auth routes in `index.ts`. Verify
   registration and login work.

5. **`trpc/trpc.ts`** + **`trpc/context.ts`** -- tRPC instance with auth
   middleware. Mount tRPC in `index.ts`.

6. **`lib/api-key-gen.ts`** + **`middleware/api-key.ts`** -- API key
   generation, hashing, and auth middleware.

7. **`trpc/routers/api-keys.ts`** -- API key CRUD. Test that keys work
   for authentication.

8. **`lib/chain-verify.ts`** -- Hash chain verification logic (pure
   function, easy to unit test).

9. **`lib/policy-validate.ts`** -- Policy content validation including
   the `escalate_to_human` invariant check.

10. **`trpc/routers/events.ts`** -- The ingest pipeline. This is the most
    complex piece. Test with hand-crafted JSONL batches.

11. **`trpc/routers/runs.ts`** -- Run listing and detail queries.

12. **`trpc/routers/policies.ts`** -- Policy CRUD with validation.

13. **`trpc/routers/supervisor.ts`** -- Proposal and escalation management.

14. **`trpc/routers/verify.ts`** -- Server-side chain verification endpoint.

15. **`trpc/router.ts`** -- Merge all sub-routers into the root router.

16. **`index.ts`** -- Final wiring: tRPC mount, Better Auth mount, health
    check update, CORS.

17. **Adversarial RLS tests** -- Write last, after all tables and RLS
    policies are confirmed working.

---

## 18. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Better Auth v1.2.5 Drizzle adapter expects different columns than documented | Auth breaks at runtime | Use `betterAuth.api.getSchema()` or Better Auth CLI to generate the expected schema. Test registration + login early (step 4). |
| RLS policies misconfigured, allowing cross-tenant data access | Critical security vulnerability | Adversarial RLS test suite (Section 13.4). Run these tests in CI on every PR. |
| `set_config` for RLS context not scoped to transaction | Tenant context leaks between requests | Use `set_config(..., true)` (local = true) which scopes to the current transaction. Verify with concurrent-request test. |
| Chain verification re-serialization differs from engine's serde_json output | False negatives in chain verification | Store `raw_line` in the events table. Use raw_line for verification when available. Document the re-serialization limitation. |
| Drizzle migration ordering issues with RLS | Migration fails on fresh database | Run table creation migration before RLS migration. Test with `drizzle-kit migrate` on empty database. |
| `postgres` driver connection pooling under load | Connection exhaustion | Use `postgres`'s built-in connection pooling (`max: 10` default). Supabase also has PgBouncer. Monitor in production. |
| Optimistic concurrency on policy updates: race conditions | Stale version error on legitimate concurrent edits | Return clear error message ("Policy was modified by another user. Reload and try again."). Frontend handles this in P4. |
| API key hash lookup is a table scan | Slow auth for large key counts | Index on `key_hash` column. For v1 scale (< 10k keys), this is sufficient. |
| Batch ingest of 1000 events in a single transaction | Long-running transaction, potential lock contention | 1000 events is small for PostgreSQL. If this becomes an issue, reduce batch size or use COPY. |
| `@anthropic-ai/sdk` in package.json tempts usage in P3 | Premature supervisor integration | AD-P3-8 explicitly prohibits importing it. Review PR for any Anthropic SDK imports. |

---

## 19. References

- `packages/backend/src/index.ts` -- existing Hono scaffold
- `packages/backend/package.json` -- existing dependencies
- `packages/schemas/types/events.ts` -- `LoopStormEvent` type
- `packages/schemas/types/policy.ts` -- `PolicyPack` type
- `packages/schemas/types/ipc.ts` -- `DecisionRequest`/`DecisionResponse` types
- `schemas/events/event.schema.json` -- canonical event schema
- `schemas/policy/policy.schema.json` -- canonical policy schema
- `apps/engine/src/audit.rs` -- AuditWriter hash chain implementation (reference for chain verification)
- ADR-002: Fail-Closed Default
- ADR-004: Client-Generated run_id
- ADR-007: Multi-Dimensional Budget
- ADR-011: Better Auth
- ADR-012: AI Supervisor Architecture
- ADR-013: Open-Core Licensing
