// SPDX-License-Identifier: MIT

import { describe, test, expect } from "bun:test";
import {
  InMemorySpanExporter,
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";
import { join } from "node:path";
import { JsonlReader } from "../src/jsonl-reader.js";
import { TraceBuffer } from "../src/trace-buffer.js";
import { traceId, spanId } from "../src/ids.js";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

const FIXTURE_PATH = join(
  import.meta.dir,
  "../../../tests/fixtures/otel-sample-run.jsonl",
);

const RUN_ID = "01960e07-d0e9-7ad0-8621-5614ec0dbd54";

const RESOURCE_CONFIG = {
  serviceName: "loopstorm-engine",
  serviceVersion: "0.1.0",
};

/**
 * Process a JSONL fixture file in --once mode and collect all spans.
 * Returns the spans via a callback-based exporter.
 */
async function processFixture(fixturePath: string): Promise<ReadableSpan[]> {
  const collectedSpans: ReadableSpan[] = [];

  const buffer = new TraceBuffer(RESOURCE_CONFIG);

  const reader = new JsonlReader(fixturePath, (event) => {
    const spans = buffer.addEvent(event);
    collectedSpans.push(...spans);
  });

  await reader.processOnce();

  // Flush any remaining (timeout flush with 0 timeout to flush everything)
  const remaining = buffer.flushAll();
  collectedSpans.push(...remaining);

  // Clean up cursor file
  const { unlinkSync, existsSync } = await import("node:fs");
  const cursorPath = `${fixturePath}.otel-cursor`;
  if (existsSync(cursorPath)) {
    unlinkSync(cursorPath);
  }

  return collectedSpans;
}

describe("Integration: JSONL fixture -> OTel spans", () => {
  test("fixture produces correct number of spans (8 events = 8 spans)", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    // 8 events: run_started + 3 policy_decision + budget_soft_cap_warning +
    // loop_detected + budget_update + run_ended
    expect(spans).toHaveLength(8);
  });

  test("root span has correct trace_id from run_id", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    expect(rootSpan).toBeDefined();
    expect(rootSpan!.spanContext().traceId).toBe(traceId(RUN_ID));
  });

  test("root span has correct span_id (derived from seq=0)", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    expect(rootSpan).toBeDefined();
    expect(rootSpan!.spanContext().spanId).toBe(spanId(RUN_ID, 0));
  });

  test("root span has no parent (parentSpanId undefined or empty)", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    expect(rootSpan).toBeDefined();
    // Root span should not have a parent span ID set
    const parentId = rootSpan!.parentSpanId;
    expect(!parentId || parentId === "0000000000000000").toBe(true);
  });

  test("root span has OK status (completed run)", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    expect(rootSpan!.status.code).toBe(SpanStatusCode.OK);
  });

  test("root span has non-zero duration (run_ended - run_started)", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    expect(rootSpan).toBeDefined();

    const startMs =
      rootSpan!.startTime[0]! * 1000 + rootSpan!.startTime[1]! / 1_000_000;
    const endMs =
      rootSpan!.endTime[0]! * 1000 + rootSpan!.endTime[1]! / 1_000_000;

    expect(endMs).toBeGreaterThan(startMs);
    // 1000ms = run_ended.ts - run_started.ts in the fixture
    expect(endMs - startMs).toBeCloseTo(1000, -1);
  });

  test("deny decision span has ERROR status", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const denySpan = spans.find(
      (s) => s.attributes["loopstorm.decision"] === "deny",
    );
    expect(denySpan).toBeDefined();
    expect(denySpan!.status.code).toBe(SpanStatusCode.ERROR);
  });

  test("allow decision span has OK status", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const allowSpan = spans.find(
      (s) => s.attributes["loopstorm.decision"] === "allow",
    );
    expect(allowSpan).toBeDefined();
    expect(allowSpan!.status.code).toBe(SpanStatusCode.OK);
  });

  test("all child spans have root span as parent", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    const rootSpanId = rootSpan!.spanContext().spanId;

    const childSpans = spans.filter((s) => s.name !== "loopstorm.run_started");
    for (const child of childSpans) {
      expect(child.parentSpanId).toBe(rootSpanId);
    }
  });

  test("policy_decision spans have latency_ms duration", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    // The allow decision has latency_ms: 42.5
    const allowSpan = spans.find(
      (s) =>
        s.name === "loopstorm.policy_decision" &&
        s.attributes["loopstorm.decision"] === "allow",
    );
    expect(allowSpan).toBeDefined();

    const startMs =
      allowSpan!.startTime[0]! * 1000 +
      allowSpan!.startTime[1]! / 1_000_000;
    const endMs =
      allowSpan!.endTime[0]! * 1000 + allowSpan!.endTime[1]! / 1_000_000;
    expect(endMs - startMs).toBeCloseTo(42.5, 0);
  });

  test("BT attributes present on policy_decision spans", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const policySpans = spans.filter(
      (s) => s.name === "loopstorm.policy_decision",
    );
    expect(policySpans.length).toBeGreaterThan(0);

    // All policy_decision spans in fixture have BT fields
    for (const span of policySpans) {
      expect(
        span.attributes["loopstorm.telemetry.call_seq_fingerprint"],
      ).toBeDefined();
      expect(
        span.attributes["loopstorm.telemetry.inter_call_ms"],
      ).toBeDefined();
      expect(
        span.attributes["loopstorm.telemetry.token_rate_delta"],
      ).toBeDefined();
      expect(
        span.attributes["loopstorm.telemetry.param_shape_hash"],
      ).toBeDefined();
    }
  });

  test("root span has OTel Span Event for budget_warning", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    expect(rootSpan).toBeDefined();

    const eventNames = rootSpan!.events.map((e) => e.name);
    expect(eventNames).toContain("loopstorm.budget_warning");
  });

  test("root span has OTel Span Event for loop_detected", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const rootSpan = spans.find((s) => s.name === "loopstorm.run_started");
    const eventNames = rootSpan!.events.map((e) => e.name);
    expect(eventNames).toContain("loopstorm.loop_detected");
  });

  test("span names follow loopstorm.{event_type} pattern", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const expectedNames = new Set([
      "loopstorm.run_started",
      "loopstorm.policy_decision",
      "loopstorm.budget_soft_cap_warning",
      "loopstorm.loop_detected",
      "loopstorm.budget_update",
      "loopstorm.run_ended",
    ]);

    for (const span of spans) {
      expect(expectedNames.has(span.name)).toBe(true);
    }
  });

  test("all spans share the same trace_id", async () => {
    const spans = await processFixture(FIXTURE_PATH);
    const expectedTraceId = traceId(RUN_ID);

    for (const span of spans) {
      expect(span.spanContext().traceId).toBe(expectedTraceId);
    }
  });
});
