// SPDX-License-Identifier: MIT
/**
 * Risk score algorithm tests.
 *
 * Implements all 5 test vectors from specs/risk-score-algorithm.md Section 5:
 * - RS-1: Clean run — score=0, tier=LOW
 * - RS-2: Budget exceeded only — score=30, tier=MEDIUM
 * - RS-3: Budget exceeded + high deny rate — score=55, tier=HIGH
 * - RS-4: Full critical scenario — score=100, tier=CRITICAL
 * - RS-5: No BT fields — S5-S8 skipped
 */

import { describe, expect, test } from "bun:test";
import {
  type BaselineInfo,
  type EventInfo,
  type RunInfo,
  computeRiskScore,
} from "../src/lib/risk-score.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<EventInfo> & { seq: number }): EventInfo {
  return {
    event_type: "policy_decision",
    decision: "allow",
    tool: null,
    call_seq_fingerprint: null,
    inter_call_ms: null,
    token_rate_delta: null,
    param_shape_hash: null,
    budget: null,
    ...overrides,
  };
}

const GOOD_BASELINE: BaselineInfo = { run_count: 20, avg_deny_rate: 0.05 };

// ---------------------------------------------------------------------------
// RS-1: Clean run
// ---------------------------------------------------------------------------

describe("RS-1: Clean run", () => {
  test("score=0, tier=LOW, no signals", () => {
    const run: RunInfo = { run_id: "run-clean", status: "completed", total_cost_usd: 0.5 };
    const events = [
      makeEvent({ seq: 1, decision: "allow" }),
      makeEvent({ seq: 2, decision: "allow" }),
      makeEvent({ seq: 3, decision: "allow" }),
    ];

    const result = computeRiskScore(run, events, GOOD_BASELINE);
    expect(result.score).toBe(0);
    expect(result.tier).toBe("LOW");
    expect(result.signals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// RS-2: Budget exceeded only
// ---------------------------------------------------------------------------

describe("RS-2: Budget exceeded", () => {
  test("score=30, tier=MEDIUM, signals=[budget_exceeded]", () => {
    const run: RunInfo = {
      run_id: "run-budget",
      status: "terminated_budget",
      total_cost_usd: 10.0,
    };
    const events = [
      makeEvent({ seq: 1, decision: "allow" }),
      makeEvent({ seq: 2, decision: "allow" }),
    ];

    const result = computeRiskScore(run, events, GOOD_BASELINE);
    expect(result.score).toBe(30);
    expect(result.tier).toBe("MEDIUM");
    expect(result.signals.map((s) => s.name)).toEqual(["budget_exceeded"]);
  });
});

// ---------------------------------------------------------------------------
// RS-3: Budget exceeded + high deny rate
// ---------------------------------------------------------------------------

describe("RS-3: Budget exceeded + high deny rate", () => {
  test("score=55, tier=HIGH, signals=[high_deny_rate, budget_exceeded]", () => {
    const run: RunInfo = {
      run_id: "run-budget-deny",
      status: "terminated_budget",
      total_cost_usd: 10.0,
    };
    // 10 denies out of 15 decisions = 66.7%, baseline is 5%, threshold = max(10%, 10%) = 10%
    const events: EventInfo[] = [];
    for (let i = 1; i <= 10; i++) {
      events.push(makeEvent({ seq: i, decision: "deny" }));
    }
    for (let i = 11; i <= 15; i++) {
      events.push(makeEvent({ seq: i, decision: "allow" }));
    }

    const result = computeRiskScore(run, events, GOOD_BASELINE);
    expect(result.score).toBe(55);
    expect(result.tier).toBe("HIGH");
    const signalNames = result.signals.map((s) => s.name);
    expect(signalNames).toContain("high_deny_rate");
    expect(signalNames).toContain("budget_exceeded");
  });
});

// ---------------------------------------------------------------------------
// RS-4: Full critical scenario
// ---------------------------------------------------------------------------

describe("RS-4: Full critical scenario", () => {
  test("score=100 (capped), tier=CRITICAL", () => {
    const run: RunInfo = {
      run_id: "run-critical",
      status: "terminated_budget",
      total_cost_usd: 15.0,
    };

    // Build events that trigger multiple signals
    const events: EventInfo[] = [];
    let seq = 1;

    // 10 denies, 12 allows = 10/22 deny rate = 45.5%, baseline 5%, threshold 10% → fires
    for (let i = 0; i < 10; i++) {
      events.push(
        makeEvent({
          seq: seq++,
          decision: "deny",
          tool: "filesystem_write",
          inter_call_ms: 50, // rapid fire
          param_shape_hash: `shape_${i}`, // structural drift
        })
      );
    }
    for (let i = 0; i < 12; i++) {
      events.push(
        makeEvent({
          seq: seq++,
          decision: "allow",
          tool: "filesystem_write",
          inter_call_ms: 50,
          param_shape_hash: `shape_${10 + i}`,
        })
      );
    }

    // Budget event with hard cap
    events.push(
      makeEvent({
        seq: seq++,
        event_type: "budget_update",
        decision: null,
        budget: { cost_usd: { hard: 10.0 } },
      })
    );

    // Loop detected event
    events.push(
      makeEvent({
        seq: seq++,
        event_type: "loop_detected",
        decision: null,
        call_seq_fingerprint: `${"aaa".repeat(21)}a`, // 64 chars
      })
    );

    // Post-loop event with SAME fingerprint (unrecovered)
    events.push(
      makeEvent({
        seq: seq++,
        call_seq_fingerprint: `${"aaa".repeat(21)}a`,
      })
    );

    // Token spike
    events.push(
      makeEvent({
        seq: seq++,
        token_rate_delta: 8.5,
      })
    );

    const result = computeRiskScore(run, events, GOOD_BASELINE);
    expect(result.score).toBe(100); // capped
    expect(result.tier).toBe("CRITICAL");
    expect(result.signals.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// RS-5: No BT fields (v1.0 data)
// ---------------------------------------------------------------------------

describe("RS-5: No BT fields", () => {
  test("S5-S8 skipped, score from S1-S4 only", () => {
    const run: RunInfo = { run_id: "run-nobt", status: "completed", total_cost_usd: 1.0 };

    // Some denies (will trigger S1) + loop detected (will trigger S4)
    // But NO BT fields on any event
    const events: EventInfo[] = [];
    for (let i = 1; i <= 5; i++) {
      events.push(
        makeEvent({
          seq: i,
          decision: "deny",
          // Explicitly null BT fields
          call_seq_fingerprint: null,
          inter_call_ms: null,
          token_rate_delta: null,
          param_shape_hash: null,
        })
      );
    }
    for (let i = 6; i <= 10; i++) {
      events.push(
        makeEvent({
          seq: i,
          decision: "allow",
          call_seq_fingerprint: null,
          inter_call_ms: null,
          token_rate_delta: null,
          param_shape_hash: null,
        })
      );
    }
    // Loop event
    events.push(
      makeEvent({
        seq: 11,
        event_type: "loop_detected",
        decision: null,
        call_seq_fingerprint: null,
      })
    );

    const result = computeRiskScore(run, events, GOOD_BASELINE);
    const signalNames = result.signals.map((s) => s.name);

    // S1 (high_deny_rate) should fire: 5/10 = 50% > 10% threshold, deny_count >= 3
    expect(signalNames).toContain("high_deny_rate");
    // S4 (loop_detected) should fire
    expect(signalNames).toContain("loop_detected");
    // S5, S6, S7, S8 should NOT fire (no BT fields)
    expect(signalNames).not.toContain("loop_unrecovered");
    expect(signalNames).not.toContain("rapid_fire");
    expect(signalNames).not.toContain("structural_drift");
    expect(signalNames).not.toContain("abnormal_token_spike");

    // Score should be 25 (S1) + 20 (S4) = 45
    expect(result.score).toBe(45);
    expect(result.tier).toBe("MEDIUM");
  });
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

describe("confidence", () => {
  test("scales with event count and baseline", () => {
    const run: RunInfo = { run_id: "run-conf", status: "completed", total_cost_usd: 0.1 };
    const events = [makeEvent({ seq: 1 })]; // 1 event

    // With good baseline (run_count >= 10): baseline_factor = 1.0
    // event_factor = min(1.0, 1/10) = 0.1
    // confidence = 0.1 * 1.0 = 0.1
    const result = computeRiskScore(run, events, GOOD_BASELINE);
    expect(result.confidence).toBe(0.1);
  });

  test("reduced confidence with no baseline", () => {
    const run: RunInfo = { run_id: "run-nobase", status: "completed", total_cost_usd: 0.1 };
    const events = Array.from({ length: 10 }, (_, i) => makeEvent({ seq: i + 1 }));

    // No baseline: baseline_factor = 0.4
    // event_factor = min(1.0, 10/10) = 1.0
    // confidence = 1.0 * 0.4 = 0.4
    const result = computeRiskScore(run, events, null);
    expect(result.confidence).toBe(0.4);
  });

  test("medium baseline (3-9 runs)", () => {
    const run: RunInfo = { run_id: "run-medbase", status: "completed", total_cost_usd: 0.1 };
    const events = Array.from({ length: 10 }, (_, i) => makeEvent({ seq: i + 1 }));

    const medBaseline: BaselineInfo = { run_count: 5, avg_deny_rate: 0.05 };
    // baseline_factor = 0.7, event_factor = 1.0
    const result = computeRiskScore(run, events, medBaseline);
    expect(result.confidence).toBe(0.7);
  });
});

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

describe("narrative", () => {
  test("deterministic — same inputs produce same string", () => {
    const run: RunInfo = { run_id: "run-det", status: "terminated_budget", total_cost_usd: 10.0 };
    const events = [makeEvent({ seq: 1 }), makeEvent({ seq: 2 })];

    const r1 = computeRiskScore(run, events, GOOD_BASELINE);
    const r2 = computeRiskScore(run, events, GOOD_BASELINE);
    expect(r1.narrative).toBe(r2.narrative);
  });
});
