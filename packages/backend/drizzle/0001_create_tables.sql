-- LoopStorm Guard — Initial Schema Migration
-- Generated from: packages/backend/src/db/schema.ts
-- Dialect: PostgreSQL (Supabase)
--
-- Table creation order respects foreign key dependencies:
--   1. tenants  (no FKs)
--   2. users    (FK → tenants)
--   3. sessions (FK → users, tenants)
--   4. accounts (FK → users)
--   5. verifications (no FKs)
--   6. api_keys (FK → tenants, users)
--   7. runs     (FK → tenants)
--   8. events   (FK → runs, tenants)
--   9. supervisor_proposals  (FK → tenants, users)
--  10. supervisor_escalations (FK → tenants, users)
--  11. policy_packs (FK → tenants, users)

-- ---------------------------------------------------------------------------
-- 1. tenants
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "tenants" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       text NOT NULL,
  "slug"       text NOT NULL,
  "plan"       text NOT NULL DEFAULT 'free',
  "is_active"  boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_unique" ON "tenants" ("slug");

-- ---------------------------------------------------------------------------
-- 2. users
-- Better Auth user store. Better Auth generates text (not UUID) primary keys.
-- tenant_id is nullable: it is set by the post-registration hook.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "users" (
  "id"             text PRIMARY KEY,
  "name"           text NOT NULL,
  "email"          text NOT NULL,
  "email_verified" boolean NOT NULL DEFAULT false,
  "image"          text,
  "tenant_id"      uuid REFERENCES "tenants" ("id") ON DELETE SET NULL,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" ("email");

-- ---------------------------------------------------------------------------
-- 3. sessions
-- Better Auth session store. tenant_id is denormalized for fast RLS context.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "sessions" (
  "id"          text PRIMARY KEY,
  "user_id"     text NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "token"       text NOT NULL,
  "expires_at"  timestamptz NOT NULL,
  "ip_address"  text,
  "user_agent"  text,
  "tenant_id"   uuid REFERENCES "tenants" ("id") ON DELETE SET NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_unique" ON "sessions" ("token");

-- ---------------------------------------------------------------------------
-- 4. accounts
-- Better Auth OAuth account store. One user may have multiple accounts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "accounts" (
  "id"                       text PRIMARY KEY,
  "user_id"                  text NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "account_id"               text NOT NULL,
  "provider_id"              text NOT NULL,
  "access_token"             text,
  "refresh_token"            text,
  "access_token_expires_at"  timestamptz,
  "refresh_token_expires_at" timestamptz,
  "scope"                    text,
  "id_token"                 text,
  "password"                 text,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. verifications
-- Better Auth email verification + password reset token store.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "verifications" (
  "id"          text PRIMARY KEY,
  "identifier"  text NOT NULL,
  "value"       text NOT NULL,
  "expires_at"  timestamptz NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 6. api_keys
-- SDK authentication. Raw key is NEVER stored; only the SHA-256 hash.
-- key_prefix (e.g. "lsg_a1b2") is safe to display in the UI.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "user_id"      text NOT NULL REFERENCES "users" ("id"),
  "name"         text NOT NULL,
  "key_prefix"   text NOT NULL,
  "key_hash"     text NOT NULL,
  "scopes"       text[] NOT NULL DEFAULT '{}',
  "last_used_at" timestamptz,
  "expires_at"   timestamptz,
  "is_revoked"   boolean NOT NULL DEFAULT false,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 7. runs
-- Agent runs. PK is a client-generated UUID v7 (time-ordered, ADR-004).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "runs" (
  "run_id"               uuid PRIMARY KEY,
  "tenant_id"            uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "agent_name"           text,
  "agent_role"           text,
  "environment"          text,
  "policy_pack_id"       text,
  "status"               text NOT NULL DEFAULT 'started',
  "event_count"          integer NOT NULL DEFAULT 0,
  "last_seq"             integer NOT NULL DEFAULT 0,
  "last_hash"            text,
  "total_cost_usd"       double precision NOT NULL DEFAULT 0,
  "total_input_tokens"   integer NOT NULL DEFAULT 0,
  "total_output_tokens"  integer NOT NULL DEFAULT 0,
  "total_call_count"     integer NOT NULL DEFAULT 0,
  "started_at"           timestamptz,
  "ended_at"             timestamptz,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "runs_tenant_id_created_at_idx"
  ON "runs" ("tenant_id", "created_at");

-- ---------------------------------------------------------------------------
-- 8. events
-- Individual audit log events. Unique on (run_id, seq) for idempotent ingest.
-- raw_line stores the original JSONL for bit-exact chain re-verification.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "events" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id"             uuid NOT NULL REFERENCES "runs" ("run_id") ON DELETE CASCADE,
  "tenant_id"          uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "schema_version"     integer NOT NULL,
  "event_type"         text NOT NULL,
  "seq"                integer NOT NULL,
  "hash"               text NOT NULL,
  "hash_prev"          text,
  "ts"                 timestamptz NOT NULL,
  "agent_name"         text,
  "agent_role"         text,
  "tool"               text,
  "args_hash"          text,
  "args_redacted"      jsonb,
  "decision"           text,
  "rule_id"            text,
  "reason"             text,
  "model"              text,
  "input_tokens"       integer,
  "output_tokens"      integer,
  "estimated_cost_usd" double precision,
  "latency_ms"         double precision,
  "policy_pack_id"     text,
  "environment"        text,
  "run_status"         text,
  "dimension"          text,
  "loop_rule"          text,
  "loop_action"        text,
  "cooldown_ms"        integer,
  "budget"             jsonb,
  -- Supervisor-specific fields (observation plane only — ADR-012)
  "supervisor_run_id"  text,
  "trigger"            text,
  "trigger_run_id"     text,
  "proposal_id"        text,
  "proposal_type"      text,
  "target_agent"       text,
  "rationale"          text,
  "confidence"         double precision,
  "supporting_runs"    text[],
  "status"             text,
  "escalation_id"      text,
  "severity"           text,
  "recommendation"     text,
  "timeout_seconds"    integer,
  "timeout_action"     text,
  "raw_line"           text
);

-- Idempotency key: prevents duplicate event ingestion
CREATE UNIQUE INDEX IF NOT EXISTS "events_run_id_seq_unique"
  ON "events" ("run_id", "seq");

-- Primary query pattern: fetch events for a run in sequence order
CREATE INDEX IF NOT EXISTS "events_run_id_seq_idx"
  ON "events" ("run_id", "seq");

-- Tenant-scoped time-series query (dashboard timeline)
CREATE INDEX IF NOT EXISTS "events_tenant_id_ts_idx"
  ON "events" ("tenant_id", "ts");

-- Filter by event type (supervisor, policy_decision, etc.)
CREATE INDEX IF NOT EXISTS "events_event_type_idx"
  ON "events" ("event_type");

-- ---------------------------------------------------------------------------
-- 9. supervisor_proposals
-- Observation plane — created by the AI Supervisor, require human approval.
-- NEVER affects enforcement directly (ADR-012).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "supervisor_proposals" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "proposal_id"       text NOT NULL,
  "supervisor_run_id" text NOT NULL,
  "trigger_run_id"    text,
  "proposal_type"     text NOT NULL,
  "target_agent"      text,
  "rationale"         text NOT NULL,
  "confidence"        double precision,
  "supporting_runs"   text[],
  "proposed_changes"  jsonb,
  "status"            text NOT NULL DEFAULT 'pending',
  "reviewed_by"       text REFERENCES "users" ("id"),
  "reviewed_at"       timestamptz,
  "review_notes"      text,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "supervisor_proposals_proposal_id_unique"
  ON "supervisor_proposals" ("proposal_id");

-- ---------------------------------------------------------------------------
-- 10. supervisor_escalations
-- Observation plane — raised by the AI Supervisor for human attention.
-- escalate_to_human can NEVER be blocked (ADR-012, C13).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "supervisor_escalations" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "escalation_id"     text NOT NULL,
  "supervisor_run_id" text NOT NULL,
  "trigger_run_id"    text,
  "severity"          text NOT NULL,
  "rationale"         text NOT NULL,
  "recommendation"    text,
  "confidence"        double precision,
  "supporting_runs"   text[],
  "timeout_seconds"   integer,
  "timeout_action"    text,
  "status"            text NOT NULL DEFAULT 'open',
  "acknowledged_by"   text REFERENCES "users" ("id"),
  "acknowledged_at"   timestamptz,
  "resolution_notes"  text,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "supervisor_escalations_escalation_id_unique"
  ON "supervisor_escalations" ("escalation_id");

-- ---------------------------------------------------------------------------
-- 11. policy_packs
-- Stored policy packs for the hosted tier (Mode 2/3).
-- Content is validated against policy.schema.json before insert/update.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "policy_packs" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "name"           text NOT NULL,
  "description"    text,
  "agent_role"     text,
  "environment"    text,
  "content"        jsonb NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 1,
  "is_active"      boolean NOT NULL DEFAULT true,
  "version"        integer NOT NULL DEFAULT 1,
  "created_by"     text REFERENCES "users" ("id"),
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
