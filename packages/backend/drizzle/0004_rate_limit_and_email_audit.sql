-- SPDX-License-Identifier: AGPL-3.0-only
-- LoopStorm Guard — Rate Limit Buckets + Email Audit Log Migration
-- Spec: docs/adrs/ADR-022-rate-limiting.md, docs/adrs/ADR-021-email-transport.md
-- Scope for this migration: Layer 1 (email-triggering auth endpoints) only.
--   - rate_limit_buckets: shared fixed-window bucket table per ADR-022 AC-22-1
--   - email_audit_log:    per-send audit row for Resend calls (abuse detection)
--
-- Both tables are service-scoped (deny-all RLS bypassed by service role).
-- The bucket table is not tenant-scoped because rate limit checks must run
-- before a tenant context is established on the auth endpoints.

-- ---------------------------------------------------------------------------
-- rate_limit_buckets  (ADR-022 §Database schema)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "key"          text         NOT NULL,
  "window_start" timestamptz  NOT NULL,
  "count"        integer      NOT NULL DEFAULT 1,
  PRIMARY KEY ("key", "window_start")
);

CREATE INDEX IF NOT EXISTS "rate_limit_buckets_window_start_idx"
  ON "rate_limit_buckets" ("window_start");

ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_limit_buckets" FORCE ROW LEVEL SECURITY;

-- Deny-all: only the service role (bypass RLS) may read/write.
DROP POLICY IF EXISTS "rate_limit_buckets_deny_all" ON "rate_limit_buckets";
CREATE POLICY "rate_limit_buckets_deny_all" ON "rate_limit_buckets"
  FOR ALL USING (false) WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- email_audit_log  (ADR-021 abuse detection)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_type') THEN
    CREATE TYPE "email_type" AS ENUM (
      'password_reset',
      'verification',
      'resend_verification'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "email_audit_log" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"           text REFERENCES "users"("id") ON DELETE SET NULL,
  "tenant_id"         uuid REFERENCES "tenants"("id") ON DELETE SET NULL,
  "email"             text NOT NULL,
  "email_type"        "email_type" NOT NULL,
  "sent_at"           timestamptz NOT NULL DEFAULT now(),
  "ip"                text,
  "user_agent"        text,
  "resend_message_id" text,
  "send_status"       text NOT NULL DEFAULT 'pending',
  "request_nonce"     text
);

CREATE INDEX IF NOT EXISTS "email_audit_log_tenant_sent_idx"
  ON "email_audit_log" ("tenant_id", "sent_at" DESC);

CREATE INDEX IF NOT EXISTS "email_audit_log_email_sent_idx"
  ON "email_audit_log" ("email", "sent_at" DESC);

CREATE INDEX IF NOT EXISTS "email_audit_log_nonce_idx"
  ON "email_audit_log" ("request_nonce");

ALTER TABLE "email_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_audit_log" FORCE ROW LEVEL SECURITY;

-- Tenant-scoped reads (ADR-020 current_tenant_id() helper from 0002_enable_rls.sql).
-- Rows with NULL tenant_id (pre-verification sends) are visible only to the
-- service role; authenticated tenants see only their own rows.
DROP POLICY IF EXISTS "email_audit_log_tenant_isolation" ON "email_audit_log";
CREATE POLICY "email_audit_log_tenant_isolation" ON "email_audit_log"
  FOR ALL
  USING ("tenant_id" IS NOT NULL AND "tenant_id" = current_tenant_id())
  WITH CHECK ("tenant_id" IS NOT NULL AND "tenant_id" = current_tenant_id());
