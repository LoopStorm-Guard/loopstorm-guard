// SPDX-License-Identifier: MIT

import type { Resource } from "@opentelemetry/resources";
import type { ReadableSpan, TimedEvent } from "@opentelemetry/sdk-trace-base";
import { spanId } from "./ids.js";
import { type ResourceConfig, buildResource } from "./resource.js";
import {
  buildIncompleteRootSpan,
  buildRootSpanEvent,
  buildSpan,
  finalizeRootSpan,
} from "./span-builder.js";
import type { ParsedEvent } from "./types.js";

const ROOT_SPAN_EVENT_TYPES = new Set([
  "budget_soft_cap_warning",
  "budget_exceeded",
  "loop_detected",
]);

const MAX_CONCURRENT_TRACES = 1000;

interface BufferedTrace {
  runId: string;
  rootSpan: ReadableSpan | null;
  childSpans: ReadableSpan[];
  rootSpanEvents: TimedEvent[];
  firstEventTime: number;
  resource: Resource;
  completed: boolean;
}

/**
 * Per-trace span buffer with flush-on-complete and timeout-based flush.
 *
 * Design:
 * - Buffers all spans for each run_id until run_ended or timeout.
 * - On run_ended: finalizes root span and returns all spans.
 * - On timeout: returns incomplete trace with zero-duration root span.
 * - Memory bound: max 1000 concurrent traces (oldest evicted when exceeded).
 *
 * Spec: Gates OTEL-G2 (buffering), Task OTEL-7
 */
export class TraceBuffer {
  private traces: Map<string, BufferedTrace> = new Map();
  private resourceConfig: ResourceConfig;

  constructor(resourceConfig: ResourceConfig) {
    this.resourceConfig = resourceConfig;
  }

  /**
   * Add an event to the buffer.
   * Returns spans to flush (empty array unless trace is now complete).
   */
  addEvent(event: ParsedEvent): ReadableSpan[] {
    const { run_id } = event;

    // Initialize trace buffer on first event for this run_id
    if (!this.traces.has(run_id)) {
      // Enforce memory cap: evict oldest trace if at limit
      if (this.traces.size >= MAX_CONCURRENT_TRACES) {
        this.evictOldest();
      }

      const resource = buildResource(event, this.resourceConfig);
      this.traces.set(run_id, {
        runId: run_id,
        rootSpan: null,
        childSpans: [],
        rootSpanEvents: [],
        firstEventTime: Date.now(),
        resource,
        completed: false,
      });
    }

    // biome-ignore lint/style/noNonNullAssertion: we just created or confirmed entry exists
    const trace = this.traces.get(run_id)!;

    // Collect root span events for run_started reconstruction
    if (ROOT_SPAN_EVENT_TYPES.has(event.event_type)) {
      const rootEvent = buildRootSpanEvent(event);
      trace.rootSpanEvents.push(rootEvent);
    }

    const rootSpanId = spanId(run_id, 0);

    if (event.event_type === "run_started") {
      // Build and store root span
      const rootSpan = buildSpan(
        event,
        trace.resource,
        rootSpanId,
        [] // root span events added later on finalization
      );
      trace.rootSpan = rootSpan;
      return [];
    }

    if (event.event_type === "run_ended") {
      // run_ended produces its own child span (one span per event rule)
      const runEndedSpan = buildSpan(event, trace.resource, rootSpanId, []);
      trace.childSpans.push(runEndedSpan);

      // Also finalize root span and flush all spans
      trace.completed = true;

      if (trace.rootSpan !== null) {
        const finalRoot = finalizeRootSpan(
          trace.rootSpan,
          event,
          trace.rootSpanEvents,
          trace.resource
        );
        const spans = [finalRoot, ...trace.childSpans];
        this.traces.delete(run_id);
        return spans;
      }

      // No run_started seen: just flush child spans
      const spans = [...trace.childSpans];
      this.traces.delete(run_id);
      return spans;
    }

    // All other events become child spans
    const childSpan = buildSpan(
      event,
      trace.resource,
      rootSpanId,
      [] // no extra events for child spans
    );
    trace.childSpans.push(childSpan);
    return [];
  }

  /**
   * Check for timed-out traces. Returns spans to flush.
   * Removes flushed traces from the buffer.
   */
  flushTimedOut(now: number, timeoutMs: number): ReadableSpan[] {
    const result: ReadableSpan[] = [];

    for (const [runId, trace] of this.traces) {
      if (now - trace.firstEventTime >= timeoutMs) {
        let spans: ReadableSpan[];
        if (trace.rootSpan !== null) {
          const incompleteRoot = buildIncompleteRootSpan(
            trace.rootSpan,
            trace.rootSpanEvents,
            trace.resource
          );
          spans = [incompleteRoot, ...trace.childSpans];
        } else {
          spans = [...trace.childSpans];
        }
        result.push(...spans);
        this.traces.delete(runId);
      }
    }

    return result;
  }

  /**
   * Flush all buffered traces (for shutdown).
   * Returns all buffered spans as incomplete traces.
   */
  flushAll(): ReadableSpan[] {
    const result: ReadableSpan[] = [];

    for (const [runId, trace] of this.traces) {
      let spans: ReadableSpan[];
      if (trace.rootSpan !== null) {
        const incompleteRoot = buildIncompleteRootSpan(
          trace.rootSpan,
          trace.rootSpanEvents,
          trace.resource
        );
        spans = [incompleteRoot, ...trace.childSpans];
      } else {
        spans = [...trace.childSpans];
      }
      result.push(...spans);
      this.traces.delete(runId);
    }

    return result;
  }

  /** Number of currently buffered (incomplete) traces. */
  get size(): number {
    return this.traces.size;
  }

  private evictOldest(): void {
    let oldestRunId: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const [runId, trace] of this.traces) {
      if (trace.firstEventTime < oldestTime) {
        oldestTime = trace.firstEventTime;
        oldestRunId = runId;
      }
    }

    if (oldestRunId !== null) {
      this.traces.delete(oldestRunId);
    }
  }
}
