// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for the trigger queue.
 *
 * Covers acceptance criteria AC-A4-1 through AC-A4-4:
 * - AC-A4-1: TriggerQueue enforces capacity (100).
 * - AC-A4-2: Enqueue returns false when full (does not throw).
 * - AC-A4-3: Deduplication suppresses same-run triggers within 60s window.
 * - AC-A4-4: Highest-priority trigger wins during dedup.
 */

import { describe, expect, test } from "bun:test";
import { type TriggerMessage, TriggerQueue } from "../../src/lib/trigger-queue.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<TriggerMessage> = {}): TriggerMessage {
  return {
    trigger: "terminated_budget",
    trigger_run_id: "019606f0-0000-0000-0000-000000000001",
    tenant_id: "tenant-1",
    priority: 1,
    enqueued_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC-A4-1: Capacity enforcement
// ---------------------------------------------------------------------------

describe("TriggerQueue capacity", () => {
  test("AC-A4-1: enforces capacity limit", () => {
    const queue = new TriggerQueue(5);

    for (let i = 0; i < 5; i++) {
      const ok = queue.enqueue(makeMessage({ trigger_run_id: `run-${i}` }));
      expect(ok).toBe(true);
    }

    expect(queue.size).toBe(5);

    // 6th message should be rejected
    const ok = queue.enqueue(makeMessage({ trigger_run_id: "run-overflow" }));
    expect(ok).toBe(false);
    expect(queue.size).toBe(5);
  });

  test("AC-A4-1: default capacity is 100", () => {
    const queue = new TriggerQueue();

    for (let i = 0; i < 100; i++) {
      const ok = queue.enqueue(makeMessage({ trigger_run_id: `run-${i}` }));
      expect(ok).toBe(true);
    }

    expect(queue.size).toBe(100);

    const ok = queue.enqueue(makeMessage({ trigger_run_id: "run-overflow" }));
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-A4-2: Enqueue returns false when full
// ---------------------------------------------------------------------------

describe("TriggerQueue enqueue return value", () => {
  test("AC-A4-2: returns false when full (does not throw)", () => {
    const queue = new TriggerQueue(1);
    queue.enqueue(makeMessage({ trigger_run_id: "run-1" }));

    // Should return false, not throw
    const result = queue.enqueue(makeMessage({ trigger_run_id: "run-2" }));
    expect(result).toBe(false);
  });

  test("returns true when enqueued successfully", () => {
    const queue = new TriggerQueue(10);
    const result = queue.enqueue(makeMessage());
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-A4-3: Deduplication
// ---------------------------------------------------------------------------

describe("TriggerQueue deduplication", () => {
  test("AC-A4-3: suppresses same-run triggers within dedup window", () => {
    const queue = new TriggerQueue(10);
    const runId = "run-dedup-test";

    // First enqueue succeeds
    const ok1 = queue.enqueue(makeMessage({ trigger_run_id: runId, priority: 2 }));
    expect(ok1).toBe(true);

    // Second enqueue for same run with same or lower priority is suppressed
    const ok2 = queue.enqueue(makeMessage({ trigger_run_id: runId, priority: 2 }));
    expect(ok2).toBe(false);

    // Only 1 message in queue
    expect(queue.size).toBe(1);
  });

  test("AC-A4-3: different run_ids are not deduplicated", () => {
    const queue = new TriggerQueue(10);

    queue.enqueue(makeMessage({ trigger_run_id: "run-1", priority: 2 }));
    queue.enqueue(makeMessage({ trigger_run_id: "run-2", priority: 2 }));

    expect(queue.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC-A4-4: Highest-priority trigger wins during dedup
// ---------------------------------------------------------------------------

describe("TriggerQueue priority during dedup", () => {
  test("AC-A4-4: higher-priority trigger (lower number) replaces dedup entry", () => {
    const queue = new TriggerQueue(10);
    const runId = "run-priority-test";

    // Enqueue with priority 3 (medium)
    const ok1 = queue.enqueue(
      makeMessage({ trigger_run_id: runId, priority: 3, trigger: "abandoned" })
    );
    expect(ok1).toBe(true);

    // Enqueue with priority 1 (critical) — should be accepted
    const ok2 = queue.enqueue(
      makeMessage({ trigger_run_id: runId, priority: 1, trigger: "terminated_budget" })
    );
    expect(ok2).toBe(true);

    // Both messages are in the queue (dedup entry updated, but original stays)
    expect(queue.size).toBe(2);

    // After the critical trigger, a lower-priority trigger should be suppressed
    const ok3 = queue.enqueue(
      makeMessage({ trigger_run_id: runId, priority: 2, trigger: "high_cost" })
    );
    expect(ok3).toBe(false); // priority 2 >= priority 1, suppressed
  });

  test("AC-A4-4: equal priority is suppressed (not replaced)", () => {
    const queue = new TriggerQueue(10);
    const runId = "run-equal-priority";

    queue.enqueue(makeMessage({ trigger_run_id: runId, priority: 2 }));
    const ok = queue.enqueue(makeMessage({ trigger_run_id: runId, priority: 2 }));

    expect(ok).toBe(false);
    expect(queue.size).toBe(1);
  });

  test("AC-A4-4: lower priority (higher number) is suppressed", () => {
    const queue = new TriggerQueue(10);
    const runId = "run-lower-priority";

    queue.enqueue(makeMessage({ trigger_run_id: runId, priority: 1 }));
    const ok = queue.enqueue(makeMessage({ trigger_run_id: runId, priority: 3 }));

    expect(ok).toBe(false);
    expect(queue.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FIFO dequeue
// ---------------------------------------------------------------------------

describe("TriggerQueue dequeue", () => {
  test("dequeues in FIFO order", () => {
    const queue = new TriggerQueue(10);

    queue.enqueue(makeMessage({ trigger_run_id: "run-1", trigger: "first" }));
    queue.enqueue(makeMessage({ trigger_run_id: "run-2", trigger: "second" }));
    queue.enqueue(makeMessage({ trigger_run_id: "run-3", trigger: "third" }));

    expect(queue.dequeue()?.trigger).toBe("first");
    expect(queue.dequeue()?.trigger).toBe("second");
    expect(queue.dequeue()?.trigger).toBe("third");
    expect(queue.dequeue()).toBeNull();
  });

  test("returns null when queue is empty", () => {
    const queue = new TriggerQueue(10);
    expect(queue.dequeue()).toBeNull();
  });

  test("size decreases on dequeue", () => {
    const queue = new TriggerQueue(10);
    queue.enqueue(makeMessage({ trigger_run_id: "run-1" }));
    queue.enqueue(makeMessage({ trigger_run_id: "run-2" }));

    expect(queue.size).toBe(2);
    queue.dequeue();
    expect(queue.size).toBe(1);
    queue.dequeue();
    expect(queue.size).toBe(0);
  });
});
