-- LoopStorm Guard — Row-Level Security Policies
-- Applied after 0001_create_tables.sql.
--
-- Security model:
--   Every tenant-scoped table has RLS enabled with FORCE ROW LEVEL SECURITY so
--   the table owner (migration role) is also subject to the policy.
--
--   The tRPC middleware calls:
--     SELECT set_config('request.jwt.claims', '{"tenant_id":"<uuid>"}', true)
--   before every query (see packages/backend/src/middleware/tenant.ts).
--   RLS policies read this setting and compare it to each row's tenant_id.
--
--   The `true` flag in set_config makes the setting LOCAL to the current
--   transaction, so it never leaks to other requests on the same connection.
--
-- Tables covered (all tables with a tenant_id column):
--   api_keys, runs, events, supervisor_proposals, supervisor_escalations,
--   policy_packs
--
-- Tables NOT covered (no tenant_id / shared across tenants):
--   tenants, users, sessions, accounts, verifications
--   (access to these is controlled at the application layer via Better Auth)
--
-- DevOps gate: this migration must only be applied after the local Supabase
-- PostgreSQL stack is confirmed running (see MEMORY.md blocker status).

-- ---------------------------------------------------------------------------
-- Helper: extract tenant_id from the JWT claims session variable.
-- Returns NULL when the variable is not set (e.g., during migrations).
-- NULL causes all RLS policies to evaluate to false → no rows returned.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT (
    current_setting('request.jwt.claims', true)::json->>'tenant_id'
  )::uuid
$$;

-- ---------------------------------------------------------------------------
-- api_keys
-- ---------------------------------------------------------------------------

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "api_keys"
  USING (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- runs
-- ---------------------------------------------------------------------------

ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "runs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "runs"
  USING (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------

ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "events"
  USING (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- supervisor_proposals
-- ---------------------------------------------------------------------------

ALTER TABLE "supervisor_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supervisor_proposals" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "supervisor_proposals"
  USING (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- supervisor_escalations
-- ---------------------------------------------------------------------------

ALTER TABLE "supervisor_escalations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supervisor_escalations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "supervisor_escalations"
  USING (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- policy_packs
-- ---------------------------------------------------------------------------

ALTER TABLE "policy_packs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "policy_packs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "policy_packs"
  USING (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Grant structure for dedicated database roles.
-- These roles are created outside Drizzle (in Supabase dashboard or init SQL).
--
-- loopstorm_ingest — used by ingest workers (Cloudflare Workers)
--   INSERT-only on events. Cannot SELECT from any table.
--
-- loopstorm_supervisor — used by the AI Supervisor agent (ADR-012)
--   SELECT on events, runs, and read-only reference tables.
--   INSERT + UPDATE on all supervisor tables (observation plane only).
--
-- Both roles are subject to the RLS policies above. A connection using
-- loopstorm_ingest that sets a valid request.jwt.claims can only INSERT
-- into events rows that match its tenant_id. SELECTs return 0 rows (not error).
-- ---------------------------------------------------------------------------

-- loopstorm_ingest: INSERT-only on events
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loopstorm_ingest') THEN
    GRANT INSERT ON "events" TO loopstorm_ingest;
  END IF;
END
$$;

-- loopstorm_supervisor: read from source tables, write to observation plane
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loopstorm_supervisor') THEN
    GRANT SELECT ON "events"                TO loopstorm_supervisor;
    GRANT SELECT ON "runs"                  TO loopstorm_supervisor;
    GRANT SELECT ON "tenants"               TO loopstorm_supervisor;
    GRANT SELECT ON "users"                 TO loopstorm_supervisor;
    GRANT SELECT ON "policy_packs"          TO loopstorm_supervisor;
    GRANT INSERT, UPDATE ON "supervisor_proposals"   TO loopstorm_supervisor;
    GRANT INSERT, UPDATE ON "supervisor_escalations" TO loopstorm_supervisor;
  END IF;
END
$$;
