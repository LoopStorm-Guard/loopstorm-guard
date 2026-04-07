// SPDX-License-Identifier: MIT
/**
 * Deterministic loop pattern analysis for the AI Supervisor.
 *
 * Scans events for loop_detected events, identifies repeated patterns
 * (tool + args_hash sequences), and checks if behavior changed after cooldown.
 *
 * This is a PURE function — no I/O, no LLM calls, fully deterministic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoopPattern {
  /** Sequence number of the loop_detected event. */
  loop_seq: number;
  /** The repeating tool sequence detected. */
  repeated_tools: string[];
  /** Whether behavior changed after the cooldown. */
  recovered: boolean;
  /** Human-readable description. */
  description: string;
}

export interface LoopAnalysisResult {
  /** Number of loop events found. */
  loop_count: number;
  /** Individual loop patterns. */
  patterns: LoopPattern[];
  /** Overall narrative. */
  narrative: string;
}

export interface LoopEventInfo {
  seq: number;
  event_type: string;
  tool: string | null;
  args_hash: string | null;
  call_seq_fingerprint: string | null;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze loop patterns in a run's events.
 */
export function analyzeLoopPattern(events: LoopEventInfo[]): LoopAnalysisResult {
  const loopEvents = events.filter((e) => e.event_type === "loop_detected");

  if (loopEvents.length === 0) {
    return {
      loop_count: 0,
      patterns: [],
      narrative: "No loop detections found in this run.",
    };
  }

  const patterns: LoopPattern[] = [];

  for (const loopEvent of loopEvents) {
    // Find the repeating tool sequence before the loop event
    const preLoopDecisions = events.filter(
      (e) => e.seq < loopEvent.seq && e.event_type === "policy_decision" && e.tool !== null
    );

    // Extract the last N tools to identify the pattern
    const recentTools = preLoopDecisions.slice(-6).map((e) => e.tool as string);

    // Check recovery: did call_seq_fingerprint change after cooldown?
    const postLoopDecisions = events.filter(
      (e) => e.seq > loopEvent.seq && e.event_type === "policy_decision"
    );

    let recovered = false;
    if (postLoopDecisions.length > 0) {
      const preFpEvents = preLoopDecisions.filter((e) => e.call_seq_fingerprint !== null);
      const preFp =
        preFpEvents.length > 0 ? preFpEvents[preFpEvents.length - 1]?.call_seq_fingerprint : null;
      const postFp = postLoopDecisions[0]?.call_seq_fingerprint ?? null;

      if (preFp !== null && postFp !== null) {
        recovered = preFp !== postFp;
      } else {
        // BT fields absent — cannot determine recovery
        recovered = false;
      }
    }

    patterns.push({
      loop_seq: loopEvent.seq,
      repeated_tools: recentTools,
      recovered,
      description: recovered
        ? `Loop at seq ${loopEvent.seq}: tools [${recentTools.join(", ")}] — behavior changed after cooldown`
        : `Loop at seq ${loopEvent.seq}: tools [${recentTools.join(", ")}] — behavior did NOT change after cooldown`,
    });
  }

  const unrecoveredCount = patterns.filter((p) => !p.recovered).length;
  const narrative =
    unrecoveredCount > 0
      ? `${loopEvents.length} loop detection(s) found. ${unrecoveredCount} loop(s) did not recover after cooldown. This indicates cooldown may be ineffective.`
      : `${loopEvents.length} loop detection(s) found. All loops recovered after cooldown.`;

  return { loop_count: loopEvents.length, patterns, narrative };
}
