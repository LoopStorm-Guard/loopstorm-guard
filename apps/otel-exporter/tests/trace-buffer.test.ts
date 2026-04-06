// SPDX-License-Identifier: MIT

import { describe, test, expect } from "bun:test";
import { TraceBuffer } from "../src/trace-buffer.js";
import { SpanStatusCode } from "@opentelemetry/api";
import type { ParsedEvent } from "../src/types.js";

const RUN_ID = "01960e07-d0e9-7ad0-8621-5614ec0dbd54";
const RUN_ID_2 = "550e8400-e29b-41d4-a716-446655440000";

const RESOURCE_CONFIG = {
  serviceName: "loopstorm-engine",
  serviceVersion: "0.1.0",
};

function makeEvent(overrides: Partial<ParsedEvent>): ParsedEvent {
  return {
    schema_version: 1,
    event_type: "run_started",
    run_id: RUN_ID,
    seq: 1,
    hash: "a".repeat(64),
    hash_prev: null,
    ts: "2026-04-05T10:00:00.000Z",
    run_status: "started",
    ...overrides,
  };
}

describe("TraceBuffer - complete trace flush", () => {
  test("run_ended flushes all spans for the trace", () => {
    const buffer = new TraceBuffer(RESOURCE_CONFIG);

    // No spans from individual events
    expect(
      buffer.addEvent(makeEvent({ event_type: "run_started", seq: 1 })),
    ).toHaveLength(0);
    expect(
      buffer.addEvent(
        makeEvent({
          event_type: "policy_decision",
          seq: 2,
          decision: "allow",
        }),
      ),
    ).toHaveLength(0);

    // run_ended triggers flush
    const spans = buffer.addEvent(
      makeEvent({
        event_type: "run_ended",
        seq: 3,
        run_status: "completed",
        hash_prev: "c".repeat(64),
      }),
    );

    // Should have: root span + 1 child (policy_decision) + 1 run_ended span
    expect(spans.length).toBe(3);
    expect(buffer.size).toBe(0);
  });

  test("root span has OK status when run_ended with completed", () => {
    const buffer = new TraceBuffer(RESOURCE_CONFIG);

    buffer.addEvent(makeEvent({ event_type: "run_started", seq: 1 }));
    const spans = buffer.addEvent(
      makeEvent({
        event_type: "run_ended",
        seq: 2,
        run_status: "completed",
        hash_prev: "c".repeat(64),
      }),
    );

    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    expect(rootSpan).toBeDefined();
    expect(rootSpan!.status.code).toBe(SpanStatusCode.OK);
  });

  test("root span has ERROR status when run_ended with error status", () => {
    const buffer = new TraceBuffer(RESOURCE_CONFIG);

    buffer.addEvent(makeEvent({ event_type: "run_started", seq: 1 }));
    const spans = buffer.addEvent(
      makeEvent({
        event_type: "run_ended",
        seq: 2,
        run_status: "terminated_budget",
        hash_prev: "c".repeat(64),
      }),
    );

    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    expect(rootSpan!.status.code).toBe(SpanStatusCode.ERROR);
  });

  test("root span end time = run_ended ts", () => {
    const buffer = new TraceBuffer(RESOURCE_CONFIG);

    buffer.addEvent(makeEvent({ event_type: "run_started", seq: 1, ts: "2026-04-05T10:00:00.000Z" }));
    const spans = buffer.addEvent(
      makeEvent({
        event_type: "run_ended",
        seq: 2,
        run_status: "completed",
        ts: "2026-04-05T10:00:05.000Z",
        hash_prev: "c".repeat(64),
      }),
    );

    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    expect(rootSpan).toBeDefined();
    // End time should be 5 seconds after start (5000ms = [5, 0] in HrTime)
    const endTimeMs =
      rootSpan!.endTime[0]! * 1000 + rootSpan!.endTime[1]! / 1_000_000;
    const startTimeMs = new Date("2026-04-05T10:00:00.000Z").getTime();
    const endExpected = new Date("2026-04-05T10:00:05.000Z").getTime();
    expect(endTimeMs).toBeCloseTo(endExpected, -1);
    expect(endTimeMs).toBeGreaterThan(startTimeMs);
  });
});

describe("TraceBuffer - timeout flush", () => {
  test("flushTimedOut returns spans for expired traces", () => {
    const buffer = new TraceBuffer(RESOURCE_CONFIG);

    buffer.addEvent(makeEvent({ event_type: "run_started", seq: 1 }));
    buffer.addEvent(
      makeEvent({ event_type: "policy_decision", seq: 2, decision: "allow" }),
    );

    expect(buffer.size).toBe(1);

    // Simulate timeout: pass a future 'now' and 0 timeout
    const spans = buffer.flushTimedOut(Date.now() + 10_000, 0);

    // Should flush root + child
    expect(spans.length).toBe(2);
    expect(buffer.size).toBe(0);
  });

  test("incomplete root span has UNSET status on timeout", () => {
    const buffer = new TraceBuffer(RESOURCE_CONFIG);

    buffer.addEvent(makeEvent({ event_type: "run_started", seq: 1 }));

    const spans = buffer.flushTimedOut(Date.now() + 10_000, 0);
    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    expect(rootSpan).toBeDefined();
    expect(rootSpan!.status.code).toBe(SpanStatusCode.UNSET);
  });

  test("trace not yet timed out is not flushed", () => {
    const buffer = new TraceBuffer(RESOURCE_CONFIG);
    buffer.addEvent(makeEvent({ event_type: "run_started", seq: 1 }));

    // Pass 0 as now with very large timeout — nothing should flush
    const spans = buffer.flushTimedOut(0, 300_000);
    expect(spans).toHaveLength(0);
    expect(buffer.size).toBe(1);
  });
});

describe("TraceBuffer - multiple concurrent traces", () => {
  test("two traces buffered independently", () => {
    const buffer = new TraceBuffer(RESOURCE_CONFIG);

    buffer.addEvent(
      makeEvent({ run_id: RUN_ID, event_type: "run_started", seq: 1 }),
    );
    buffer.addEvent(
      makeEvent({ run_id: RUN_ID_2, event_type: "run_started", seq: 1 }),
    );

    expect(buffer.size).toBe(2);

    // Complete trace 1
    const spans1 = buffer.addEvent(
      makeEvent({
        run_id: RUN_ID,
        event_type: "run_ended",
        seq: 2,
        run_status: "completed",
        hash_prev: "c".repeat(64),
      }),
    );

    expect(spans1.length).toBe(2); // root span + run_ended span
    expect(buffer.size).toBe(1); // trace 2 still buffered

    // Complete trace 2
    const spans2 = buffer.addEvent(
      makeEvent({
        run_id: RUN_ID_2,
        event_type: "run_ended",
        seq: 2,
        run_status: "completed",
        hash_prev: "c".repeat(64),
      }),
    );

    expect(spans2.length).toBe(2); // root span + run_ended span
    expect(buffer.size).toBe(0);
  });
});

describe("TraceBuffer - flushAll", () => {
  test("flushAll returns all buffered spans and clears buffer", () => {
    const buffer = new TraceBuffer(RESOURCE_CONFIG);

    buffer.addEvent(
      makeEvent({ run_id: RUN_ID, event_type: "run_started", seq: 1 }),
    );
    buffer.addEvent(
      makeEvent({
        run_id: RUN_ID,
        event_type: "policy_decision",
        seq: 2,
        decision: "allow",
      }),
    );
    buffer.addEvent(
      makeEvent({ run_id: RUN_ID_2, event_type: "run_started", seq: 1 }),
    );

    expect(buffer.size).toBe(2);

    const spans = buffer.flushAll();

    // 2 spans from run1 (root + policy_decision child) + 1 from run2 (root only)
    expect(spans.length).toBe(3);
    expect(buffer.size).toBe(0);
  });
});

describe("TraceBuffer - budget/loop span events on root", () => {
  test("budget_soft_cap_warning creates OTel Span Event on root span", () => {
    const buffer = new TraceBuffer(RESOURCE_CONFIG);

    buffer.addEvent(makeEvent({ event_type: "run_started", seq: 1 }));
    buffer.addEvent(
      makeEvent({
        event_type: "budget_soft_cap_warning",
        seq: 2,
        dimension: "cost_usd",
        hash_prev: "b".repeat(64),
      }),
    );

    const spans = buffer.addEvent(
      makeEvent({
        event_type: "run_ended",
        seq: 3,
        run_status: "completed",
        hash_prev: "c".repeat(64),
      }),
    );

    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    expect(rootSpan).toBeDefined();
    const eventNames = rootSpan!.events.map((e) => e.name);
    expect(eventNames).toContain("loopstorm.budget_warning");
  });

  test("loop_detected creates OTel Span Event on root span", () => {
    const buffer = new TraceBuffer(RESOURCE_CONFIG);

    buffer.addEvent(makeEvent({ event_type: "run_started", seq: 1 }));
    buffer.addEvent(
      makeEvent({
        event_type: "loop_detected",
        seq: 2,
        loop_rule: "repeated_call",
        loop_action: "cooldown",
        cooldown_ms: 5000,
        hash_prev: "b".repeat(64),
      }),
    );

    const spans = buffer.addEvent(
      makeEvent({
        event_type: "run_ended",
        seq: 3,
        run_status: "completed",
        hash_prev: "c".repeat(64),
      }),
    );

    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    const eventNames = rootSpan!.events.map((e) => e.name);
    expect(eventNames).toContain("loopstorm.loop_detected");
  });
});
