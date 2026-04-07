// SPDX-License-Identifier: MIT
/**
 * Deterministic risk scoring algorithm for agent runs.
 *
 * Implements the exact algorithm from specs/risk-score-algorithm.md Section 3.
 * 8 signals with fixed weights, score capped at 100, 4 tiers.
 *
 * This is a PURE function — no I/O, no LLM calls, fully deterministic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskSignal {
  id: string;
  name: string;
  weight: number;
  evidence: string;
}

export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskAssessment {
  run_id: string;
  score: number;
  tier: RiskTier;
  signals: RiskSignal[];
  narrative: string;
  confidence: number;
}

export interface RunInfo {
  run_id: string;
  status: string;
  total_cost_usd: number;
}

export interface EventInfo {
  seq: number;
  event_type: string;
  decision: string | null;
  tool: string | null;
  call_seq_fingerprint: string | null;
  inter_call_ms: number | null;
  token_rate_delta: number | null;
  param_shape_hash: string | null;
  budget?: { cost_usd?: { hard?: number } } | null;
}

export interface BaselineInfo {
  run_count: number;
  avg_deny_rate: number;
}

// ---------------------------------------------------------------------------
// Algorithm
// ---------------------------------------------------------------------------

/**
 * Compute the risk score for a run.
 *
 * @param run      - Run aggregate state.
 * @param events   - All events in the run.
 * @param baseline - Agent baseline statistics, or null if unavailable.
 * @returns A deterministic RiskAssessment.
 */
export function computeRiskScore(
  run: RunInfo,
  events: EventInfo[],
  baseline: BaselineInfo | null
): RiskAssessment {
  const signals: RiskSignal[] = [];

  // --- S1: high_deny_rate (weight 25) ---
  const denyCount = events.filter((e) => e.decision === "deny").length;
  const totalDecisions = events.filter((e) => e.event_type === "policy_decision").length;
  if (totalDecisions > 0) {
    const denyRate = denyCount / totalDecisions;
    let threshold: number;
    if (baseline !== null && baseline.run_count >= 3) {
      threshold = Math.max(2 * baseline.avg_deny_rate, 0.1);
    } else {
      threshold = 0.3;
    }
    if (denyRate > threshold && denyCount >= 3) {
      signals.push({
        id: "S1",
        name: "high_deny_rate",
        weight: 25,
        evidence: `${denyCount} denies out of ${totalDecisions} decisions (${(denyRate * 100).toFixed(1)}%), baseline is ${baseline !== null ? (baseline.avg_deny_rate * 100).toFixed(1) : "N/A"}%`,
      });
    }
  }

  // --- S2: budget_near_cap (weight 20) ---
  const budgetHardCap = extractBudgetHardCap(events);
  if (budgetHardCap !== null && run.total_cost_usd > 0.8 * budgetHardCap) {
    signals.push({
      id: "S2",
      name: "budget_near_cap",
      weight: 20,
      evidence: `Cost $${run.total_cost_usd.toFixed(2)} exceeds 80% of $${budgetHardCap.toFixed(2)} hard cap`,
    });
  }

  // --- S3: budget_exceeded (weight 30) ---
  if (run.status === "terminated_budget") {
    signals.push({
      id: "S3",
      name: "budget_exceeded",
      weight: 30,
      evidence: "Run terminated by budget breach",
    });
  }

  // --- S4: loop_detected (weight 20) ---
  const loopEvents = events.filter((e) => e.event_type === "loop_detected");
  if (loopEvents.length > 0) {
    signals.push({
      id: "S4",
      name: "loop_detected",
      weight: 20,
      evidence: `${loopEvents.length} loop detection(s) fired`,
    });
  }

  // --- S5: loop_unrecovered (weight 15, requires BT fields) ---
  if (loopEvents.length > 0) {
    for (const loopEvent of loopEvents) {
      const postCooldownEvents = events.filter(
        (e) => e.seq > loopEvent.seq && e.event_type === "policy_decision"
      );
      if (postCooldownEvents.length > 0) {
        // Find the last fingerprint before the loop
        const preEvents = events.filter(
          (e) => e.seq < loopEvent.seq && e.call_seq_fingerprint !== null
        );
        const preFp =
          preEvents.length > 0 ? preEvents[preEvents.length - 1]?.call_seq_fingerprint : null;
        const postFp = postCooldownEvents[0]?.call_seq_fingerprint ?? null;

        if (preFp !== null && postFp !== null && preFp === postFp) {
          signals.push({
            id: "S5",
            name: "loop_unrecovered",
            weight: 15,
            evidence: `Loop detected at seq ${loopEvent.seq} but behavior did not change after cooldown`,
          });
          break; // Only count once
        }
      }
    }
  }

  // --- S6: rapid_fire (weight 10, requires BT fields) ---
  const interCallValues = events
    .filter((e) => e.inter_call_ms !== null && e.inter_call_ms > 0)
    .map((e) => e.inter_call_ms as number);
  if (interCallValues.length >= 3) {
    const medianMs = median(interCallValues);
    if (medianMs < 100) {
      signals.push({
        id: "S6",
        name: "rapid_fire",
        weight: 10,
        evidence: `Median inter-call time ${medianMs}ms (< 100ms threshold)`,
      });
    }
  }

  // --- S7: structural_drift (weight 10, requires BT fields) ---
  const toolShapes = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.tool && e.param_shape_hash) {
      let shapes = toolShapes.get(e.tool);
      if (!shapes) {
        shapes = new Set();
        toolShapes.set(e.tool, shapes);
      }
      shapes.add(e.param_shape_hash);
    }
  }
  const toolUseCounts = new Map<string, number>();
  for (const e of events) {
    if (e.tool && e.param_shape_hash) {
      toolUseCounts.set(e.tool, (toolUseCounts.get(e.tool) ?? 0) + 1);
    }
  }
  for (const [tool, shapes] of toolShapes) {
    const useCount = toolUseCounts.get(tool) ?? 0;
    if (useCount >= 3 && shapes.size > 3) {
      signals.push({
        id: "S7",
        name: "structural_drift",
        weight: 10,
        evidence: `Tool ${tool} used ${useCount} times with ${shapes.size} distinct parameter structures`,
      });
      break; // Only count once
    }
  }

  // --- S8: abnormal_token_spike (weight 15, requires BT fields) ---
  let maxDelta = 0;
  let maxDeltaSeq = 0;
  for (const e of events) {
    if (e.token_rate_delta !== null && e.token_rate_delta > maxDelta) {
      maxDelta = e.token_rate_delta;
      maxDeltaSeq = e.seq;
    }
  }
  if (maxDelta > 5.0) {
    signals.push({
      id: "S8",
      name: "abnormal_token_spike",
      weight: 15,
      evidence: `Token spike of ${maxDelta.toFixed(1)}x detected at seq ${maxDeltaSeq}`,
    });
  }

  // --- Compute score ---
  const rawScore = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = Math.min(rawScore, 100);

  // --- Determine tier ---
  const tier = scoreTier(score);

  // --- Compute confidence ---
  const eventFactor = Math.min(1.0, events.length / 10);
  let baselineFactor: number;
  if (baseline !== null && baseline.run_count >= 10) {
    baselineFactor = 1.0;
  } else if (baseline !== null && baseline.run_count >= 3) {
    baselineFactor = 0.7;
  } else {
    baselineFactor = 0.4;
  }
  const confidence = Math.round(eventFactor * baselineFactor * 100) / 100;

  // --- Build narrative ---
  const narrative = buildNarrative(score, tier, signals, confidence);

  return { run_id: run.run_id, score, tier, signals, narrative, confidence };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreTier(score: number): RiskTier {
  if (score <= 25) return "LOW";
  if (score <= 50) return "MEDIUM";
  if (score <= 75) return "HIGH";
  return "CRITICAL";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

function extractBudgetHardCap(events: EventInfo[]): number | null {
  // Find the last event with budget data
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.budget && typeof e.budget === "object" && "cost_usd" in e.budget) {
      const costUsd = (e.budget as { cost_usd?: { hard?: number } }).cost_usd;
      if (costUsd?.hard !== undefined) {
        return costUsd.hard;
      }
    }
  }
  return null;
}

function buildNarrative(
  score: number,
  tier: RiskTier,
  signals: RiskSignal[],
  confidence: number
): string {
  if (signals.length === 0) {
    return `Risk assessment: ${tier} (${score}/100, confidence ${confidence}). No risk signals detected.`;
  }

  const signalNames = signals.map((s) => s.name).join(", ");
  const signalDetails = signals.map((s) => `- ${s.name} (${s.weight}): ${s.evidence}`).join("\n");

  return `Risk assessment: ${tier} (${score}/100, confidence ${confidence}). ${signals.length} risk signal(s) detected: ${signalNames}.\n${signalDetails}`;
}
