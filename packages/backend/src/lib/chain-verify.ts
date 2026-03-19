// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server-side hash chain verification for LoopStorm Guard audit logs.
 *
 * Algorithm (mirrors apps/cli/src/verify.rs):
 * 1. Sort events by `seq` ascending.
 * 2. For each event:
 *    a. If `raw_line` is available, hash the raw line to get the expected
 *       payload hash. Otherwise, re-serialize the event (see note below).
 *    b. Compare the computed hash against the stored `hash` field.
 *    c. Compare the event's `hash_prev` against the previous event's hash.
 * 3. Return `{ valid: true }` or `{ valid: false, brokenAtSeq: N }`.
 *
 * When `raw_line` is available:
 * - The hash is computed as SHA-256 of the raw JSONL line bytes (UTF-8).
 * - This is bit-exact and matches what the engine wrote.
 *
 * When `raw_line` is NOT available (server-created events or legacy):
 * - The hash is re-computed by serializing the event object (without the
 *   `hash` and `hash_prev` fields) using deterministic JSON serialization.
 * - WARNING: This may produce false-negative chain breaks if the original
 *   serialization differed (e.g., different key ordering, floating-point
 *   representation). It is best-effort only.
 *
 * This module operates on plain objects (not Drizzle row types) so it can
 * be used both for stored events and for events in an ingest batch.
 */

import { createHash } from "node:crypto";

/**
 * Minimal interface for an event used in chain verification.
 * Matches both the Drizzle `Event` type and the ingest batch event shape.
 */
export interface ChainEvent {
  seq: number;
  hash: string;
  hash_prev: string | null;
  raw_line?: string | null;
  // All other fields are opaque — we only need them for re-serialization
  // when raw_line is absent.
  [key: string]: unknown;
}

/**
 * Result of a chain verification.
 */
export type ChainVerifyResult =
  | { valid: true; eventCount: number }
  | { valid: false; eventCount: number; brokenAtSeq: number; reason: string };

/**
 * Verify the hash chain integrity of a sequence of events.
 *
 * Events do not need to be pre-sorted; this function sorts them by `seq`.
 * The input array is not mutated.
 *
 * @param events - Array of events to verify (any order)
 * @returns Verification result
 */
export function verifyChain(events: ChainEvent[]): ChainVerifyResult {
  if (events.length === 0) {
    return { valid: true, eventCount: 0 };
  }

  // Sort by seq ascending — defensive copy to avoid mutating caller's array.
  const sorted = [...events].sort((a, b) => a.seq - b.seq);

  let prevHash: string | null = null;

  for (const event of sorted) {
    const computedHash = computeEventHash(event);

    // 1. Verify this event's payload hash
    if (computedHash !== event.hash) {
      return {
        valid: false,
        eventCount: events.length,
        brokenAtSeq: event.seq,
        reason: `Hash mismatch at seq=${event.seq}: computed=${computedHash}, stored=${event.hash}`,
      };
    }

    // 2. Verify the chain link (hash_prev)
    if (prevHash === null) {
      // First event: hash_prev must be null
      if (event.hash_prev !== null) {
        return {
          valid: false,
          eventCount: events.length,
          brokenAtSeq: event.seq,
          reason: `seq=${event.seq} has hash_prev=${event.hash_prev} but expected null (first event)`,
        };
      }
    } else {
      // Subsequent events: hash_prev must equal the previous event's hash
      if (event.hash_prev !== prevHash) {
        return {
          valid: false,
          eventCount: events.length,
          brokenAtSeq: event.seq,
          reason: `Chain break at seq=${event.seq}: hash_prev=${event.hash_prev}, expected=${prevHash}`,
        };
      }
    }

    prevHash = event.hash;
  }

  return { valid: true, eventCount: events.length };
}

/**
 * Compute the expected hash for a single event.
 *
 * If `raw_line` is present and non-empty, compute SHA-256 of the raw line
 * bytes (bit-exact). Otherwise, re-serialize without hash fields (best-effort).
 *
 * @param event - The event to hash
 * @returns 64-character lowercase hex SHA-256 digest
 */
export function computeEventHash(event: ChainEvent): string {
  if (event.raw_line) {
    // Bit-exact: hash the original JSONL line as received
    return createHash("sha256").update(event.raw_line, "utf8").digest("hex");
  }

  // Best-effort: re-serialize the event without hash fields.
  // Strip `hash` and `hash_prev` from the object, then serialize with
  // sorted keys for determinism.
  const { hash: _hash, hash_prev: _hashPrev, raw_line: _rawLine, ...rest } = event;
  const serialized = deterministicStringify(rest);
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

/**
 * Serialize an object to a deterministic JSON string with sorted keys.
 *
 * This is NOT a full JCS (RFC 8785) implementation — it handles the common
 * case of objects with string/number/boolean/null/array/object values.
 * For events coming from the engine (which uses JCS), this should produce
 * a matching serialization in the common case.
 *
 * CAVEAT: Floating-point numbers may serialize differently depending on the
 * JavaScript engine. If the original event used JCS (which normalizes floats),
 * re-serialization here may differ for values with many decimal places. This
 * is why `raw_line` is preferred whenever available.
 *
 * @param value - The value to serialize
 * @returns JSON string with object keys sorted recursively
 */
function deterministicStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(deterministicStringify).join(",");
    return `[${items}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${deterministicStringify(obj[k])}`);
    return `{${pairs.join(",")}}`;
  }
  // Fallback for unexpected types (e.g., bigint, function).
  // JSON.stringify returns undefined for functions and throws for bigint
  // in some engines — guard defensively.
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}
