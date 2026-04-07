// SPDX-License-Identifier: MIT
/**
 * Interpretation tools — compute locally, no LLM calls.
 *
 * 3 tools: compute_risk_score, analyze_loop_pattern, evaluate_recovery_effectiveness
 */

import type { BackendClient } from "../lib/backend-client.js";
import { analyzeLoopPattern } from "../lib/loop-analysis.js";
import { evaluateRecoveryEffectiveness } from "../lib/recovery-eval.js";
import { computeRiskScore } from "../lib/risk-score.js";

export async function computeRiskScoreTool(client: BackendClient, params: { run_id: string }) {
  // Fetch run events
  const eventsResult = await client.supervisorTools.getRunEvents.query({
    run_id: params.run_id,
    limit: 1000,
  });

  // Fetch run info (via events - extract from first event's data)
  // We need run status and cost — get from the last run_ended event or aggregate
  const runEvents = eventsResult.items;
  const lastEvent = runEvents[runEvents.length - 1];
  const runEndedEvent = runEvents.find((e) => e.event_type === "run_ended");

  // Try to get agent baseline
  const agentName = runEvents[0]?.agent_name;
  let baseline = null;
  if (agentName) {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: tRPC inference returns union; cast for property access
      const baselineResult: any = await client.supervisorTools.getAgentBaseline.query({
        agent_name: agentName,
      });
      if (!baselineResult.warning) {
        baseline = {
          run_count: baselineResult.run_count as number,
          avg_deny_rate: (baselineResult.avg_deny_rate as number | null) ?? 0,
        };
      }
    } catch {
      // Baseline unavailable — continue without it
    }
  }

  const run = {
    run_id: params.run_id,
    status:
      (runEndedEvent?.run_status ?? lastEvent?.event_type === "run_ended")
        ? "completed"
        : "running",
    total_cost_usd: runEvents.reduce(
      (sum: number, e) => sum + ((e.estimated_cost_usd as number | null) ?? 0),
      0
    ),
  };

  const eventInfos = runEvents.map((e) => ({
    seq: e.seq,
    event_type: e.event_type,
    decision: e.decision,
    tool: e.tool,
    call_seq_fingerprint: e.call_seq_fingerprint,
    inter_call_ms: e.inter_call_ms,
    token_rate_delta: e.token_rate_delta,
    param_shape_hash: e.param_shape_hash,
    budget: e.budget as { cost_usd?: { hard?: number } } | null,
  }));

  return computeRiskScore(run, eventInfos, baseline);
}

export async function analyzeLoopPatternTool(client: BackendClient, params: { run_id: string }) {
  const eventsResult = await client.supervisorTools.getRunEvents.query({
    run_id: params.run_id,
    limit: 1000,
  });

  const eventInfos = eventsResult.items.map((e) => ({
    seq: e.seq,
    event_type: e.event_type,
    tool: e.tool,
    args_hash: e.args_hash,
    call_seq_fingerprint: e.call_seq_fingerprint,
  }));

  return analyzeLoopPattern(eventInfos);
}

export async function evaluateRecoveryEffectivenessTool(
  client: BackendClient,
  params: { run_id: string; intervention_seq: number }
) {
  const eventsResult = await client.supervisorTools.getRunEvents.query({
    run_id: params.run_id,
    limit: 1000,
  });

  const eventInfos = eventsResult.items.map((e) => ({
    seq: e.seq,
    event_type: e.event_type,
    call_seq_fingerprint: e.call_seq_fingerprint,
    tool: e.tool,
  }));

  return evaluateRecoveryEffectiveness(eventInfos, params.intervention_seq);
}
