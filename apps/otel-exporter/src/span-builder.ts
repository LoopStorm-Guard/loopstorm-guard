// SPDX-License-Identifier: MIT

import { type Link, type SpanContext, SpanStatusCode, TraceFlags } from "@opentelemetry/api";
import type { Resource } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  type TimedEvent,
} from "@opentelemetry/sdk-trace-base";
import { buildAttributes } from "./attributes.js";
import { spanId, traceId } from "./ids.js";
import { spanStatusForEvent } from "./span-status.js";
import type { ParsedEvent } from "./types.js";

/**
 * Build a ReadableSpan for the given event.
 *
 * Uses BasicTracerProvider + InMemorySpanExporter to construct spans
 * programmatically without needing an active trace context.
 */
export function buildSpan(
  event: ParsedEvent,
  resource: Resource,
  rootSpanId: string,
  rootSpanEvents: TimedEvent[]
): ReadableSpan {
  const provider = new BasicTracerProvider({ resource });
  const exporter = new InMemorySpanExporter();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

  const tracer = provider.getTracer("loopstorm-otel-exporter", "0.1.0");

  const tId = traceId(event.run_id);
  const isRoot = event.event_type === "run_started";
  // Root span uses synthetic seq=0 per spec Section 3.2.
  // The run_started event may have seq=1, but the OTel span_id is always
  // derived from seq=0 so child spans can consistently reference the root.
  const sId = isRoot ? spanId(event.run_id, 0) : spanId(event.run_id, event.seq);

  // Timestamps: OTel uses [seconds, nanoseconds] high-res time (HrTime)
  const startMs = new Date(event.ts).getTime();
  const startHr: [number, number] = [Math.floor(startMs / 1000), (startMs % 1000) * 1_000_000];

  // Duration for policy_decision: latency_ms -> end time
  // All other non-root spans: zero duration (end = start)
  let endMs = startMs;
  if (event.event_type === "policy_decision" && event.latency_ms !== undefined) {
    endMs = startMs + event.latency_ms;
  }
  const endHr: [number, number] = [Math.floor(endMs / 1000), (endMs % 1000) * 1_000_000];

  const attrs = buildAttributes(event);
  const status = spanStatusForEvent(
    event.event_type,
    event.decision,
    event.reason,
    event.run_status
  );

  // Build supervisor span link if this is supervisor_run_started with trigger_run_id
  const links: Link[] = [];
  if (event.event_type === "supervisor_run_started" && event.trigger_run_id !== undefined) {
    const triggerTraceId = traceId(event.trigger_run_id);
    const triggerRootSpanId = spanId(event.trigger_run_id, 0);
    const linkCtx: SpanContext = {
      traceId: triggerTraceId,
      spanId: triggerRootSpanId,
      traceFlags: TraceFlags.SAMPLED,
    };
    links.push({
      context: linkCtx,
      attributes: { "loopstorm.link_type": "supervisor_trigger" },
    });
  }

  // For root spans, no parent. For child spans, parent is root.
  const span = isRoot
    ? tracer.startSpan(
        `loopstorm.${event.event_type}`,
        {
          startTime: startHr,
          links,
          attributes: attrs,
        }
        // No parent context for root spans
      )
    : tracer.startSpan(`loopstorm.${event.event_type}`, {
        startTime: startHr,
        links,
        attributes: attrs,
      });

  // We need to override the span IDs since OTel SDK generates them randomly.
  // We'll use the internal SDK span object to set the correct IDs.
  // The cleanest approach is to use recordSpan() approach.
  // Actually, with BasicTracerProvider we can't override IDs after creation.
  // Use the SDK's internal structure to override spanContext.
  // biome-ignore lint/suspicious/noExplicitAny: accessing internal OTel SDK span properties to override generated IDs
  const internalSpan = span as any;
  if (internalSpan._spanContext) {
    internalSpan._spanContext.traceId = tId;
    internalSpan._spanContext.spanId = sId;
  }

  // Set parent span ID for child spans
  if (!isRoot) {
    internalSpan.parentSpanId = rootSpanId;
  }

  // Set status
  span.setStatus(status);

  // Attach root span events (budget warnings, loop detections)
  if (isRoot && rootSpanEvents.length > 0) {
    for (const timedEvent of rootSpanEvents) {
      span.addEvent(timedEvent.name, timedEvent.attributes, timedEvent.time);
    }
  }

  span.end(endHr);

  const finished = exporter.getFinishedSpans();
  // biome-ignore lint/style/noNonNullAssertion: we just created and ended the span
  return finished[finished.length - 1]!;
}

/**
 * Build a root span event (budget warning or loop detection) to attach
 * to the root span.
 */
export function buildRootSpanEvent(event: ParsedEvent): TimedEvent {
  const ts = new Date(event.ts).getTime();
  const time: [number, number] = [Math.floor(ts / 1000), (ts % 1000) * 1_000_000];

  let name: string;
  switch (event.event_type) {
    case "budget_soft_cap_warning":
      name = "loopstorm.budget_warning";
      break;
    case "budget_exceeded":
      name = "loopstorm.budget_exceeded";
      break;
    case "loop_detected":
      name = "loopstorm.loop_detected";
      break;
    default:
      name = `loopstorm.${event.event_type}`;
  }

  return {
    name,
    attributes: buildAttributes(event),
    time,
    droppedAttributesCount: 0,
  };
}

/**
 * Finalize a root span by setting end time and status from run_ended event.
 * Returns a new ReadableSpan with updated end time and status.
 */
export function finalizeRootSpan(
  rootSpan: ReadableSpan,
  runEndedEvent: ParsedEvent,
  rootSpanEvents: TimedEvent[],
  resource: Resource
): ReadableSpan {
  const provider = new BasicTracerProvider({ resource });
  const exporter = new InMemorySpanExporter();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  const tracer = provider.getTracer("loopstorm-otel-exporter", "0.1.0");

  const endMs = new Date(runEndedEvent.ts).getTime();
  const endHr: [number, number] = [Math.floor(endMs / 1000), (endMs % 1000) * 1_000_000];

  const status = spanStatusForEvent("run_ended", undefined, undefined, runEndedEvent.run_status);

  // Reconstruct root span with correct end time
  const runStartedAttrs = rootSpan.attributes;
  const startHr = rootSpan.startTime;

  const span = tracer.startSpan("loopstorm.run_started", {
    startTime: startHr,
    attributes: runStartedAttrs,
  });

  // biome-ignore lint/suspicious/noExplicitAny: accessing internal OTel SDK span properties to override generated IDs
  const internalSpan = span as any;
  if (internalSpan._spanContext) {
    internalSpan._spanContext.traceId = rootSpan.spanContext().traceId;
    internalSpan._spanContext.spanId = rootSpan.spanContext().spanId;
  }

  span.setStatus(status);

  // Re-attach root span events
  for (const timedEvent of rootSpanEvents) {
    span.addEvent(timedEvent.name, timedEvent.attributes, timedEvent.time);
  }

  span.end(endHr);

  const finished = exporter.getFinishedSpans();
  // biome-ignore lint/style/noNonNullAssertion: we just created and ended the span
  return finished[finished.length - 1]!;
}

/**
 * Build a root span with zero duration for incomplete traces (timeout flush).
 */
export function buildIncompleteRootSpan(
  rootSpan: ReadableSpan,
  rootSpanEvents: TimedEvent[],
  resource: Resource
): ReadableSpan {
  const provider = new BasicTracerProvider({ resource });
  const exporter = new InMemorySpanExporter();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  const tracer = provider.getTracer("loopstorm-otel-exporter", "0.1.0");

  const startHr = rootSpan.startTime;

  const span = tracer.startSpan("loopstorm.run_started", {
    startTime: startHr,
    attributes: rootSpan.attributes,
  });

  // biome-ignore lint/suspicious/noExplicitAny: accessing internal OTel SDK span properties to override generated IDs
  const internalSpan = span as any;
  if (internalSpan._spanContext) {
    internalSpan._spanContext.traceId = rootSpan.spanContext().traceId;
    internalSpan._spanContext.spanId = rootSpan.spanContext().spanId;
  }

  span.setStatus({ code: SpanStatusCode.UNSET });

  for (const timedEvent of rootSpanEvents) {
    span.addEvent(timedEvent.name, timedEvent.attributes, timedEvent.time);
  }

  // Zero duration: end at start time
  span.end(startHr);

  const finished = exporter.getFinishedSpans();
  // biome-ignore lint/style/noNonNullAssertion: we just created and ended the span
  return finished[finished.length - 1]!;
}
