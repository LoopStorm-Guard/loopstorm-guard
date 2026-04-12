// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC router providing backend APIs for the AI Supervisor's tool calls.
 *
 * This router serves the SUPERVISOR PROCESS (not human dashboard users).
 * Auth: apiKeyProcedure — requires a valid API key with "supervisor" scope.
 *
 * Separation from the existing supervisorRouter:
 * - supervisorRouter  → dashboard users (session auth, protectedProcedure)
 * - supervisorToolsRouter → supervisor process (API key auth, apiKeyProcedure)
 *
 * Procedures:
 * - getRunEvents        — events for a specific run (wraps runs.getEvents)
 * - getAgentBaseline    — aggregate statistics for an agent
 * - getPolicyPack       — fetch a policy pack by ID
 * - querySimilarRuns    — find runs with similar call_seq_fingerprint
 * - createProposal      — insert a supervisor proposal
 * - createEscalation    — insert a supervisor escalation
 * - recordLearning      — insert a learning record (auto-approved)
 *
 * Spec reference: specs/task-briefs/v1.1-ai-supervisor.md, Task SUP-A5.
 *
 * ADR-020: All queries use ctx.db (the transaction-scoped client injected
 * by the apiKeyProcedure middleware). Never import the db singleton here.
 */

import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, gt, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  events,
  policyPacks,
  runs,
  supervisorEscalations,
  supervisorProposals,
} from "../../db/schema.js";
import { apiKeyProcedure, router } from "../trpc.js";

// ---------------------------------------------------------------------------
// Scope guard helper
// ---------------------------------------------------------------------------

/**
 * Verify that the API key has the "supervisor" scope.
 * Throws FORBIDDEN if the scope is missing.
 */
function requireSupervisorScope(ctx: {
  apiKeyScopes?: string[];
}): void {
  if (!ctx.apiKeyScopes?.includes("supervisor")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: 'API key missing required "supervisor" scope',
    });
  }
}

// ---------------------------------------------------------------------------
// Baseline cache (5-minute TTL, per task brief R1 mitigation)
// ---------------------------------------------------------------------------

interface BaselineCacheEntry {
  data: unknown;
  expiresAt: number; // Date.now() ms
}

const baselineCache = new Map<string, BaselineCacheEntry>();
const BASELINE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedBaseline(key: string): unknown | null {
  const entry = baselineCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    baselineCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedBaseline(key: string, data: unknown): void {
  baselineCache.set(key, {
    data,
    expiresAt: Date.now() + BASELINE_CACHE_TTL_MS,
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const supervisorToolsRouter = router({
  /**
   * Get events for a specific run.
   *
   * Thin wrapper around the same query as `runs.getEvents`, with
   * supervisor-specific defaults (limit 500, includes BT fields).
   */
  getRunEvents: apiKeyProcedure
    .input(
      z.object({
        run_id: z.string().uuid(),
        cursor: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(1000).default(500),
        event_type: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      requireSupervisorScope(ctx);
      const tenantId = ctx.tenantId ?? "";

      const conditions = [eq(events.run_id, input.run_id), eq(events.tenant_id, tenantId)];

      if (input.cursor !== undefined) {
        conditions.push(gt(events.seq, input.cursor));
      }

      if (input.event_type) {
        conditions.push(eq(events.event_type, input.event_type));
      }

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
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
          // Behavioral telemetry fields (v1.1)
          call_seq_fingerprint: events.call_seq_fingerprint,
          inter_call_ms: events.inter_call_ms,
          token_rate_delta: events.token_rate_delta,
          param_shape_hash: events.param_shape_hash,
        })
        .from(events)
        .where(and(...conditions))
        .orderBy(asc(events.seq))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? lastItem.seq : null;

      return { items, nextCursor };
    }),

  /**
   * Get aggregate baseline statistics for an agent.
   *
   * Expensive query — cached per (tenant_id, agent_name) for 5 minutes.
   * Returns INSUFFICIENT_DATA warning when < 3 runs exist.
   */
  getAgentBaseline: apiKeyProcedure
    .input(
      z.object({
        agent_name: z.string().min(1),
        lookback_days: z.number().int().min(1).max(365).default(30),
      })
    )
    .query(async ({ input, ctx }) => {
      requireSupervisorScope(ctx);
      const tenantId = ctx.tenantId ?? "";

      // Check cache
      const cacheKey = `${tenantId}:${input.agent_name}:${input.lookback_days}`;
      const cached = getCachedBaseline(cacheKey);
      if (cached) {
        return cached;
      }

      const cutoff = new Date(Date.now() - input.lookback_days * 24 * 60 * 60 * 1000);

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      // Main run aggregates
      const [runAgg] = await ctx.db
        .select({
          run_count: count(),
          avg_cost_usd: sql<number>`AVG(${runs.total_cost_usd})`,
          median_cost_usd: sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${runs.total_cost_usd})`,
          p95_cost_usd: sql<number>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${runs.total_cost_usd})`,
          avg_call_count: sql<number>`AVG(${runs.total_call_count})`,
          avg_input_tokens: sql<number>`AVG(${runs.total_input_tokens})`,
          avg_output_tokens: sql<number>`AVG(${runs.total_output_tokens})`,
        })
        .from(runs)
        .where(
          and(
            eq(runs.tenant_id, tenantId),
            eq(runs.agent_name, input.agent_name),
            gte(runs.created_at, cutoff)
          )
        );

      const runCount = Number(runAgg?.run_count ?? 0);

      if (runCount < 3) {
        const result = {
          run_count: runCount,
          warning: "INSUFFICIENT_DATA",
          message: `Only ${runCount} run(s) found for agent "${input.agent_name}" in the last ${input.lookback_days} days. At least 3 runs are needed for meaningful baselines.`,
          avg_cost_usd: null,
          median_cost_usd: null,
          p95_cost_usd: null,
          avg_call_count: null,
          avg_input_tokens: null,
          avg_output_tokens: null,
          avg_deny_rate: null,
          total_deny_count: null,
          total_decision_count: null,
        };
        setCachedBaseline(cacheKey, result);
        return result;
      }

      // Deny counts from events
      const [denyAgg] = await ctx.db
        .select({
          total_deny_count: sql<number>`COUNT(*) FILTER (WHERE ${events.decision} = 'deny')`,
          total_decision_count: sql<number>`COUNT(*) FILTER (WHERE ${events.event_type} = 'policy_decision')`,
        })
        .from(events)
        .where(
          and(
            eq(events.tenant_id, tenantId),
            sql`${events.run_id} IN (SELECT ${runs.run_id} FROM ${runs} WHERE ${runs.tenant_id} = ${tenantId} AND ${runs.agent_name} = ${input.agent_name} AND ${runs.created_at} >= ${cutoff})`
          )
        );

      const totalDenyCount = Number(denyAgg?.total_deny_count ?? 0);
      const totalDecisionCount = Number(denyAgg?.total_decision_count ?? 0);
      const avgDenyRate = totalDecisionCount > 0 ? totalDenyCount / totalDecisionCount : 0;

      const result = {
        run_count: runCount,
        avg_cost_usd: Number(runAgg?.avg_cost_usd ?? 0),
        median_cost_usd: Number(runAgg?.median_cost_usd ?? 0),
        p95_cost_usd: Number(runAgg?.p95_cost_usd ?? 0),
        avg_call_count: Number(runAgg?.avg_call_count ?? 0),
        avg_input_tokens: Number(runAgg?.avg_input_tokens ?? 0),
        avg_output_tokens: Number(runAgg?.avg_output_tokens ?? 0),
        avg_deny_rate: avgDenyRate,
        total_deny_count: totalDenyCount,
        total_decision_count: totalDecisionCount,
      };

      setCachedBaseline(cacheKey, result);
      return result;
    }),

  /**
   * Get a policy pack by ID.
   *
   * Thin wrapper around the same query as `policies.get`.
   */
  getPolicyPack: apiKeyProcedure
    .input(
      z.object({
        id: z.string().uuid(),
      })
    )
    .query(async ({ input, ctx }) => {
      requireSupervisorScope(ctx);
      const tenantId = ctx.tenantId ?? "";

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const [row] = await ctx.db
        .select()
        .from(policyPacks)
        .where(and(eq(policyPacks.id, input.id), eq(policyPacks.tenant_id, tenantId)))
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy pack not found",
        });
      }

      return row;
    }),

  /**
   * Query runs with a similar call sequence fingerprint.
   *
   * Used by the supervisor's `query_similar_runs` tool to find runs with
   * similar behavioral patterns.
   *
   * scope="customer": search within the tenant's own runs.
   * scope="anonymous_aggregate": returns empty (v2 feature).
   */
  querySimilarRuns: apiKeyProcedure
    .input(
      z.object({
        fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        scope: z.enum(["customer", "anonymous_aggregate"]).default("customer"),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      requireSupervisorScope(ctx);
      const tenantId = ctx.tenantId ?? "";

      if (input.scope === "anonymous_aggregate") {
        return {
          runs: [],
          scope_message:
            "Cross-customer intelligence is available in v2. This query returned results from your own runs only.",
        };
      }

      // Match on first 16 hex chars of fingerprint prefix
      const prefix = input.fingerprint.slice(0, 16);

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const matchingEvents = await ctx.db
        .select({
          run_id: events.run_id,
          call_seq_fingerprint: events.call_seq_fingerprint,
        })
        .from(events)
        .where(
          and(
            eq(events.tenant_id, tenantId),
            sql`${events.call_seq_fingerprint} IS NOT NULL`,
            sql`LEFT(${events.call_seq_fingerprint}, 16) = ${prefix}`
          )
        )
        .limit(input.limit * 5); // over-fetch to allow grouping

      // Group by run_id and count exact matches
      const runMatchCounts = new Map<string, number>();
      for (const row of matchingEvents) {
        const current = runMatchCounts.get(row.run_id) ?? 0;
        runMatchCounts.set(row.run_id, current + 1);
      }

      // Get top-k run_ids by match count
      const sortedRunIds = [...runMatchCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, input.limit)
        .map(([runId]) => runId);

      if (sortedRunIds.length === 0) {
        return { runs: [], scope_message: null };
      }

      // Fetch run details
      const matchedRuns = await ctx.db
        .select({
          run_id: runs.run_id,
          agent_name: runs.agent_name,
          status: runs.status,
          total_cost_usd: runs.total_cost_usd,
          total_call_count: runs.total_call_count,
          started_at: runs.started_at,
          ended_at: runs.ended_at,
        })
        .from(runs)
        .where(and(eq(runs.tenant_id, tenantId), sql`${runs.run_id} = ANY(${sortedRunIds})`));

      return { runs: matchedRuns, scope_message: null };
    }),

  /**
   * Create a supervisor proposal.
   *
   * Called by the supervisor's propose_budget_adjustment and flag_for_review tools.
   */
  createProposal: apiKeyProcedure
    .input(
      z.object({
        proposal_id: z.string().min(1),
        supervisor_run_id: z.string().min(1),
        trigger_run_id: z.string().uuid().optional(),
        proposal_type: z.string().min(1),
        target_agent: z.string().optional(),
        rationale: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        supporting_runs: z.array(z.string()).optional(),
        proposed_changes: z.unknown().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireSupervisorScope(ctx);
      const tenantId = ctx.tenantId ?? "";

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const [created] = await ctx.db
        .insert(supervisorProposals)
        .values({
          tenant_id: tenantId,
          proposal_id: input.proposal_id,
          supervisor_run_id: input.supervisor_run_id,
          trigger_run_id: input.trigger_run_id ?? null,
          proposal_type: input.proposal_type,
          target_agent: input.target_agent ?? null,
          rationale: input.rationale,
          confidence: input.confidence ?? null,
          supporting_runs: input.supporting_runs ?? null,
          // biome-ignore lint/suspicious/noExplicitAny: jsonb column accepts any JSON
          proposed_changes: (input.proposed_changes as any) ?? null,
          status: "pending",
        })
        .returning({
          id: supervisorProposals.id,
          proposal_id: supervisorProposals.proposal_id,
        });

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create proposal",
        });
      }

      return created;
    }),

  /**
   * Create a supervisor escalation.
   *
   * Called by the supervisor's escalate_to_human tool.
   * The escalate_to_human invariant (ADR-012, C13) guarantees this
   * endpoint is always reachable.
   */
  createEscalation: apiKeyProcedure
    .input(
      z.object({
        escalation_id: z.string().min(1),
        supervisor_run_id: z.string().min(1),
        trigger_run_id: z.string().uuid().optional(),
        severity: z.enum(["low", "medium", "high", "critical"]),
        rationale: z.string().min(1),
        recommendation: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        supporting_runs: z.array(z.string()).optional(),
        timeout_seconds: z.number().int().min(0).optional(),
        timeout_action: z.enum(["deny", "allow", "kill"]).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireSupervisorScope(ctx);
      const tenantId = ctx.tenantId ?? "";

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const [created] = await ctx.db
        .insert(supervisorEscalations)
        .values({
          tenant_id: tenantId,
          escalation_id: input.escalation_id,
          supervisor_run_id: input.supervisor_run_id,
          trigger_run_id: input.trigger_run_id ?? null,
          severity: input.severity,
          rationale: input.rationale,
          recommendation: input.recommendation ?? null,
          confidence: input.confidence ?? null,
          supporting_runs: input.supporting_runs ?? null,
          timeout_seconds: input.timeout_seconds ?? null,
          timeout_action: input.timeout_action ?? null,
          status: "open",
        })
        .returning({
          id: supervisorEscalations.id,
          escalation_id: supervisorEscalations.escalation_id,
        });

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create escalation",
        });
      }

      return created;
    }),

  /**
   * Record a learning entry.
   *
   * Called by the supervisor's record_incident_pattern, update_agent_profile,
   * and record_intervention_outcome tools. Learning records are auto-approved
   * (they are observations, not change requests).
   *
   * Stored in supervisor_proposals with a learning-specific proposal_type.
   */
  recordLearning: apiKeyProcedure
    .input(
      z.object({
        proposal_id: z.string().min(1),
        supervisor_run_id: z.string().min(1),
        trigger_run_id: z.string().uuid().optional(),
        proposal_type: z.enum(["incident_pattern", "agent_profile_update", "intervention_outcome"]),
        target_agent: z.string().optional(),
        rationale: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        supporting_runs: z.array(z.string()).optional(),
        proposed_changes: z.unknown().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireSupervisorScope(ctx);
      const tenantId = ctx.tenantId ?? "";

      const now = new Date();

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const [created] = await ctx.db
        .insert(supervisorProposals)
        .values({
          tenant_id: tenantId,
          proposal_id: input.proposal_id,
          supervisor_run_id: input.supervisor_run_id,
          trigger_run_id: input.trigger_run_id ?? null,
          proposal_type: input.proposal_type,
          target_agent: input.target_agent ?? null,
          rationale: input.rationale,
          confidence: input.confidence ?? null,
          supporting_runs: input.supporting_runs ?? null,
          // biome-ignore lint/suspicious/noExplicitAny: jsonb column accepts any JSON
          proposed_changes: (input.proposed_changes as any) ?? null,
          status: "approved", // auto-approved — learning records, not change requests
          reviewed_at: now,
          review_notes: "Auto-approved learning record",
        })
        .returning({
          id: supervisorProposals.id,
          proposal_id: supervisorProposals.proposal_id,
        });

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to record learning entry",
        });
      }

      return created;
    }),

  /**
   * Emit a supervisor audit event.
   *
   * Unlike events.ingest, this bypasses hash chain verification — supervisor
   * events use a simplified write path because:
   * 1. The supervisor runs on the observation plane (not enforcement).
   * 2. The supervisor's own run has no pre-existing hash chain to continue.
   * 3. Hash values are still stored for future verification if needed.
   *
   * The hash chain for the supervisor's run is built client-side (session.ts)
   * using the same algorithm as the engine.
   */
  emitEvent: apiKeyProcedure
    .input(
      z.object({
        run_id: z.string().uuid(),
        schema_version: z.literal(1),
        event_type: z.string().min(1),
        seq: z.number().int().min(1),
        ts: z.string().datetime(),
        hash: z.string().length(64),
        hash_prev: z.string().length(64).nullable(),
        agent_name: z.string().optional(),
        supervisor_run_id: z.string().optional(),
        trigger: z.string().optional(),
        trigger_run_id: z.string().optional(),
        proposal_id: z.string().optional(),
        proposal_type: z.string().optional(),
        target_agent: z.string().optional(),
        rationale: z.string().optional(),
        confidence: z.number().optional(),
        supporting_runs: z.array(z.string()).optional(),
        status: z.string().optional(),
        escalation_id: z.string().optional(),
        severity: z.string().optional(),
        recommendation: z.string().optional(),
        timeout_seconds: z.number().int().optional(),
        timeout_action: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireSupervisorScope(ctx);
      const tenantId = ctx.tenantId ?? "";

      const rawLine = JSON.stringify(input);

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      await ctx.db
        .insert(events)
        .values({
          run_id: input.run_id,
          tenant_id: tenantId,
          schema_version: input.schema_version,
          event_type: input.event_type,
          seq: input.seq,
          hash: input.hash,
          hash_prev: input.hash_prev,
          ts: new Date(input.ts),
          agent_name: input.agent_name ?? null,
          supervisor_run_id: input.supervisor_run_id ?? null,
          trigger: input.trigger ?? null,
          trigger_run_id: input.trigger_run_id ?? null,
          proposal_id: input.proposal_id ?? null,
          proposal_type: input.proposal_type ?? null,
          target_agent: input.target_agent ?? null,
          rationale: input.rationale ?? null,
          confidence: input.confidence ?? null,
          supporting_runs: input.supporting_runs ?? null,
          status: input.status ?? null,
          escalation_id: input.escalation_id ?? null,
          severity: input.severity ?? null,
          recommendation: input.recommendation ?? null,
          timeout_seconds: input.timeout_seconds ?? null,
          timeout_action: input.timeout_action ?? null,
          raw_line: rawLine,
        })
        .onConflictDoNothing({ target: [events.run_id, events.seq] });

      // Upsert the supervisor's run record
      const existingRun = await ctx.db
        .select({ run_id: runs.run_id })
        .from(runs)
        .where(and(eq(runs.run_id, input.run_id), eq(runs.tenant_id, tenantId)))
        .limit(1);

      if (existingRun.length === 0) {
        await ctx.db
          .insert(runs)
          .values({
            run_id: input.run_id,
            tenant_id: tenantId,
            agent_name: input.agent_name ?? "loopstorm-supervisor",
            status: "started",
            event_count: 1,
            last_seq: input.seq,
            last_hash: input.hash,
            total_cost_usd: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_call_count: 0,
            started_at: new Date(input.ts),
          })
          .onConflictDoNothing({ target: runs.run_id });
      } else {
        await ctx.db
          .update(runs)
          .set({
            last_seq: input.seq,
            last_hash: input.hash,
            event_count: sql`${runs.event_count} + 1`,
            updated_at: new Date(),
          })
          .where(and(eq(runs.run_id, input.run_id), eq(runs.tenant_id, tenantId)));
      }

      return { ok: true };
    }),
});
