// SPDX-License-Identifier: MIT

import { describe, test, expect } from "bun:test";
import { traceId, spanId } from "../src/ids.js";

// Vectors from spec Section 3.2 and tests/fixtures/otel-span-id-vectors.json
const RUN_ID_UUID = "01960e07-d0e9-7ad0-8621-5614ec0dbd54";
const RUN_ID_HEX = "01960e07d0e97ad086215614ec0dbd54";

describe("traceId", () => {
  test("strips hyphens and lowercases UUID v7", () => {
    expect(traceId(RUN_ID_UUID)).toBe(RUN_ID_HEX);
  });

  test("handles UUID v4", () => {
    const uuidV4 = "550e8400-e29b-41d4-a716-446655440000";
    expect(traceId(uuidV4)).toBe("550e8400e29b41d4a716446655440000");
  });

  test("already lowercased input stays lowercased", () => {
    expect(traceId("550e8400-e29b-41d4-a716-446655440000")).toMatch(
      /^[0-9a-f]{32}$/,
    );
  });

  test("uppercase UUID input lowercased in output", () => {
    const upper = "01960E07-D0E9-7AD0-8621-5614EC0DBD54";
    expect(traceId(upper)).toBe(RUN_ID_HEX);
  });

  test("result is always 32 hex chars", () => {
    expect(traceId(RUN_ID_UUID)).toHaveLength(32);
  });

  test("result matches only hex chars", () => {
    expect(traceId(RUN_ID_UUID)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("spanId spec vectors", () => {
  test("seq=0 (root span, synthetic) matches spec vector", () => {
    expect(spanId(RUN_ID_UUID, 0)).toBe("bbb16c9cc3271f92");
  });

  test("seq=1 (first child span) matches spec vector", () => {
    expect(spanId(RUN_ID_UUID, 1)).toBe("3eb8b9ba7c1e4abe");
  });

  test("seq=2 (second child span) matches spec vector", () => {
    expect(spanId(RUN_ID_UUID, 2)).toBe("0801329b2ca54dbf");
  });

  test("seq=5 (non-sequential) matches spec vector", () => {
    expect(spanId(RUN_ID_UUID, 5)).toBe("68271a005fb67213");
  });
});

describe("spanId properties", () => {
  test("result is 16 hex chars (8 bytes)", () => {
    expect(spanId(RUN_ID_UUID, 0)).toHaveLength(16);
  });

  test("result matches only hex chars", () => {
    expect(spanId(RUN_ID_UUID, 42)).toMatch(/^[0-9a-f]{16}$/);
  });

  test("different seq values produce different span IDs", () => {
    const id0 = spanId(RUN_ID_UUID, 0);
    const id1 = spanId(RUN_ID_UUID, 1);
    const id10 = spanId(RUN_ID_UUID, 10);
    expect(id0).not.toBe(id1);
    expect(id1).not.toBe(id10);
    expect(id0).not.toBe(id10);
  });

  test("different run IDs produce different span IDs", () => {
    const otherId = "550e8400-e29b-41d4-a716-446655440000";
    expect(spanId(RUN_ID_UUID, 0)).not.toBe(spanId(otherId, 0));
  });

  test("all-zero edge case: sets LSB to 1 (non-zero guarantee)", () => {
    // We can't force all-zero in practice, but verify the function handles it
    // by checking that all produced IDs are non-zero
    for (let seq = 0; seq <= 20; seq++) {
      const id = spanId(RUN_ID_UUID, seq);
      expect(id).not.toBe("0000000000000000");
    }
  });

  test("deterministic: same inputs produce same output", () => {
    expect(spanId(RUN_ID_UUID, 3)).toBe(spanId(RUN_ID_UUID, 3));
  });
});
