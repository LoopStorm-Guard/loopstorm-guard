// SPDX-License-Identifier: MIT
/**
 * Deterministic recovery effectiveness evaluation for the AI Supervisor.
 *
 * Compares events before and after an intervention point to determine
 * if the intervention changed the agent's behavior.
 *
 * This is a PURE function — no I/O, no LLM calls, fully deterministic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecoveryVerdict = "effective" | "ineffective" | "partial" | "insufficient_data";

export interface RecoveryResult {
  /** The intervention sequence number. */
  intervention_seq: number;
  /** The verdict. */
  verdict: RecoveryVerdict;
  /** Human-readable explanation. */
  explanation: string;
  /** Fingerprint before intervention (null if BT fields absent). */
  pre_fingerprint: string | null;
  /** Fingerprint after intervention (null if BT fields absent or no post events). */
  post_fingerprint: string | null;
}

export interface RecoveryEventInfo {
  seq: number;
  event_type: string;
  call_seq_fingerprint: string | null;
  tool: string | null;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate recovery effectiveness at a specific intervention point.
 *
 * @param events          - All events in the run, sorted by seq.
 * @param interventionSeq - The seq number of the intervention event.
 * @returns Recovery evaluation result.
 */
export function evaluateRecoveryEffectiveness(
  events: RecoveryEventInfo[],
  interventionSeq: number
): RecoveryResult {
  const policyDecisions = events.filter((e) => e.event_type === "policy_decision");

  // Find events before and after intervention
  const preEvents = policyDecisions.filter((e) => e.seq < interventionSeq).slice(-5);
  const postEvents = policyDecisions.filter((e) => e.seq > interventionSeq).slice(0, 5);

  if (preEvents.length === 0 || postEvents.length === 0) {
    return {
      intervention_seq: interventionSeq,
      verdict: "insufficient_data",
      explanation: `Insufficient events around intervention at seq ${interventionSeq} (${preEvents.length} before, ${postEvents.length} after).`,
      pre_fingerprint: null,
      post_fingerprint: null,
    };
  }

  // Check fingerprint-based recovery (BT fields)
  const preFpEvents = preEvents.filter((e) => e.call_seq_fingerprint !== null);
  const postFpEvents = postEvents.filter((e) => e.call_seq_fingerprint !== null);

  const preFp =
    preFpEvents.length > 0
      ? (preFpEvents[preFpEvents.length - 1]?.call_seq_fingerprint ?? null)
      : null;
  const postFp = postFpEvents.length > 0 ? (postFpEvents[0]?.call_seq_fingerprint ?? null) : null;

  if (preFp !== null && postFp !== null) {
    if (preFp !== postFp) {
      return {
        intervention_seq: interventionSeq,
        verdict: "effective",
        explanation: `Intervention at seq ${interventionSeq} changed behavior: fingerprint changed from ${preFp.slice(0, 16)}... to ${postFp.slice(0, 16)}...`,
        pre_fingerprint: preFp,
        post_fingerprint: postFp,
      };
    }

    // Same fingerprint — check if tools changed (partial recovery)
    const preTools = new Set(preEvents.map((e) => e.tool).filter(Boolean));
    const postTools = new Set(postEvents.map((e) => e.tool).filter(Boolean));
    const toolsChanged =
      ![...preTools].every((t) => postTools.has(t)) ||
      ![...postTools].every((t) => preTools.has(t));

    if (toolsChanged) {
      return {
        intervention_seq: interventionSeq,
        verdict: "partial",
        explanation: `Intervention at seq ${interventionSeq}: fingerprint unchanged but tool set differs (partial behavior change).`,
        pre_fingerprint: preFp,
        post_fingerprint: postFp,
      };
    }

    return {
      intervention_seq: interventionSeq,
      verdict: "ineffective",
      explanation: `Intervention at seq ${interventionSeq} had no effect: fingerprint and tools unchanged.`,
      pre_fingerprint: preFp,
      post_fingerprint: postFp,
    };
  }

  // BT fields absent — fall back to tool-based analysis
  const preTools = preEvents.map((e) => e.tool).join(",");
  const postTools = postEvents.map((e) => e.tool).join(",");

  if (preTools !== postTools) {
    return {
      intervention_seq: interventionSeq,
      verdict: "partial",
      explanation: `Intervention at seq ${interventionSeq}: tool sequence changed (BT fields absent for precise measurement).`,
      pre_fingerprint: null,
      post_fingerprint: null,
    };
  }

  return {
    intervention_seq: interventionSeq,
    verdict: "ineffective",
    explanation: `Intervention at seq ${interventionSeq}: tool sequence unchanged (BT fields absent for precise measurement).`,
    pre_fingerprint: null,
    post_fingerprint: null,
  };
}
