// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for the hash chain verification library.
 *
 * Tests are pure — no database required.
 * Uses bun:test.
 */

import { describe, test, expect } from "bun:test";
import { createHash } from "crypto";
import {
  verifyChain,
  computeEventHash,
  type ChainEvent,
} from "../../src/lib/chain-verify.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute SHA-256 hex of a string (UTF-8). */
function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Build a valid chain of events from raw JSONL lines.
 * Each line is hashed; subsequent events get the previous hash as hash_prev.
 */
function buildValidChain(rawLines: string[]): ChainEvent[] {
  const events: ChainEvent[] = [];
  let prevHash: string | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i]!;
    // Build a minimal JSON object whose hash is sha256(rawLine)
    // We'll store the raw_line and set hash to sha256(rawLine)
    const hash = sha256(rawLine);

    events.push({
      seq: i + 1,
      hash,
      hash_prev: prevHash,
      raw_line: rawLine,
    });

    prevHash = hash;
  }

  return events;
}

// ---------------------------------------------------------------------------
// verifyChain — valid chains
// ---------------------------------------------------------------------------

describe("verifyChain — valid chains", () => {
  test("empty array returns valid", () => {
    const result = verifyChain([]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.eventCount).toBe(0);
    }
  });

  test("single event with null hash_prev", () => {
    const rawLine = '{"schema_version":1,"seq":1,"event_type":"run_started"}';
    const events = buildValidChain([rawLine]);
    const result = verifyChain(events);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.eventCount).toBe(1);
    }
  });

  test("two-event chain with correct chain link", () => {
    const lines = [
      '{"schema_version":1,"seq":1,"event_type":"run_started","run_id":"abc"}',
      '{"schema_version":1,"seq":2,"event_type":"policy_decision","run_id":"abc"}',
    ];
    const events = buildValidChain(lines);
    expect(events[1]!.hash_prev).toBe(events[0]!.hash);

    const result = verifyChain(events);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.eventCount).toBe(2);
    }
  });

  test("five-event chain", () => {
    const lines = Array.from(
      { length: 5 },
      (_, i) => `{"seq":${i + 1},"event_type":"tool_call","idx":${i}}`,
    );
    const events = buildValidChain(lines);
    const result = verifyChain(events);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.eventCount).toBe(5);
    }
  });

  test("accepts events in unsorted order (sorts by seq internally)", () => {
    const lines = [
      '{"seq":1,"event_type":"a"}',
      '{"seq":2,"event_type":"b"}',
      '{"seq":3,"event_type":"c"}',
    ];
    const events = buildValidChain(lines);
    // Shuffle
    const shuffled = [events[2]!, events[0]!, events[1]!];
    const result = verifyChain(shuffled);
    expect(result.valid).toBe(true);
  });

  test("does not mutate the input array", () => {
    const lines = [
      '{"seq":1,"event_type":"a"}',
      '{"seq":2,"event_type":"b"}',
    ];
    const events = buildValidChain(lines);
    const shuffled = [events[1]!, events[0]!]; // seq 2 first
    const original = [...shuffled];
    verifyChain(shuffled);
    // Input should not be sorted in-place
    expect(shuffled[0]!.seq).toBe(original[0]!.seq);
    expect(shuffled[1]!.seq).toBe(original[1]!.seq);
  });
});

// ---------------------------------------------------------------------------
// verifyChain — tampered chains
// ---------------------------------------------------------------------------

describe("verifyChain — tampered chains", () => {
  test("tampered payload hash at seq=1", () => {
    const lines = ['{"seq":1,"event_type":"run_started"}', '{"seq":2}'];
    const events = buildValidChain(lines);

    // Tamper: change the stored hash of the first event
    const tampered: ChainEvent[] = [
      { ...events[0]!, hash: "a".repeat(64) },
      events[1]!,
    ];

    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAtSeq).toBe(1);
    }
  });

  test("tampered payload hash at seq=3 (middle of chain)", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `{"seq":${i + 1},"x":${i}}`);
    const events = buildValidChain(lines);

    const tampered = events.map((e) =>
      e.seq === 3 ? { ...e, hash: "b".repeat(64) } : e,
    );

    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAtSeq).toBe(3);
    }
  });

  test("broken chain link: hash_prev mismatch at seq=2", () => {
    const lines = ['{"seq":1}', '{"seq":2}', '{"seq":3}'];
    const events = buildValidChain(lines);

    // Tamper: set seq=2's hash_prev to a wrong value
    const tampered = events.map((e) =>
      e.seq === 2 ? { ...e, hash_prev: "c".repeat(64) } : e,
    );

    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAtSeq).toBe(2);
    }
  });

  test("first event has non-null hash_prev (should fail)", () => {
    const rawLine = '{"seq":1,"event_type":"run_started"}';
    const hash = sha256(rawLine);

    const events: ChainEvent[] = [
      {
        seq: 1,
        hash,
        hash_prev: "d".repeat(64), // should be null for first event
        raw_line: rawLine,
      },
    ];

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAtSeq).toBe(1);
    }
  });

  test("tampered raw_line (hash computed from raw_line does not match stored hash)", () => {
    const rawLine = '{"seq":1}';
    const hash = sha256(rawLine);

    const events: ChainEvent[] = [
      {
        seq: 1,
        hash,
        hash_prev: null,
        raw_line: '{"seq":1,"TAMPERED":true}', // different from what was hashed
      },
    ];

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAtSeq).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// computeEventHash
// ---------------------------------------------------------------------------

describe("computeEventHash", () => {
  test("uses raw_line when present", () => {
    const rawLine = '{"seq":1,"event_type":"run_started"}';
    const event: ChainEvent = {
      seq: 1,
      hash: sha256(rawLine),
      hash_prev: null,
      raw_line: rawLine,
    };
    expect(computeEventHash(event)).toBe(sha256(rawLine));
  });

  test("falls back to re-serialization when raw_line is absent", () => {
    const event: ChainEvent = {
      seq: 1,
      hash: "any",
      hash_prev: null,
      raw_line: null,
      // additional field to exercise re-serialization
      event_type: "run_started",
    };
    const hash = computeEventHash(event);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("re-serialization excludes hash, hash_prev, and raw_line fields", () => {
    const event1: ChainEvent = {
      seq: 1,
      hash: "HASH_VALUE",
      hash_prev: "PREV_HASH",
      raw_line: null,
      event_type: "foo",
    };
    const event2: ChainEvent = {
      seq: 1,
      hash: "DIFFERENT_HASH",
      hash_prev: "DIFFERENT_PREV",
      raw_line: null,
      event_type: "foo",
    };
    // Both events have the same fields except hash/hash_prev — must produce same hash
    expect(computeEventHash(event1)).toBe(computeEventHash(event2));
  });

  test("re-serialization produces consistent results for same input", () => {
    const event: ChainEvent = {
      seq: 42,
      hash: "any",
      hash_prev: null,
      raw_line: null,
      event_type: "policy_decision",
      decision: "allow",
    };
    const hash1 = computeEventHash(event);
    const hash2 = computeEventHash(event);
    expect(hash1).toBe(hash2);
  });

  test("raw_line empty string is treated as absent", () => {
    // raw_line = "" should fall back to re-serialization (truthy check)
    const event: ChainEvent = {
      seq: 1,
      hash: "any",
      hash_prev: null,
      raw_line: "",
      event_type: "run_started",
    };
    const hash = computeEventHash(event);
    // Should not be sha256("") — that would be e3b0c44...
    // It should be the re-serialized hash instead
    expect(hash).not.toBe(sha256(""));
    expect(hash).toHaveLength(64);
  });
});
