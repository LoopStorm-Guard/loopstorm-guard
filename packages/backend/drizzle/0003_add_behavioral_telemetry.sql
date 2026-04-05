-- SPDX-License-Identifier: AGPL-3.0-only
-- LoopStorm Guard — Behavioral Telemetry Migration (v1.1)
-- Spec: specs/behavioral-telemetry.md
-- Task: BT-G1
--
-- Adds 4 nullable behavioral telemetry columns to the events table.
-- All columns are nullable because:
--   (a) v1.0 events do not have these fields
--   (b) non-policy_decision events do not carry them
--
-- Running this migration against an existing v1.0 database is safe:
-- existing rows retain NULL for all 4 columns (no data loss).

-- v1.1: Behavioral Telemetry columns (specs/behavioral-telemetry.md)
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "call_seq_fingerprint" text;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "inter_call_ms" integer;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "token_rate_delta" double precision;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "param_shape_hash" text;
