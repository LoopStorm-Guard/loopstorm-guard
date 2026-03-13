<!-- SPDX-License-Identifier: MIT -->
# ADR-006: Queue Backpressure at 10,000 Events

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

The engine queues events in memory for asynchronous HTTP batch forwarding to the hosted backend. If the backend is slow or unreachable, this queue grows. Unbounded queue growth risks engine OOM, which would crash the enforcement process and leave the agent unguarded.

---

## Decision

The in-memory HTTP batch queue has a **hard cap of 10,000 events**. When the queue reaches this limit, the engine applies backpressure:

1. New events are still written to the local JSONL file (ground truth is never compromised).
2. New events are **dropped from the HTTP queue** (not queued for backend forwarding).
3. A `system_event` with subtype `queue_backpressure_activated` is emitted to the JSONL log.
4. When the queue drains below 7,000 events (70% of the cap), queuing resumes.
5. A `system_event` with subtype `queue_backpressure_deactivated` is emitted when queuing resumes.

Events dropped from the HTTP queue are recoverable via the JSONL import API. The local JSONL file always contains the complete event sequence.

The 10,000 limit is chosen based on:
- Each event is approximately 500 bytes to 2KB. At 2KB, 10,000 events consume ~20MB of memory.
- 20MB is a reasonable memory budget for a co-process running alongside an agent.
- At 100 events per batch flush (5-second interval), 10,000 events represent ~8 minutes of sustained backend unavailability at high throughput.

---

## Consequences

**Positive:**
- Engine memory usage is bounded regardless of backend availability.
- Local JSONL integrity is never compromised by queue pressure.
- Operators receive explicit notification (system event) when backpressure activates.

**Negative:**
- Events dropped from the HTTP queue create a gap in the backend's event store. This gap is recoverable via JSONL import but requires manual action in v1.
- The 10,000 limit may be too low for extremely high-throughput agents. It is configurable in the engine configuration but the default is 10,000.

---

## Migration Path

If automatic JSONL reconciliation is implemented (v1.1), the backend can detect gaps in the event sequence (missing `seq` values) and request the missing events from the JSONL import API. This eliminates the manual recovery step.

The queue size limit may be made configurable per deployment. The default of 10,000 should remain unless there is empirical evidence that a different value is needed.
