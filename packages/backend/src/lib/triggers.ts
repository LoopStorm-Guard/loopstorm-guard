// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Trigger evaluation logic for the AI Supervisor.
 *
 * These functions determine WHEN to start a supervisor session by inspecting
 * run state and events. They are called inline during event ingest (after the
 * DB transaction commits) and must be:
 *
 *   - PURE: no DB access, no side effects, no I/O.
 *   - FAST: a few comparisons — adds < 1 ms to the ingest hot path.
 *   - DETERMINISTIC: same inputs always produce the same TriggerResult[].
 *
 * Dispatch to the supervisor process is handled separately by the trigger
 * queue/dispatch layer (SUP-A4). This module only evaluates; it never sends.
 *
 * Spec reference: specs/task-briefs/v1.1-ai-supervisor.md, Section 3, Task SUP-A3.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single trigger that fired, with its priority.
 *
 * Priority:
 *   1 = critical  (terminated states — needs immediate attention)
 *   2 = high      (cost warnings, loop events, deny spikes)
 *   3 = medium    (abandoned, any deny, repeated rule)
 *   4 = low       (reserved for future use)
 */
export interface TriggerResult {
  trigger: string;
  priority: number;
}

/**
 * Running counters maintained by the ingest pipeline across events in a run.
 * These are passed in (not computed here) to keep evaluation pure.
 *
 * `rule_id_counts` tracks how many times each rule_id has fired in this run.
 */
export interface RunningCounters {
  deny_count: number;
  total_decisions: number;
  rule_id_counts: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Built-in rule ID prefix — these rules fire frequently by design. */
const BUILTIN_PREFIX = "__builtin_";

/** Budget fraction that triggers `high_cost` (post-run). */
const HIGH_COST_FRACTION = 0.8;

/** Budget fraction that triggers `budget_warning` (mid-run). */
const BUDGET_WARNING_FRACTION = 0.7;

/** Deny spike multiplier over baseline to trigger `deny_spike`. */
const DENY_SPIKE_MULTIPLIER = 3;

/** Minimum absolute deny count before `deny_spike` can fire (avoids noise on tiny runs). */
const DENY_SPIKE_MIN_COUNT = 5;

/** Absolute deny-rate fallback threshold when no baseline is available (50 %). */
const DENY_SPIKE_ABSOLUTE_FALLBACK = 0.5;

/** How many times the same rule_id must appear to trigger `repeated_rule`. */
const REPEATED_RULE_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Post-run trigger evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate which post-run triggers should fire after a run has ended.
 *
 * Call this once per run, AFTER the run has transitioned to a terminal
 * status (completed, terminated_budget, terminated_loop, abandoned).
 *
 * @param run            - The run's final state.
 * @param events         - All events in the run (any order).
 * @param budgetHardCap  - The hard-cap cost in USD, or null if uncapped.
 * @returns Array of fired triggers, sorted ascending by priority (1 first).
 */
export function evaluatePostRunTriggers(
  run: { status: string; total_cost_usd: number },
  events: Array<{ event_type: string; decision: string | null }>,
  budgetHardCap: number | null
): TriggerResult[] {
  const fired: TriggerResult[] = [];

  // --- T1: terminated_budget (priority 1 — critical) -----------------------
  if (run.status === "terminated_budget") {
    fired.push({ trigger: "terminated_budget", priority: 1 });
  }

  // --- T2: terminated_loop (priority 1 — critical) -------------------------
  if (run.status === "terminated_loop") {
    fired.push({ trigger: "terminated_loop", priority: 1 });
  }

  // --- T3: high_cost (priority 2 — high) -----------------------------------
  // Only fires if a hard cap is configured.
  if (budgetHardCap !== null && run.total_cost_usd > HIGH_COST_FRACTION * budgetHardCap) {
    fired.push({ trigger: "high_cost", priority: 2 });
  }

  // --- T4: abandoned (priority 3 — medium) ---------------------------------
  if (run.status === "abandoned") {
    fired.push({ trigger: "abandoned", priority: 3 });
  }

  // --- T5: deny_decisions (priority 3 — medium) ----------------------------
  const hasDeny = events.some((e) => e.decision === "deny");
  if (hasDeny) {
    fired.push({ trigger: "deny_decisions", priority: 3 });
  }

  // Sort ascending by priority (1=critical first).
  return sortByPriority(fired);
}

// ---------------------------------------------------------------------------
// Mid-run trigger evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate which mid-run triggers should fire after a single new event has
 * been processed.
 *
 * Call this once per event, AFTER the event has been written to the DB, with
 * the running counters that now include the new event's contribution.
 *
 * @param run              - The run's current aggregate state (after the new event).
 * @param newEvent         - The event that was just processed.
 * @param runningCounters  - Running deny/decision/rule tallies (inclusive of newEvent).
 * @param agentBaseline    - Historical deny rate for this agent, or null if unavailable.
 * @param budgetHardCap    - The hard-cap cost in USD, or null if uncapped.
 * @returns Array of fired triggers, sorted ascending by priority (1 first).
 */
export function evaluateMidRunTriggers(
  run: {
    status: string;
    total_cost_usd: number;
    total_call_count: number;
  },
  newEvent: {
    event_type: string;
    decision: string | null;
    rule_id: string | null;
  },
  runningCounters: RunningCounters,
  agentBaseline: { avg_deny_rate: number } | null,
  budgetHardCap: number | null
): TriggerResult[] {
  const fired: TriggerResult[] = [];

  // --- M1: budget_warning (priority 2 — high) ------------------------------
  // Only fires if a hard cap is configured.
  if (budgetHardCap !== null && run.total_cost_usd > BUDGET_WARNING_FRACTION * budgetHardCap) {
    fired.push({ trigger: "budget_warning", priority: 2 });
  }

  // --- M2: loop_detected (priority 2 — high) -------------------------------
  if (newEvent.event_type === "loop_detected") {
    fired.push({ trigger: "loop_detected", priority: 2 });
  }

  // --- M3: deny_spike (priority 2 — high) ----------------------------------
  // Requires minimum absolute deny count to avoid noise on small runs.
  if (runningCounters.deny_count >= DENY_SPIKE_MIN_COUNT) {
    const denyRate =
      runningCounters.total_decisions > 0
        ? runningCounters.deny_count / runningCounters.total_decisions
        : 0;

    const threshold =
      agentBaseline !== null
        ? DENY_SPIKE_MULTIPLIER * agentBaseline.avg_deny_rate
        : DENY_SPIKE_ABSOLUTE_FALLBACK;

    if (denyRate > threshold) {
      fired.push({ trigger: "deny_spike", priority: 2 });
    }
  }

  // --- M4: repeated_rule (priority 3 — medium) -----------------------------
  // Excludes __builtin_* rule_ids — they fire frequently by design.
  if (newEvent.rule_id !== null && !newEvent.rule_id.startsWith(BUILTIN_PREFIX)) {
    const count = runningCounters.rule_id_counts.get(newEvent.rule_id) ?? 0;
    if (count >= REPEATED_RULE_THRESHOLD) {
      fired.push({ trigger: "repeated_rule", priority: 3 });
    }
  }

  // Sort ascending by priority (1=critical first).
  return sortByPriority(fired);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Sort TriggerResult[] ascending by priority (lowest number = highest urgency).
 * Stable across ties (original order preserved within the same priority).
 */
function sortByPriority(triggers: TriggerResult[]): TriggerResult[] {
  return triggers.slice().sort((a, b) => a.priority - b.priority);
}
