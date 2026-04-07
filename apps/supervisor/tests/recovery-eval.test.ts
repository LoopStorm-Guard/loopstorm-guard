// SPDX-License-Identifier: MIT
/**
 * Recovery effectiveness evaluation tests.
 */

import { describe, expect, test } from "bun:test";
import { type RecoveryEventInfo, evaluateRecoveryEffectiveness } from "../src/lib/recovery-eval.js";

function makeEvent(overrides: Partial<RecoveryEventInfo> & { seq: number }): RecoveryEventInfo {
  return {
    event_type: "policy_decision",
    call_seq_fingerprint: null,
    tool: null,
    ...overrides,
  };
}

describe("evaluateRecoveryEffectiveness", () => {
  test("AC-B7-3: effective intervention (fingerprint changed)", () => {
    const fpBefore = "a".repeat(64);
    const fpAfter = "b".repeat(64);
    const events = [
      makeEvent({ seq: 1, call_seq_fingerprint: fpBefore, tool: "write" }),
      makeEvent({ seq: 2, call_seq_fingerprint: fpBefore, tool: "write" }),
      makeEvent({ seq: 3, call_seq_fingerprint: fpBefore, tool: "write" }),
      // intervention at seq 4
      makeEvent({ seq: 5, call_seq_fingerprint: fpAfter, tool: "read" }),
      makeEvent({ seq: 6, call_seq_fingerprint: fpAfter, tool: "read" }),
    ];

    const result = evaluateRecoveryEffectiveness(events, 4);
    expect(result.verdict).toBe("effective");
  });

  test("AC-B7-4: ineffective intervention (fingerprint unchanged)", () => {
    const fp = "a".repeat(64);
    const events = [
      makeEvent({ seq: 1, call_seq_fingerprint: fp, tool: "write" }),
      makeEvent({ seq: 2, call_seq_fingerprint: fp, tool: "write" }),
      // intervention at seq 3
      makeEvent({ seq: 4, call_seq_fingerprint: fp, tool: "write" }),
      makeEvent({ seq: 5, call_seq_fingerprint: fp, tool: "write" }),
    ];

    const result = evaluateRecoveryEffectiveness(events, 3);
    expect(result.verdict).toBe("ineffective");
  });

  test("AC-B7-5: handles missing BT fields gracefully", () => {
    const events = [
      makeEvent({ seq: 1, tool: "write" }),
      makeEvent({ seq: 2, tool: "write" }),
      // intervention at seq 3
      makeEvent({ seq: 4, tool: "read" }), // different tool
      makeEvent({ seq: 5, tool: "read" }),
    ];

    const result = evaluateRecoveryEffectiveness(events, 3);
    // Without fingerprints, falls back to tool comparison
    expect(result.verdict).toBe("partial");
  });

  test("insufficient data when no post-intervention events", () => {
    const events = [
      makeEvent({ seq: 1, tool: "write" }),
      makeEvent({ seq: 2, tool: "write" }),
      // intervention at seq 10 — no events after
    ];

    const result = evaluateRecoveryEffectiveness(events, 10);
    expect(result.verdict).toBe("insufficient_data");
  });
});
