// SPDX-License-Identifier: MIT

import { describe, test, expect } from "bun:test";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  decisionToSpanStatus,
  eventTypeToSpanStatus,
  spanStatusForEvent,
} from "../src/span-status.js";

describe("decisionToSpanStatus", () => {
  test("allow -> OK with no message", () => {
    const result = decisionToSpanStatus("allow");
    expect(result.code).toBe(SpanStatusCode.OK);
    expect(result.message).toBeUndefined();
  });

  test("deny -> ERROR with reason", () => {
    const result = decisionToSpanStatus("deny", "code execution denied");
    expect(result.code).toBe(SpanStatusCode.ERROR);
    expect(result.message).toBe("code execution denied");
  });

  test("deny with no reason -> ERROR with empty string", () => {
    const result = decisionToSpanStatus("deny");
    expect(result.code).toBe(SpanStatusCode.ERROR);
    expect(result.message).toBe("");
  });

  test("cooldown -> OK with no message", () => {
    const result = decisionToSpanStatus("cooldown");
    expect(result.code).toBe(SpanStatusCode.OK);
    expect(result.message).toBeUndefined();
  });

  test("kill -> ERROR with reason", () => {
    const result = decisionToSpanStatus("kill", "loop terminated");
    expect(result.code).toBe(SpanStatusCode.ERROR);
    expect(result.message).toBe("loop terminated");
  });

  test("kill with no reason -> ERROR with empty string", () => {
    const result = decisionToSpanStatus("kill");
    expect(result.code).toBe(SpanStatusCode.ERROR);
    expect(result.message).toBe("");
  });

  test("require_approval -> UNSET", () => {
    const result = decisionToSpanStatus("require_approval");
    expect(result.code).toBe(SpanStatusCode.UNSET);
  });

  test("unknown decision -> UNSET", () => {
    const result = decisionToSpanStatus("unknown_value");
    expect(result.code).toBe(SpanStatusCode.UNSET);
  });
});

describe("eventTypeToSpanStatus", () => {
  test("run_started -> UNSET", () => {
    expect(eventTypeToSpanStatus("run_started").code).toBe(
      SpanStatusCode.UNSET,
    );
  });

  test("run_ended with completed -> OK", () => {
    expect(eventTypeToSpanStatus("run_ended", "completed").code).toBe(
      SpanStatusCode.OK,
    );
  });

  test("run_ended with terminated_budget -> ERROR", () => {
    expect(eventTypeToSpanStatus("run_ended", "terminated_budget").code).toBe(
      SpanStatusCode.ERROR,
    );
  });

  test("run_ended with terminated_loop -> ERROR", () => {
    expect(eventTypeToSpanStatus("run_ended", "terminated_loop").code).toBe(
      SpanStatusCode.ERROR,
    );
  });

  test("run_ended with terminated_policy -> ERROR", () => {
    expect(eventTypeToSpanStatus("run_ended", "terminated_policy").code).toBe(
      SpanStatusCode.ERROR,
    );
  });

  test("run_ended with abandoned -> ERROR", () => {
    expect(eventTypeToSpanStatus("run_ended", "abandoned").code).toBe(
      SpanStatusCode.ERROR,
    );
  });

  test("run_ended with error -> ERROR", () => {
    expect(eventTypeToSpanStatus("run_ended", "error").code).toBe(
      SpanStatusCode.ERROR,
    );
  });

  test("run_ended with no status -> ERROR (not completed)", () => {
    expect(eventTypeToSpanStatus("run_ended").code).toBe(SpanStatusCode.ERROR);
  });

  test("budget_update -> UNSET", () => {
    expect(eventTypeToSpanStatus("budget_update").code).toBe(
      SpanStatusCode.UNSET,
    );
  });

  test("budget_soft_cap_warning -> UNSET", () => {
    expect(eventTypeToSpanStatus("budget_soft_cap_warning").code).toBe(
      SpanStatusCode.UNSET,
    );
  });

  test("budget_exceeded -> ERROR", () => {
    expect(eventTypeToSpanStatus("budget_exceeded").code).toBe(
      SpanStatusCode.ERROR,
    );
  });

  test("loop_detected -> UNSET", () => {
    expect(eventTypeToSpanStatus("loop_detected").code).toBe(
      SpanStatusCode.UNSET,
    );
  });

  test("system_event -> UNSET", () => {
    expect(eventTypeToSpanStatus("system_event").code).toBe(
      SpanStatusCode.UNSET,
    );
  });

  test("supervisor_run_started -> UNSET", () => {
    expect(eventTypeToSpanStatus("supervisor_run_started").code).toBe(
      SpanStatusCode.UNSET,
    );
  });

  test("supervisor_tool_call -> OK", () => {
    expect(eventTypeToSpanStatus("supervisor_tool_call").code).toBe(
      SpanStatusCode.OK,
    );
  });

  test("supervisor_proposal_created -> OK", () => {
    expect(eventTypeToSpanStatus("supervisor_proposal_created").code).toBe(
      SpanStatusCode.OK,
    );
  });

  test("supervisor_escalation_created -> OK", () => {
    expect(eventTypeToSpanStatus("supervisor_escalation_created").code).toBe(
      SpanStatusCode.OK,
    );
  });
});

describe("spanStatusForEvent", () => {
  test("policy_decision with allow uses decision mapping", () => {
    const result = spanStatusForEvent("policy_decision", "allow");
    expect(result.code).toBe(SpanStatusCode.OK);
  });

  test("policy_decision with deny uses decision mapping with reason", () => {
    const result = spanStatusForEvent(
      "policy_decision",
      "deny",
      "blocked by rule",
    );
    expect(result.code).toBe(SpanStatusCode.ERROR);
    expect(result.message).toBe("blocked by rule");
  });

  test("non-policy_decision event uses event_type mapping", () => {
    const result = spanStatusForEvent("budget_exceeded");
    expect(result.code).toBe(SpanStatusCode.ERROR);
  });

  test("run_ended with run_status passed through", () => {
    const result = spanStatusForEvent("run_ended", undefined, undefined, "completed");
    expect(result.code).toBe(SpanStatusCode.OK);
  });

  test("policy_decision with no decision falls back to event_type mapping", () => {
    const result = spanStatusForEvent("policy_decision");
    // No decision field -> falls to eventTypeToSpanStatus("policy_decision") -> UNSET
    expect(result.code).toBe(SpanStatusCode.UNSET);
  });
});
