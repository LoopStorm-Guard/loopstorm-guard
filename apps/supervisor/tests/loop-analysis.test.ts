// SPDX-License-Identifier: MIT
/**
 * Loop analysis tests.
 */

import { describe, expect, test } from "bun:test";
import { type LoopEventInfo, analyzeLoopPattern } from "../src/lib/loop-analysis.js";

function makeEvent(overrides: Partial<LoopEventInfo> & { seq: number }): LoopEventInfo {
  return {
    event_type: "policy_decision",
    tool: null,
    args_hash: null,
    call_seq_fingerprint: null,
    ...overrides,
  };
}

describe("analyzeLoopPattern", () => {
  test("AC-B7-1: detects loop from loop_detected events", () => {
    const events = [
      makeEvent({ seq: 1, tool: "write_file" }),
      makeEvent({ seq: 2, tool: "read_file" }),
      makeEvent({ seq: 3, tool: "write_file" }),
      makeEvent({ seq: 4, event_type: "loop_detected" }),
      makeEvent({ seq: 5, tool: "write_file" }),
    ];

    const result = analyzeLoopPattern(events);
    expect(result.loop_count).toBe(1);
    expect(result.patterns).toHaveLength(1);
  });

  test("AC-B7-2: identifies unrecovered loop (fingerprint unchanged)", () => {
    const fp = "a".repeat(64);
    const events = [
      makeEvent({ seq: 1, tool: "write_file", call_seq_fingerprint: fp }),
      makeEvent({ seq: 2, tool: "read_file", call_seq_fingerprint: fp }),
      makeEvent({ seq: 3, event_type: "loop_detected", call_seq_fingerprint: fp }),
      makeEvent({ seq: 4, tool: "write_file", call_seq_fingerprint: fp }), // same fingerprint
    ];

    const result = analyzeLoopPattern(events);
    expect(result.patterns[0]?.recovered).toBe(false);
    expect(result.narrative).toContain("did not recover");
  });

  test("recovered loop (fingerprint changed)", () => {
    const fpBefore = "a".repeat(64);
    const fpAfter = "b".repeat(64);
    const events = [
      makeEvent({ seq: 1, tool: "write_file", call_seq_fingerprint: fpBefore }),
      makeEvent({ seq: 2, event_type: "loop_detected" }),
      makeEvent({ seq: 3, tool: "different_tool", call_seq_fingerprint: fpAfter }),
    ];

    const result = analyzeLoopPattern(events);
    expect(result.patterns[0]?.recovered).toBe(true);
  });

  test("no loops returns empty result", () => {
    const events = [
      makeEvent({ seq: 1, tool: "write_file" }),
      makeEvent({ seq: 2, tool: "read_file" }),
    ];

    const result = analyzeLoopPattern(events);
    expect(result.loop_count).toBe(0);
    expect(result.patterns).toHaveLength(0);
  });
});
