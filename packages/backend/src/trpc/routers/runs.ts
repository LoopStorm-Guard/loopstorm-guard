// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC router for agent run management in LoopStorm Guard.
 *
 * Procedures:
 * - `runs.list`      — paginated list of runs for the current tenant
 * - `runs.get`       — get a single run by run_id
 * - `runs.getEvents` — get events for a run, ordered by seq ASC
 *
 * All procedures are tenant-scoped: RLS at the DB layer enforces isolation,
 * and application-level checks provide defense-in-depth.
 *
 * Pagination strategy: cursor-based on `created_at` timestamp.
 * - For `runs.list`: cursor = ISO 8601 datetime of the last seen created_at.
 *   Returns items with created_at < cursor (exclusive), ordered DESC.
 * - For `runs.getEvents`: cursor = seq integer of the last seen event.
 *   Returns items with seq > cursor (exclusive), ordered ASC.
 *
 * Rationale for cursor-over-offset: offset-based pagination is O(n) in
 * PostgreSQL for large tables. Cursor-based pagination is O(log n) using
 * the timestamp/seq index.
 *
 * ADR-020: All queries use ctx.db (the transaction-scoped client injected
 * by the protectedProcedure middleware). Never import the db singleton here.
 */

import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { events, runs } from "../../db/schema.js";
import { protectedProcedure, router } from "../trpc.js";

export const runsRouter = router({
  /**
   * List agent runs for the current tenant.
   *
   * Results are ordered by created_at DESC (most recent first).
   * Cursor-based pagination: pass the `nextCursor` from the previous page
   * as the `cursor` on the next request.
   */
  list: protectedProcedure
    .input(
      z.object({
        /**
         * Pagination cursor: ISO 8601 datetime of the last seen `created_at`.
         * Omit for the first page.
         */
        cursor: z.string().datetime().optional(),
        /** Number of results per page. Default 50, max 100. */
        limit: z.number().int().min(1).max(100).default(50),
        /** Filter by run status. Omit to return all statuses. */
        status: z
          .enum([
            "started",
            "completed",
            "terminated_budget",
            "terminated_loop",
            "terminated_policy",
            "abandoned",
            "error",
          ])
          .optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      const conditions = [eq(runs.tenant_id, tenantId)];

      if (input.cursor) {
        conditions.push(lt(runs.created_at, new Date(input.cursor)));
      }

      if (input.status) {
        conditions.push(eq(runs.status, input.status));
      }

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const rows = await ctx.db
        .select({
          run_id: runs.run_id,
          tenant_id: runs.tenant_id,
          agent_name: runs.agent_name,
          agent_role: runs.agent_role,
          environment: runs.environment,
          policy_pack_id: runs.policy_pack_id,
          status: runs.status,
          event_count: runs.event_count,
          last_seq: runs.last_seq,
          total_cost_usd: runs.total_cost_usd,
          total_input_tokens: runs.total_input_tokens,
          total_output_tokens: runs.total_output_tokens,
          total_call_count: runs.total_call_count,
          started_at: runs.started_at,
          ended_at: runs.ended_at,
          created_at: runs.created_at,
          updated_at: runs.updated_at,
          // last_hash is internal — not exposed to the frontend
        })
        .from(runs)
        .where(and(...conditions))
        .orderBy(desc(runs.created_at))
        .limit(input.limit + 1); // fetch one extra to detect the next page

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? lastItem.created_at.toISOString() : null;

      return {
        items,
        nextCursor,
      };
    }),

  /**
   * Get a single run by run_id.
   *
   * Returns null if the run does not exist or does not belong to the current
   * tenant. Following the principle that cross-tenant queries return no data
   * (not an error), this procedure returns null rather than NOT_FOUND when
   * the run belongs to another tenant — the caller cannot distinguish between
   * "not found" and "not yours", which is the desired security behavior.
   */
  get: protectedProcedure
    .input(
      z.object({
        /** UUID of the run to retrieve. */
        run_id: z.string().uuid(),
      })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const [row] = await ctx.db
        .select()
        .from(runs)
        .where(and(eq(runs.run_id, input.run_id), eq(runs.tenant_id, tenantId)))
        .limit(1);

      if (!row) {
        return null;
      }

      // Exclude internal field last_hash from the response.
      // It is used for chain continuation verification but is an internal
      // implementation detail — the client should use verify.chain instead.
      const { last_hash: _lastHash, ...publicRow } = row;
      return publicRow;
    }),

  /**
   * Get events for a run, ordered by seq ASC.
   *
   * Cursor-based pagination: pass the `nextCursor` (last seen seq) from
   * the previous page as the `cursor` on the next request.
   *
   * Security: verifies that the run belongs to the current tenant before
   * fetching events. This check is redundant with RLS (the events table also
   * has a tenant_id column) but provides defense-in-depth.
   */
  getEvents: protectedProcedure
    .input(
      z.object({
        /** UUID of the run to fetch events for. */
        run_id: z.string().uuid(),
        /**
         * Pagination cursor: seq number of the last seen event.
         * Returns events with seq > cursor. Omit for the first page.
         */
        cursor: z.number().int().min(0).optional(),
        /** Number of events per page. Default 100, max 500. */
        limit: z.number().int().min(1).max(500).default(100),
        /** Filter by event type (e.g., "policy_decision", "run_ended"). */
        event_type: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      // First, verify the run exists and belongs to this tenant.
      // If not found, return empty result (not an error — cross-tenant isolation).
      const [run] = await ctx.db
        .select({ run_id: runs.run_id })
        .from(runs)
        .where(and(eq(runs.run_id, input.run_id), eq(runs.tenant_id, tenantId)))
        .limit(1);

      if (!run) {
        return { items: [], nextCursor: null };
      }

      // Build event query conditions
      const conditions = [eq(events.run_id, input.run_id), eq(events.tenant_id, tenantId)];

      if (input.cursor !== undefined) {
        conditions.push(gt(events.seq, input.cursor));
      }

      if (input.event_type) {
        conditions.push(eq(events.event_type, input.event_type));
      }

      const rows = await ctx.db
        .select({
          id: events.id,
          run_id: events.run_id,
          schema_version: events.schema_version,
          event_type: events.event_type,
          seq: events.seq,
          hash: events.hash,
          hash_prev: events.hash_prev,
          ts: events.ts,
          agent_name: events.agent_name,
          agent_role: events.agent_role,
          tool: events.tool,
          args_hash: events.args_hash,
          args_redacted: events.args_redacted,
          decision: events.decision,
          rule_id: events.rule_id,
          reason: events.reason,
          model: events.model,
          input_tokens: events.input_tokens,
          output_tokens: events.output_tokens,
          estimated_cost_usd: events.estimated_cost_usd,
          latency_ms: events.latency_ms,
          policy_pack_id: events.policy_pack_id,
          environment: events.environment,
          run_status: events.run_status,
          dimension: events.dimension,
          loop_rule: events.loop_rule,
          loop_action: events.loop_action,
          cooldown_ms: events.cooldown_ms,
          budget: events.budget,
          supervisor_run_id: events.supervisor_run_id,
          trigger: events.trigger,
          trigger_run_id: events.trigger_run_id,
          proposal_id: events.proposal_id,
          proposal_type: events.proposal_type,
          target_agent: events.target_agent,
          rationale: events.rationale,
          confidence: events.confidence,
          supporting_runs: events.supporting_runs,
          status: events.status,
          escalation_id: events.escalation_id,
          severity: events.severity,
          recommendation: events.recommendation,
          timeout_seconds: events.timeout_seconds,
          timeout_action: events.timeout_action,
          // Behavioral telemetry fields (v1.1). Nullable for events that
          // predate v1.1 — callers must handle null gracefully.
          call_seq_fingerprint: events.call_seq_fingerprint,
          inter_call_ms: events.inter_call_ms,
          token_rate_delta: events.token_rate_delta,
          param_shape_hash: events.param_shape_hash,
          // raw_line is omitted from list responses — it is large and only
          // needed for chain verification (use verify.chain for that).
        })
        .from(events)
        .where(and(...conditions))
        .orderBy(asc(events.seq))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? lastItem.seq : null;

      return {
        items,
        nextCursor,
      };
    }),
});
