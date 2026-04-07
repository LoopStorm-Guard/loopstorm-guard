// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for the trigger evaluation library.
 *
 * These tests are pure — no database required, no network access.
 * Covers all 14 acceptance criteria (AC-A3-1 through AC-A3-14).
 *
 * AC-A3-1:  evaluatePostRunTriggers fires on terminated_budget
 * AC-A3-2:  evaluatePostRunTriggers fires on terminated_loop
 * AC-A3-3:  evaluatePostRunTriggers fires on abandoned
 * AC-A3-4:  evaluatePostRunTriggers fires on deny_decisions (any deny present)
 * AC-A3-5:  evaluatePostRunTriggers fires on high_cost when > 80 % of hard cap
 * AC-A3-6:  evaluatePostRunTriggers does NOT fire high_cost when budget is null
 * AC-A3-7:  evaluateMidRunTriggers fires budget_warning at 70 %
 * AC-A3-8:  evaluateMidRunTriggers fires on loop_detected event
 * AC-A3-9:  evaluateMidRunTriggers fires deny_spike with baseline
 * AC-A3-10: evaluateMidRunTriggers fires deny_spike with absolute fallback (50 %)
 * AC-A3-11: evaluateMidRunTriggers fires repeated_rule (3+ same rule_id)
 * AC-A3-12: evaluateMidRunTriggers does NOT fire repeated_rule for __builtin_* rule_ids
 * AC-A3-13: Priority ordering is correct (1 = critical first)
 * AC-A3-14: All trigger functions are pure (no DB access, no side effects)
 */

import { describe, expect, test } from "bun:test";
import {
  type RunningCounters,
  type TriggerResult,
  evaluateMidRunTriggers,
  evaluatePostRunTriggers,
} from "../../src/lib/triggers.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a RunningCounters with sane defaults. */
function makeCounters(
  deny_count = 0,
  total_decisions = 0,
  rule_id_counts: Map<string, number> = new Map()
): RunningCounters {
  return { deny_count, total_decisions, rule_id_counts };
}

/** Return the set of trigger names from a result array. */
function triggerNames(results: TriggerResult[]): string[] {
  return results.map((r) => r.trigger);
}

/** Assert that a result array is sorted ascending by priority. */
function assertSortedByPriority(results: TriggerResult[]): void {
  for (let i = 1; i < results.length; i++) {
    expect(results[i]?.priority).toBeGreaterThanOrEqual(results[i - 1]?.priority);
  }
}

// Shared baselines
const NO_BASELINE = null;
const BASELINE_10PCT = { avg_deny_rate: 0.1 }; // 10 % historical deny rate

// ---------------------------------------------------------------------------
// evaluatePostRunTriggers
// ---------------------------------------------------------------------------

describe("evaluatePostRunTriggers", () => {
  // AC-A3-1: fires on terminated_budget
  test("AC-A3-1: fires terminated_budget trigger for terminated_budget status", () => {
    const result = evaluatePostRunTriggers(
      { status: "terminated_budget", total_cost_usd: 0.5 },
      [],
      10.0
    );
    expect(triggerNames(result)).toContain("terminated_budget");
    const t = result.find((r) => r.trigger === "terminated_budget")!;
    expect(t.priority).toBe(1);
  });

  // AC-A3-1: does NOT fire terminated_budget for unrelated statuses
  test("AC-A3-1: does not fire terminated_budget for completed status", () => {
    const result = evaluatePostRunTriggers({ status: "completed", total_cost_usd: 0.0 }, [], null);
    expect(triggerNames(result)).not.toContain("terminated_budget");
  });

  // AC-A3-2: fires on terminated_loop
  test("AC-A3-2: fires terminated_loop trigger for terminated_loop status", () => {
    const result = evaluatePostRunTriggers(
      { status: "terminated_loop", total_cost_usd: 0.0 },
      [],
      null
    );
    expect(triggerNames(result)).toContain("terminated_loop");
    const t = result.find((r) => r.trigger === "terminated_loop")!;
    expect(t.priority).toBe(1);
  });

  // AC-A3-2: does NOT fire terminated_loop for unrelated statuses
  test("AC-A3-2: does not fire terminated_loop for completed status", () => {
    const result = evaluatePostRunTriggers({ status: "completed", total_cost_usd: 0.0 }, [], null);
    expect(triggerNames(result)).not.toContain("terminated_loop");
  });

  // AC-A3-3: fires on abandoned
  test("AC-A3-3: fires abandoned trigger for abandoned status", () => {
    const result = evaluatePostRunTriggers({ status: "abandoned", total_cost_usd: 0.0 }, [], null);
    expect(triggerNames(result)).toContain("abandoned");
    const t = result.find((r) => r.trigger === "abandoned")!;
    expect(t.priority).toBe(3);
  });

  // AC-A3-3: does NOT fire abandoned for completed
  test("AC-A3-3: does not fire abandoned for completed status", () => {
    const result = evaluatePostRunTriggers({ status: "completed", total_cost_usd: 0.0 }, [], null);
    expect(triggerNames(result)).not.toContain("abandoned");
  });

  // AC-A3-4: fires deny_decisions when any event has decision === "deny"
  test("AC-A3-4: fires deny_decisions when at least one event is denied", () => {
    const events = [
      { event_type: "policy_decision", decision: "allow" },
      { event_type: "policy_decision", decision: "deny" },
      { event_type: "policy_decision", decision: "allow" },
    ];
    const result = evaluatePostRunTriggers(
      { status: "completed", total_cost_usd: 0.0 },
      events,
      null
    );
    expect(triggerNames(result)).toContain("deny_decisions");
    const t = result.find((r) => r.trigger === "deny_decisions")!;
    expect(t.priority).toBe(3);
  });

  // AC-A3-4: does NOT fire when no events have decision === "deny"
  test("AC-A3-4: does not fire deny_decisions when all decisions are allow", () => {
    const events = [
      { event_type: "policy_decision", decision: "allow" },
      { event_type: "tool_call", decision: null },
    ];
    const result = evaluatePostRunTriggers(
      { status: "completed", total_cost_usd: 0.0 },
      events,
      null
    );
    expect(triggerNames(result)).not.toContain("deny_decisions");
  });

  // AC-A3-4: fires deny_decisions with exactly one deny in an empty-otherwise batch
  test("AC-A3-4: fires deny_decisions with a single deny event", () => {
    const result = evaluatePostRunTriggers(
      { status: "completed", total_cost_usd: 0.0 },
      [{ event_type: "policy_decision", decision: "deny" }],
      null
    );
    expect(triggerNames(result)).toContain("deny_decisions");
  });

  // AC-A3-5: fires high_cost when cost > 80 % of hard cap
  test("AC-A3-5: fires high_cost when total_cost_usd exceeds 80 % of hard cap", () => {
    // 0.81 > 0.80 * 1.00
    const result = evaluatePostRunTriggers({ status: "completed", total_cost_usd: 0.81 }, [], 1.0);
    expect(triggerNames(result)).toContain("high_cost");
    const t = result.find((r) => r.trigger === "high_cost")!;
    expect(t.priority).toBe(2);
  });

  // AC-A3-5: does NOT fire when exactly at the boundary (not strictly greater)
  test("AC-A3-5: does not fire high_cost at exactly 80 % of hard cap (strict >)", () => {
    const result = evaluatePostRunTriggers({ status: "completed", total_cost_usd: 0.8 }, [], 1.0);
    expect(triggerNames(result)).not.toContain("high_cost");
  });

  // AC-A3-5: does NOT fire when below 80 %
  test("AC-A3-5: does not fire high_cost when below 80 % of hard cap", () => {
    const result = evaluatePostRunTriggers({ status: "completed", total_cost_usd: 0.79 }, [], 1.0);
    expect(triggerNames(result)).not.toContain("high_cost");
  });

  // AC-A3-6: does NOT fire high_cost when budgetHardCap is null
  test("AC-A3-6: does not fire high_cost when budgetHardCap is null", () => {
    // Extremely high cost — should not trigger because no cap is configured
    const result = evaluatePostRunTriggers(
      { status: "completed", total_cost_usd: 9999.0 },
      [],
      null
    );
    expect(triggerNames(result)).not.toContain("high_cost");
  });

  // Multiple triggers fire simultaneously
  test("multiple post-run triggers can fire in a single call", () => {
    const result = evaluatePostRunTriggers(
      { status: "terminated_budget", total_cost_usd: 0.9 },
      [{ event_type: "policy_decision", decision: "deny" }],
      1.0
    );
    const names = triggerNames(result);
    expect(names).toContain("terminated_budget");
    expect(names).toContain("high_cost");
    expect(names).toContain("deny_decisions");
  });

  // No triggers when run is clean
  test("returns empty array for a clean completed run", () => {
    const result = evaluatePostRunTriggers(
      { status: "completed", total_cost_usd: 0.1 },
      [{ event_type: "policy_decision", decision: "allow" }],
      1.0
    );
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// evaluateMidRunTriggers
// ---------------------------------------------------------------------------

describe("evaluateMidRunTriggers", () => {
  // AC-A3-7: fires budget_warning at 70 % of hard cap
  test("AC-A3-7: fires budget_warning when cost exceeds 70 % of hard cap", () => {
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.71, total_call_count: 5 },
      { event_type: "tool_call", decision: null, rule_id: null },
      makeCounters(),
      NO_BASELINE,
      1.0
    );
    expect(triggerNames(result)).toContain("budget_warning");
    const t = result.find((r) => r.trigger === "budget_warning")!;
    expect(t.priority).toBe(2);
  });

  // AC-A3-7: does NOT fire budget_warning at exactly 70 % (strict >)
  test("AC-A3-7: does not fire budget_warning at exactly 70 % of hard cap", () => {
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.7, total_call_count: 5 },
      { event_type: "tool_call", decision: null, rule_id: null },
      makeCounters(),
      NO_BASELINE,
      1.0
    );
    expect(triggerNames(result)).not.toContain("budget_warning");
  });

  // AC-A3-7: does NOT fire budget_warning when budgetHardCap is null
  test("AC-A3-7: does not fire budget_warning when budgetHardCap is null", () => {
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 9999.0, total_call_count: 5 },
      { event_type: "tool_call", decision: null, rule_id: null },
      makeCounters(),
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).not.toContain("budget_warning");
  });

  // AC-A3-8: fires loop_detected when event_type is "loop_detected"
  test("AC-A3-8: fires loop_detected for a loop_detected event type", () => {
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 10 },
      { event_type: "loop_detected", decision: null, rule_id: null },
      makeCounters(),
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).toContain("loop_detected");
    const t = result.find((r) => r.trigger === "loop_detected")!;
    expect(t.priority).toBe(2);
  });

  // AC-A3-8: does NOT fire loop_detected for other event types
  test("AC-A3-8: does not fire loop_detected for a tool_call event type", () => {
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 10 },
      { event_type: "tool_call", decision: null, rule_id: null },
      makeCounters(),
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).not.toContain("loop_detected");
  });

  // AC-A3-9: fires deny_spike with baseline (deny_count/total > 3x baseline, deny_count >= 5)
  test("AC-A3-9: fires deny_spike when deny rate exceeds 3x baseline and deny_count >= 5", () => {
    // Baseline: 10 % deny rate. 3x = 30 %. Actual: 6/10 = 60 %.
    const counters = makeCounters(6, 10);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 10 },
      { event_type: "policy_decision", decision: "deny", rule_id: null },
      counters,
      BASELINE_10PCT,
      null
    );
    expect(triggerNames(result)).toContain("deny_spike");
    const t = result.find((r) => r.trigger === "deny_spike")!;
    expect(t.priority).toBe(2);
  });

  // AC-A3-9: does NOT fire deny_spike when below 3x baseline even with enough denies
  test("AC-A3-9: does not fire deny_spike when deny rate is below 3x baseline", () => {
    // Baseline: 10 %. 3x = 30 %. Actual: 5/20 = 25 % < 30 %.
    const counters = makeCounters(5, 20);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 20 },
      { event_type: "policy_decision", decision: "deny", rule_id: null },
      counters,
      BASELINE_10PCT,
      null
    );
    expect(triggerNames(result)).not.toContain("deny_spike");
  });

  // AC-A3-9: does NOT fire deny_spike when deny_count < 5 (minimum absolute threshold)
  test("AC-A3-9: does not fire deny_spike when deny_count < 5 even with high rate", () => {
    // 4 denies / 4 decisions = 100 % deny rate — way above any baseline.
    // But deny_count (4) < 5 minimum.
    const counters = makeCounters(4, 4);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 4 },
      { event_type: "policy_decision", decision: "deny", rule_id: null },
      counters,
      BASELINE_10PCT,
      null
    );
    expect(triggerNames(result)).not.toContain("deny_spike");
  });

  // AC-A3-10: fires deny_spike with absolute fallback (50 %) when no baseline
  test("AC-A3-10: fires deny_spike with absolute fallback when no baseline and deny_count >= 5", () => {
    // No baseline. Fallback threshold = 50 %. Actual: 6/10 = 60 % > 50 %.
    const counters = makeCounters(6, 10);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 10 },
      { event_type: "policy_decision", decision: "deny", rule_id: null },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).toContain("deny_spike");
  });

  // AC-A3-10: does NOT fire deny_spike when below 50 % and no baseline
  test("AC-A3-10: does not fire deny_spike when below 50 % fallback threshold", () => {
    // No baseline. Actual: 5/11 ≈ 45.5 % < 50 %.
    const counters = makeCounters(5, 11);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 11 },
      { event_type: "policy_decision", decision: "deny", rule_id: null },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).not.toContain("deny_spike");
  });

  // AC-A3-10: does NOT fire deny_spike with fallback if deny_count < 5
  test("AC-A3-10: does not fire deny_spike with absolute fallback when deny_count < 5", () => {
    // 4/4 = 100 % but below minimum count
    const counters = makeCounters(4, 4);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 4 },
      { event_type: "policy_decision", decision: "deny", rule_id: null },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).not.toContain("deny_spike");
  });

  // AC-A3-11: fires repeated_rule when rule_id count >= 3
  test("AC-A3-11: fires repeated_rule when same rule_id has fired 3 or more times", () => {
    const ruleId = "custom_rule_block_filesystem";
    const ruleMap = new Map<string, number>([[ruleId, 3]]);
    const counters = makeCounters(3, 10, ruleMap);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 10 },
      { event_type: "policy_decision", decision: "deny", rule_id: ruleId },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).toContain("repeated_rule");
    const t = result.find((r) => r.trigger === "repeated_rule")!;
    expect(t.priority).toBe(3);
  });

  // AC-A3-11: does NOT fire repeated_rule when count is exactly 2 (< 3)
  test("AC-A3-11: does not fire repeated_rule when same rule_id has fired only 2 times", () => {
    const ruleId = "custom_rule_block_filesystem";
    const ruleMap = new Map<string, number>([[ruleId, 2]]);
    const counters = makeCounters(2, 10, ruleMap);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 10 },
      { event_type: "policy_decision", decision: "deny", rule_id: ruleId },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).not.toContain("repeated_rule");
  });

  // AC-A3-11: fires repeated_rule when count is > 3 (e.g. 5)
  test("AC-A3-11: fires repeated_rule when same rule_id has fired more than 3 times", () => {
    const ruleId = "custom_rule_rate_limit";
    const ruleMap = new Map<string, number>([[ruleId, 5]]);
    const counters = makeCounters(5, 10, ruleMap);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 10 },
      { event_type: "policy_decision", decision: "deny", rule_id: ruleId },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).toContain("repeated_rule");
  });

  // AC-A3-12: does NOT fire repeated_rule for __builtin_* rule_ids
  test("AC-A3-12: does not fire repeated_rule for __builtin_* rule_ids regardless of count", () => {
    const builtinRuleId = "__builtin_escalate_to_human_allow";
    const ruleMap = new Map<string, number>([[builtinRuleId, 100]]);
    const counters = makeCounters(100, 100, ruleMap);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 100 },
      { event_type: "policy_decision", decision: "allow", rule_id: builtinRuleId },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).not.toContain("repeated_rule");
  });

  // AC-A3-12: does NOT fire repeated_rule for other __builtin_* variants
  test("AC-A3-12: does not fire repeated_rule for any __builtin_ prefixed rule_id", () => {
    const builtinRuleId = "__builtin_budget_cap_hard";
    const ruleMap = new Map<string, number>([[builtinRuleId, 50]]);
    const counters = makeCounters(50, 50, ruleMap);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 50 },
      { event_type: "policy_decision", decision: "deny", rule_id: builtinRuleId },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).not.toContain("repeated_rule");
  });

  // AC-A3-12: does NOT fire when rule_id is null
  test("AC-A3-12: does not fire repeated_rule when rule_id is null", () => {
    const ruleMap = new Map<string, number>();
    const counters = makeCounters(0, 0, ruleMap);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 5 },
      { event_type: "tool_call", decision: null, rule_id: null },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).not.toContain("repeated_rule");
  });

  // No mid-run triggers for a clean low-cost event
  test("returns empty array for a routine tool_call with no anomalies", () => {
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.05, total_call_count: 2 },
      { event_type: "tool_call", decision: null, rule_id: null },
      makeCounters(0, 0),
      BASELINE_10PCT,
      1.0
    );
    expect(result).toHaveLength(0);
  });

  // Multiple mid-run triggers can fire simultaneously
  test("multiple mid-run triggers can fire in a single call", () => {
    // budget_warning + loop_detected simultaneously
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.75, total_call_count: 30 },
      { event_type: "loop_detected", decision: null, rule_id: null },
      makeCounters(0, 0),
      NO_BASELINE,
      1.0
    );
    const names = triggerNames(result);
    expect(names).toContain("budget_warning");
    expect(names).toContain("loop_detected");
  });
});

// ---------------------------------------------------------------------------
// AC-A3-13: Priority ordering
// ---------------------------------------------------------------------------

describe("priority ordering (AC-A3-13)", () => {
  test("post-run: results are sorted priority ascending (critical first)", () => {
    // terminated_budget (p=1) + high_cost (p=2) + abandoned (p=3) + deny_decisions (p=3)
    // Status abandoned AND terminated_budget can coexist here for test purposes
    const result = evaluatePostRunTriggers(
      { status: "terminated_budget", total_cost_usd: 0.9 },
      [{ event_type: "policy_decision", decision: "deny" }],
      1.0
    );
    // Verify sorted
    assertSortedByPriority(result);
    // Priority-1 trigger comes first
    expect(result[0]?.priority).toBe(1);
  });

  test("mid-run: results are sorted priority ascending (critical first)", () => {
    // budget_warning (p=2) + loop_detected (p=2) + repeated_rule (p=3)
    const ruleId = "my_custom_rule";
    const ruleMap = new Map<string, number>([[ruleId, 5]]);
    const counters = makeCounters(0, 0, ruleMap);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.75, total_call_count: 10 },
      { event_type: "loop_detected", decision: null, rule_id: ruleId },
      counters,
      NO_BASELINE,
      1.0
    );
    assertSortedByPriority(result);
    // All priority-2 before priority-3
    const p2Items = result.filter((r) => r.priority === 2);
    const p3Items = result.filter((r) => r.priority === 3);
    expect(p2Items.length).toBeGreaterThan(0);
    expect(p3Items.length).toBeGreaterThan(0);
    const lastP2Idx = result.findLastIndex((r) => r.priority === 2);
    const firstP3Idx = result.findIndex((r) => r.priority === 3);
    expect(lastP2Idx).toBeLessThan(firstP3Idx);
  });

  test("post-run: all returned priorities are in the valid set {1,2,3,4}", () => {
    const result = evaluatePostRunTriggers(
      { status: "terminated_loop", total_cost_usd: 0.85 },
      [{ event_type: "policy_decision", decision: "deny" }],
      1.0
    );
    for (const t of result) {
      expect([1, 2, 3, 4]).toContain(t.priority);
    }
  });

  test("mid-run: all returned priorities are in the valid set {1,2,3,4}", () => {
    const counters = makeCounters(6, 10);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.75, total_call_count: 10 },
      { event_type: "loop_detected", decision: null, rule_id: null },
      counters,
      NO_BASELINE,
      1.0
    );
    for (const t of result) {
      expect([1, 2, 3, 4]).toContain(t.priority);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-A3-14: Purity guarantee
// ---------------------------------------------------------------------------

describe("purity guarantee (AC-A3-14)", () => {
  test("evaluatePostRunTriggers does not mutate the events array", () => {
    const events = [
      { event_type: "policy_decision", decision: "deny" },
      { event_type: "policy_decision", decision: "allow" },
    ];
    const originalLength = events.length;
    const original0 = { ...events[0] };

    evaluatePostRunTriggers({ status: "completed", total_cost_usd: 0.0 }, events, null);

    expect(events).toHaveLength(originalLength);
    expect(events[0]).toEqual(original0);
  });

  test("evaluatePostRunTriggers is deterministic (same inputs -> same outputs)", () => {
    const run = { status: "terminated_budget", total_cost_usd: 0.9 };
    const events = [{ event_type: "policy_decision", decision: "deny" }];
    const cap = 1.0;

    const r1 = evaluatePostRunTriggers(run, events, cap);
    const r2 = evaluatePostRunTriggers(run, events, cap);

    expect(r1).toEqual(r2);
  });

  test("evaluateMidRunTriggers does not mutate the RunningCounters map", () => {
    const ruleId = "my_rule";
    const ruleMap = new Map<string, number>([[ruleId, 3]]);
    const counters = makeCounters(3, 10, ruleMap);
    const originalSize = ruleMap.size;
    const originalCount = ruleMap.get(ruleId);

    evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 10 },
      { event_type: "policy_decision", decision: "deny", rule_id: ruleId },
      counters,
      NO_BASELINE,
      null
    );

    expect(ruleMap.size).toBe(originalSize);
    expect(ruleMap.get(ruleId)).toBe(originalCount);
  });

  test("evaluateMidRunTriggers is deterministic (same inputs -> same outputs)", () => {
    const run = { status: "running", total_cost_usd: 0.75, total_call_count: 10 };
    const newEvent = { event_type: "loop_detected", decision: null, rule_id: null };
    const counters = makeCounters(6, 10);

    const r1 = evaluateMidRunTriggers(run, newEvent, counters, NO_BASELINE, 1.0);
    const r2 = evaluateMidRunTriggers(run, newEvent, counters, NO_BASELINE, 1.0);

    expect(r1).toEqual(r2);
  });
});

// ---------------------------------------------------------------------------
// Edge case coverage: deny_spike boundary at exactly 50 % (no baseline)
// ---------------------------------------------------------------------------

describe("deny_spike boundary conditions", () => {
  test("deny_spike does not fire at exactly 50 % rate without baseline (strict >)", () => {
    // 5/10 = exactly 50 %, which is NOT > 50 %
    const counters = makeCounters(5, 10);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 10 },
      { event_type: "policy_decision", decision: "deny", rule_id: null },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).not.toContain("deny_spike");
  });

  test("deny_spike fires at 50.1 % rate without baseline", () => {
    // 501/1000 = 50.1 %
    const counters = makeCounters(501, 1000);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 1000 },
      { event_type: "policy_decision", decision: "deny", rule_id: null },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).toContain("deny_spike");
  });

  test("deny_spike does not fire when total_decisions is zero (avoids division by zero)", () => {
    const counters = makeCounters(0, 0);
    const result = evaluateMidRunTriggers(
      { status: "running", total_cost_usd: 0.0, total_call_count: 0 },
      { event_type: "tool_call", decision: null, rule_id: null },
      counters,
      NO_BASELINE,
      null
    );
    expect(triggerNames(result)).not.toContain("deny_spike");
  });
});
