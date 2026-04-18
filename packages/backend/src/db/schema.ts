// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Drizzle ORM table definitions for LoopStorm Guard.
 *
 * All tables with a `tenant_id` column are protected by PostgreSQL RLS
 * policies (defined in drizzle/0002_enable_rls.sql). The RLS policies
 * filter rows by matching `tenant_id` against the JWT claim set via
 * `SET LOCAL request.jwt.claims`.
 *
 * Table groups:
 *   - Better Auth tables: tenants, users, sessions, accounts, verifications
 *   - Application tables: api_keys, runs, events
 *   - Observation plane: supervisor_proposals, supervisor_escalations, policy_packs
 *
 * Column naming: snake_case throughout, matching the database column names
 * directly (no Drizzle column name mapping).
 */

import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// tenants
// Multi-tenant isolation root. Every data row traces back to a tenant.
// ---------------------------------------------------------------------------

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("free"), // "free" | "pro" | "enterprise"
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// users
// Better Auth user store. Better Auth generates string IDs (not UUIDs).
// The `tenant_id` foreign key is our custom field — standard Better Auth
// columns are: id, name, email, emailVerified, image, createdAt, updatedAt.
//
// NOTE: Better Auth v1.2.x uses camelCase column names when configured with
// the default schema. We use snake_case here and configure the drizzleAdapter
// with `usePlural: false` and the column map in auth.ts. If Better Auth
// generates a migration that differs from this schema, update to match.
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Better Auth generates string IDs
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  email_verified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  tenant_id: uuid("tenant_id").references(() => tenants.id), // nullable until tenant is created
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sessions
// Better Auth session store. `token` is the session identifier.
// The `tenant_id` is denormalized here for fast JWT claim injection.
// ---------------------------------------------------------------------------

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  ip_address: text("ip_address"),
  user_agent: text("user_agent"),
  tenant_id: uuid("tenant_id").references(() => tenants.id),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// accounts
// Better Auth OAuth account store. One user can have multiple accounts
// (e.g., email+password + Google).
// ---------------------------------------------------------------------------

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  account_id: text("account_id").notNull(),
  provider_id: text("provider_id").notNull(),
  access_token: text("access_token"),
  refresh_token: text("refresh_token"),
  access_token_expires_at: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refresh_token_expires_at: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  id_token: text("id_token"),
  password: text("password"), // bcrypt hash, for email+password auth
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// verifications
// Better Auth email verification + password reset token store.
// ---------------------------------------------------------------------------

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(), // email address
  value: text("value").notNull(), // token
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// api_keys
// SDK authentication. The raw key is NEVER stored.
// Key format: lsg_ + 32 hex chars = 36 chars total.
// The key_hash (SHA-256 hex of full key) is used for lookup.
// key_prefix (first 8 chars, e.g. "lsg_a1b2") is shown in UI for identification.
// ---------------------------------------------------------------------------

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenant_id: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id), // who created it
  name: text("name").notNull(), // human-readable label, e.g. "prod-agent-1"
  key_prefix: text("key_prefix").notNull(), // first 8 chars, e.g. "lsg_xxxx"
  key_hash: text("key_hash").notNull(), // SHA-256 hex of the full key — NEVER return this
  scopes: text("scopes").array().notNull().default([]), // ["ingest", "read"]
  last_used_at: timestamp("last_used_at", { withTimezone: true }),
  expires_at: timestamp("expires_at", { withTimezone: true }), // null = no expiry
  is_revoked: boolean("is_revoked").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// runs
// Agent runs. Primary key is the client-generated UUID v7 (ADR-004, ADR-P3-7).
// Using UUID v7 as PK is efficient because it is time-ordered.
// ---------------------------------------------------------------------------

export const runs = pgTable(
  "runs",
  {
    run_id: uuid("run_id").primaryKey(), // client-generated UUID v7
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agent_name: text("agent_name"),
    agent_role: text("agent_role"),
    environment: text("environment"),
    policy_pack_id: text("policy_pack_id"),
    status: text("status").notNull().default("started"),
    // "started" | "completed" | "terminated_budget" | "terminated_loop"
    // | "terminated_policy" | "abandoned" | "error"
    event_count: integer("event_count").notNull().default(0),
    last_seq: integer("last_seq").notNull().default(0),
    last_hash: text("last_hash"), // SHA-256 hex of last ingested JSONL line
    total_cost_usd: doublePrecision("total_cost_usd").notNull().default(0),
    total_input_tokens: integer("total_input_tokens").notNull().default(0),
    total_output_tokens: integer("total_output_tokens").notNull().default(0),
    total_call_count: integer("total_call_count").notNull().default(0),
    started_at: timestamp("started_at", { withTimezone: true }),
    ended_at: timestamp("ended_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Primary query pattern: list runs for a tenant ordered by creation time
    index("runs_tenant_id_created_at_idx").on(table.tenant_id, table.created_at),
  ]
);

// ---------------------------------------------------------------------------
// events
// Individual audit log events. Foreign key to runs.
//
// The `raw_line` column stores the original JSONL line as received by the
// ingest endpoint. This enables bit-exact chain re-verification without
// re-serializing the event (serialization differences would break hashes).
//
// Unique constraint on (run_id, seq) prevents duplicate event ingestion.
// The ingest endpoint uses ON CONFLICT DO NOTHING for idempotency.
// ---------------------------------------------------------------------------

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(), // server-generated, for pagination
    run_id: uuid("run_id")
      .notNull()
      .references(() => runs.run_id, { onDelete: "cascade" }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    schema_version: integer("schema_version").notNull(),
    event_type: text("event_type").notNull(),
    seq: integer("seq").notNull(),
    hash: text("hash").notNull(), // SHA-256 of event payload (without hash + hash_prev)
    hash_prev: text("hash_prev"), // SHA-256 of previous event; null for seq=1
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    agent_name: text("agent_name"),
    agent_role: text("agent_role"),
    tool: text("tool"),
    args_hash: text("args_hash"),
    args_redacted: jsonb("args_redacted"),
    decision: text("decision"), // "allow" | "deny" | "cooldown" | "kill" | "require_approval"
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
    // Supervisor-specific fields (observation plane only — ADR-012)
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
    // Behavioral telemetry fields (v1.1) — nullable; absent for v1.0 events
    call_seq_fingerprint: text("call_seq_fingerprint"),
    inter_call_ms: integer("inter_call_ms"),
    token_rate_delta: doublePrecision("token_rate_delta"),
    param_shape_hash: text("param_shape_hash"),
    raw_line: text("raw_line"), // original JSONL line for bit-exact chain re-verification
  },
  (table) => [
    // Unique constraint prevents duplicate event ingestion (idempotency key)
    uniqueIndex("events_run_id_seq_unique").on(table.run_id, table.seq),
    // Primary query pattern: fetch events for a run in sequence order
    index("events_run_id_seq_idx").on(table.run_id, table.seq),
    // Tenant-scoped time-series query (dashboard timeline)
    index("events_tenant_id_ts_idx").on(table.tenant_id, table.ts),
    // Filter by event type (supervisor, policy_decision, etc.)
    index("events_event_type_idx").on(table.event_type),
  ]
);

// ---------------------------------------------------------------------------
// supervisor_proposals
// Proposals created by the AI Supervisor (ADR-012) requiring human approval.
// This table is on the OBSERVATION PLANE only — it never affects enforcement.
// ---------------------------------------------------------------------------

export const supervisorProposals = pgTable("supervisor_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenant_id: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  proposal_id: text("proposal_id").notNull().unique(), // from event schema (prop_ prefix)
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

// ---------------------------------------------------------------------------
// supervisor_escalations
// Escalations raised by the AI Supervisor for human attention.
// This table is on the OBSERVATION PLANE only — it never affects enforcement.
// `escalate_to_human` can NEVER be blocked (ADR-012, C13).
// ---------------------------------------------------------------------------

export const supervisorEscalations = pgTable("supervisor_escalations", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenant_id: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  escalation_id: text("escalation_id").notNull().unique(), // from event schema (esc_ prefix)
  supervisor_run_id: text("supervisor_run_id").notNull(),
  trigger_run_id: text("trigger_run_id"),
  severity: text("severity").notNull(), // "low" | "medium" | "high" | "critical"
  rationale: text("rationale").notNull(),
  recommendation: text("recommendation"),
  confidence: doublePrecision("confidence"),
  supporting_runs: text("supporting_runs").array(),
  timeout_seconds: integer("timeout_seconds"),
  timeout_action: text("timeout_action"), // "deny" | "allow" | "kill"
  status: text("status").notNull().default("open"),
  // "open" | "acknowledged" | "resolved" | "expired"
  acknowledged_by: text("acknowledged_by").references(() => users.id),
  acknowledged_at: timestamp("acknowledged_at", { withTimezone: true }),
  resolution_notes: text("resolution_notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// policy_packs
// Stored policy packs for the hosted tier (Mode 2/3).
// Content is validated against policy.schema.json before insert/update.
// The `escalate_to_human` invariant is enforced in the tRPC handler.
// ---------------------------------------------------------------------------

export const policyPacks = pgTable("policy_packs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenant_id: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  agent_role: text("agent_role"),
  environment: text("environment"),
  content: jsonb("content").notNull(), // full policy pack as JSON
  schema_version: integer("schema_version").notNull().default(1),
  is_active: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(1), // optimistic concurrency counter
  created_by: text("created_by").references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// rate_limit_buckets  (ADR-022)
// Service-scoped fixed-window bucket table. Deny-all RLS policy; only the
// service role bypass is permitted to read/write. Composite primary key on
// (key, window_start) makes the upsert `INSERT … ON CONFLICT DO UPDATE`
// atomic under concurrent writers.
// ---------------------------------------------------------------------------

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").notNull(),
    window_start: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.window_start] }),
    index("rate_limit_buckets_window_start_idx").on(table.window_start),
  ]
);

// ---------------------------------------------------------------------------
// email_audit_log  (ADR-021 abuse detection)
// One row per Resend send attempt. Middleware writes the 'pending' row with
// ip/user_agent/nonce; the Better Auth callback updates it with the Resend
// message id or a 'failed' status.
// ---------------------------------------------------------------------------

export const emailTypeEnum = pgEnum("email_type", [
  "password_reset",
  "verification",
  "resend_verification",
]);

export const emailAuditLog = pgTable(
  "email_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    user_id: text("user_id").references(() => users.id, { onDelete: "set null" }),
    tenant_id: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    email_type: emailTypeEnum("email_type").notNull(),
    sent_at: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    user_agent: text("user_agent"),
    resend_message_id: text("resend_message_id"),
    send_status: text("send_status").notNull().default("pending"),
    // Correlation key written by the middleware so the Better Auth callback
    // can update the same row (Better Auth does not pass request context into
    // sendVerificationEmail / sendResetPassword).
    request_nonce: text("request_nonce"),
  },
  (table) => [
    index("email_audit_log_tenant_sent_idx").on(table.tenant_id, table.sent_at),
    index("email_audit_log_email_sent_idx").on(table.email, table.sent_at),
    index("email_audit_log_nonce_idx").on(table.request_nonce),
  ]
);

// ---------------------------------------------------------------------------
// Type exports — inferred from schema for use in application code
// ---------------------------------------------------------------------------

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export type SupervisorProposal = typeof supervisorProposals.$inferSelect;
export type NewSupervisorProposal = typeof supervisorProposals.$inferInsert;

export type SupervisorEscalation = typeof supervisorEscalations.$inferSelect;
export type NewSupervisorEscalation = typeof supervisorEscalations.$inferInsert;

export type PolicyPack = typeof policyPacks.$inferSelect;
export type NewPolicyPack = typeof policyPacks.$inferInsert;

export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type NewRateLimitBucket = typeof rateLimitBuckets.$inferInsert;

export type EmailAuditLogEntry = typeof emailAuditLog.$inferSelect;
export type NewEmailAuditLogEntry = typeof emailAuditLog.$inferInsert;
