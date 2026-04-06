// SPDX-License-Identifier: MIT

import { describe, test, expect } from "bun:test";
import { buildAttributes } from "../src/attributes.js";
import type { ParsedEvent } from "../src/types.js";

const RUN_ID = "01960e07-d0e9-7ad0-8621-5614ec0dbd54";

function makeEvent(overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    schema_version: 1,
    event_type: "policy_decision",
    run_id: RUN_ID,
    seq: 1,
    hash: "a".repeat(64),
    hash_prev: "b".repeat(64),
    ts: "2026-04-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildAttributes - core fields", () => {
  test("schema_version is always present", () => {
    const attrs = buildAttributes(makeEvent());
    expect(attrs["loopstorm.schema_version"]).toBe(1);
  });

  test("hash is always present", () => {
    const attrs = buildAttributes(makeEvent());
    expect(attrs["loopstorm.hash"]).toBe("a".repeat(64));
  });

  test("hash_prev set to the event value when present", () => {
    const attrs = buildAttributes(makeEvent({ hash_prev: "c".repeat(64) }));
    expect(attrs["loopstorm.hash_prev"]).toBe("c".repeat(64));
  });

  test("hash_prev null -> loopstorm.hash_prev = empty string (exception rule)", () => {
    const attrs = buildAttributes(makeEvent({ hash_prev: null }));
    expect(attrs["loopstorm.hash_prev"]).toBe("");
  });
});

describe("buildAttributes - null field omission", () => {
  test("optional fields absent when not in event", () => {
    const event = makeEvent();
    const attrs = buildAttributes(event);
    expect(attrs["loopstorm.decision"]).toBeUndefined();
    expect(attrs["loopstorm.rule_id"]).toBeUndefined();
    expect(attrs["loopstorm.tool"]).toBeUndefined();
    expect(attrs["loopstorm.model"]).toBeUndefined();
    expect(attrs["loopstorm.latency_ms"]).toBeUndefined();
  });

  test("optional fields present when in event", () => {
    const event = makeEvent({
      decision: "allow",
      rule_id: "rule_1",
      tool: "file_read",
      model: "claude-3-5-sonnet-20241022",
    });
    const attrs = buildAttributes(event);
    expect(attrs["loopstorm.decision"]).toBe("allow");
    expect(attrs["loopstorm.rule_id"]).toBe("rule_1");
    expect(attrs["loopstorm.tool"]).toBe("file_read");
    expect(attrs["loopstorm.model"]).toBe("claude-3-5-sonnet-20241022");
  });
});

describe("buildAttributes - args_redacted serialization", () => {
  test("args_redacted serialized as JSON string", () => {
    const event = makeEvent({
      args_redacted: { path: "<REDACTED>", count: 5 },
    });
    const attrs = buildAttributes(event);
    expect(attrs["loopstorm.args_redacted"]).toBe(
      '{"path":"<REDACTED>","count":5}',
    );
  });

  test("empty args_redacted serialized as empty object string", () => {
    const event = makeEvent({ args_redacted: {} });
    const attrs = buildAttributes(event);
    expect(attrs["loopstorm.args_redacted"]).toBe("{}");
  });
});

describe("buildAttributes - budget object flattening", () => {
  test("budget object flattened to loopstorm.budget.* attributes", () => {
    const event = makeEvent({
      event_type: "budget_update",
      budget: {
        cost_usd: { current: 0.005, soft: 0.01, hard: 0.05 },
        input_tokens: { current: 1000, soft: 5000, hard: 10000 },
        output_tokens: { current: 200, soft: 2000, hard: 5000 },
        call_count: { current: 3, soft: 10, hard: 20 },
      },
    });
    const attrs = buildAttributes(event);

    expect(attrs["loopstorm.budget.cost_usd.current"]).toBe(0.005);
    expect(attrs["loopstorm.budget.cost_usd.soft"]).toBe(0.01);
    expect(attrs["loopstorm.budget.cost_usd.hard"]).toBe(0.05);
    expect(attrs["loopstorm.budget.input_tokens.current"]).toBe(1000);
    expect(attrs["loopstorm.budget.input_tokens.soft"]).toBe(5000);
    expect(attrs["loopstorm.budget.input_tokens.hard"]).toBe(10000);
    expect(attrs["loopstorm.budget.output_tokens.current"]).toBe(200);
    expect(attrs["loopstorm.budget.output_tokens.soft"]).toBe(2000);
    expect(attrs["loopstorm.budget.output_tokens.hard"]).toBe(5000);
    expect(attrs["loopstorm.budget.call_count.current"]).toBe(3);
    expect(attrs["loopstorm.budget.call_count.soft"]).toBe(10);
    expect(attrs["loopstorm.budget.call_count.hard"]).toBe(20);
  });

  test("budget absent -> no loopstorm.budget.* attributes", () => {
    const attrs = buildAttributes(makeEvent());
    expect(attrs["loopstorm.budget.cost_usd.current"]).toBeUndefined();
  });

  test("partial budget (only cost_usd) -> only cost_usd attributes", () => {
    const event = makeEvent({
      budget: { cost_usd: { current: 0.001, soft: 0.01, hard: 0.05 } },
    });
    const attrs = buildAttributes(event);
    expect(attrs["loopstorm.budget.cost_usd.current"]).toBe(0.001);
    expect(attrs["loopstorm.budget.input_tokens.current"]).toBeUndefined();
  });

  test("dimension attribute set when present", () => {
    const event = makeEvent({ dimension: "cost_usd" });
    const attrs = buildAttributes(event);
    expect(attrs["loopstorm.budget.dimension"]).toBe("cost_usd");
  });
});

describe("buildAttributes - behavioral telemetry fields", () => {
  test("BT fields mapped to loopstorm.telemetry.* when present", () => {
    const event = makeEvent({
      call_seq_fingerprint: "a".repeat(64),
      inter_call_ms: 150,
      token_rate_delta: 1.2,
      param_shape_hash: "b".repeat(64),
    });
    const attrs = buildAttributes(event);

    expect(attrs["loopstorm.telemetry.call_seq_fingerprint"]).toBe("a".repeat(64));
    expect(attrs["loopstorm.telemetry.inter_call_ms"]).toBe(150);
    expect(attrs["loopstorm.telemetry.token_rate_delta"]).toBe(1.2);
    expect(attrs["loopstorm.telemetry.param_shape_hash"]).toBe("b".repeat(64));
  });

  test("BT fields absent when not in event", () => {
    const attrs = buildAttributes(makeEvent());
    expect(attrs["loopstorm.telemetry.call_seq_fingerprint"]).toBeUndefined();
    expect(attrs["loopstorm.telemetry.inter_call_ms"]).toBeUndefined();
    expect(attrs["loopstorm.telemetry.token_rate_delta"]).toBeUndefined();
    expect(attrs["loopstorm.telemetry.param_shape_hash"]).toBeUndefined();
  });
});

describe("buildAttributes - supervisor fields", () => {
  test("supervisor fields mapped to loopstorm.supervisor.* when present", () => {
    const event = makeEvent({
      event_type: "supervisor_proposal_created",
      supervisor_run_id: "sup_001",
      proposal_id: "prop_001",
      proposal_type: "budget_adjustment",
      target_agent: "agent-1",
      rationale: "costs too high",
      confidence: 0.9,
      supporting_runs: ["run-a", "run-b"],
      status: "pending_approval",
    });
    const attrs = buildAttributes(event);

    expect(attrs["loopstorm.supervisor.run_id"]).toBe("sup_001");
    expect(attrs["loopstorm.supervisor.proposal_id"]).toBe("prop_001");
    expect(attrs["loopstorm.supervisor.proposal_type"]).toBe("budget_adjustment");
    expect(attrs["loopstorm.supervisor.target_agent"]).toBe("agent-1");
    expect(attrs["loopstorm.supervisor.rationale"]).toBe("costs too high");
    expect(attrs["loopstorm.supervisor.confidence"]).toBe(0.9);
    expect(attrs["loopstorm.supervisor.supporting_runs"]).toBe(
      '["run-a","run-b"]',
    );
    expect(attrs["loopstorm.supervisor.status"]).toBe("pending_approval");
  });

  test("supporting_runs empty array serialized as empty JSON array", () => {
    const event = makeEvent({ supporting_runs: [] });
    const attrs = buildAttributes(event);
    expect(attrs["loopstorm.supervisor.supporting_runs"]).toBe("[]");
  });
});

describe("buildAttributes - loop detection", () => {
  test("loop detection attributes present when in event", () => {
    const event = makeEvent({
      event_type: "loop_detected",
      loop_rule: "repeated_tool_call",
      loop_action: "cooldown",
      cooldown_ms: 5000,
    });
    const attrs = buildAttributes(event);
    expect(attrs["loopstorm.loop_rule"]).toBe("repeated_tool_call");
    expect(attrs["loopstorm.loop_action"]).toBe("cooldown");
    expect(attrs["loopstorm.cooldown_ms"]).toBe(5000);
  });
});
