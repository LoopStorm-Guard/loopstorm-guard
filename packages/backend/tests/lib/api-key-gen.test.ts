// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for the API key generation and hashing utilities.
 *
 * Tests are pure — no database required.
 * Uses bun:test.
 */

import { describe, test, expect } from "bun:test";
import { createHash } from "crypto";
import {
  generateApiKey,
  hashApiKey,
  extractKeyPrefix,
  isValidKeyFormat,
} from "../../src/lib/api-key-gen.js";

// ---------------------------------------------------------------------------
// generateApiKey
// ---------------------------------------------------------------------------

describe("generateApiKey", () => {
  test("rawKey has the correct lsg_ prefix", () => {
    const { rawKey } = generateApiKey();
    expect(rawKey.startsWith("lsg_")).toBe(true);
  });

  test("rawKey is exactly 36 characters (lsg_ + 32 hex)", () => {
    const { rawKey } = generateApiKey();
    expect(rawKey.length).toBe(36);
  });

  test("rawKey matches the expected format regex", () => {
    const { rawKey } = generateApiKey();
    expect(/^lsg_[0-9a-f]{32}$/.test(rawKey)).toBe(true);
  });

  test("keyHash is a 64-character lowercase hex SHA-256 digest", () => {
    const { keyHash } = generateApiKey();
    expect(keyHash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(keyHash)).toBe(true);
  });

  test("keyHash matches sha256(rawKey)", () => {
    const { rawKey, keyHash } = generateApiKey();
    const expected = createHash("sha256").update(rawKey, "utf8").digest("hex");
    expect(keyHash).toBe(expected);
  });

  test("keyPrefix is the first 8 characters of rawKey", () => {
    const { rawKey, keyPrefix } = generateApiKey();
    expect(keyPrefix).toBe(rawKey.slice(0, 8));
    expect(keyPrefix.length).toBe(8);
  });

  test("keyPrefix starts with lsg_", () => {
    const { keyPrefix } = generateApiKey();
    expect(keyPrefix.startsWith("lsg_")).toBe(true);
  });

  test("each generated key is unique", () => {
    const keys = Array.from({ length: 100 }, () => generateApiKey().rawKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(100);
  });

  test("each generated keyHash is unique", () => {
    const hashes = Array.from({ length: 100 }, () => generateApiKey().keyHash);
    const unique = new Set(hashes);
    expect(unique.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// hashApiKey
// ---------------------------------------------------------------------------

describe("hashApiKey", () => {
  test("returns 64-character lowercase hex", () => {
    const hash = hashApiKey("lsg_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
    expect(hash.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  test("is deterministic — same input produces same hash", () => {
    const key = "lsg_aaaabbbbccccddddeeeeffffaaaa1234";
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  test("different inputs produce different hashes", () => {
    const h1 = hashApiKey("lsg_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
    const h2 = hashApiKey("lsg_b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4");
    expect(h1).not.toBe(h2);
  });

  test("matches SHA-256 of UTF-8 bytes", () => {
    const key = "lsg_testkey000000000000000000000001";
    const expected = createHash("sha256").update(key, "utf8").digest("hex");
    expect(hashApiKey(key)).toBe(expected);
  });

  test("can hash any string (not just lsg_ keys)", () => {
    // Defensive: the function should work on any input, not just lsg_ keys.
    const hash = hashApiKey("arbitrary-string");
    expect(hash).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// extractKeyPrefix
// ---------------------------------------------------------------------------

describe("extractKeyPrefix", () => {
  test("returns first 8 characters", () => {
    const key = "lsg_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
    expect(extractKeyPrefix(key)).toBe("lsg_a1b2");
  });

  test("prefix length is always 8", () => {
    const key = "lsg_" + "f".repeat(32);
    expect(extractKeyPrefix(key).length).toBe(8);
  });

  test("prefix starts with lsg_", () => {
    const { rawKey } = generateApiKey();
    expect(extractKeyPrefix(rawKey).startsWith("lsg_")).toBe(true);
  });

  test("prefix from generateApiKey matches extractKeyPrefix(rawKey)", () => {
    const { rawKey, keyPrefix } = generateApiKey();
    expect(extractKeyPrefix(rawKey)).toBe(keyPrefix);
  });
});

// ---------------------------------------------------------------------------
// isValidKeyFormat
// ---------------------------------------------------------------------------

describe("isValidKeyFormat", () => {
  test("valid key format returns true", () => {
    expect(isValidKeyFormat("lsg_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4")).toBe(
      true,
    );
  });

  test("freshly generated key is valid", () => {
    const { rawKey } = generateApiKey();
    expect(isValidKeyFormat(rawKey)).toBe(true);
  });

  test("wrong prefix returns false", () => {
    expect(isValidKeyFormat("key_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4")).toBe(
      false,
    );
  });

  test("too short returns false", () => {
    expect(isValidKeyFormat("lsg_a1b2c3")).toBe(false);
  });

  test("too long returns false", () => {
    expect(isValidKeyFormat("lsg_" + "a".repeat(33))).toBe(false);
  });

  test("uppercase hex returns false (must be lowercase)", () => {
    expect(isValidKeyFormat("lsg_A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4")).toBe(
      false,
    );
  });

  test("non-hex characters return false", () => {
    expect(isValidKeyFormat("lsg_g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4")).toBe(
      false,
    );
  });

  test("empty string returns false", () => {
    expect(isValidKeyFormat("")).toBe(false);
  });

  test("just lsg_ with no suffix returns false", () => {
    expect(isValidKeyFormat("lsg_")).toBe(false);
  });
});
