// SPDX-License-Identifier: AGPL-3.0-only
/**
 * API key generation and hashing utilities for LoopStorm Guard.
 *
 * Key format: `lsg_` + 32 lowercase hex characters = 36 characters total.
 * Example:   `lsg_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4`
 *
 * The 32 hex chars encode 16 bytes of cryptographically random data,
 * giving 128 bits of entropy — sufficient for a Bearer token.
 *
 * Storage:
 * - `key_hash`   — SHA-256 hex digest of the FULL raw key (stored in DB)
 * - `key_prefix` — First 8 characters (e.g., `lsg_a1b2`) shown in UI only
 * - Raw key      — Returned to the user EXACTLY ONCE. Never stored.
 *
 * Security note: SHA-256 without a salt is acceptable here because the keys
 * have 128 bits of entropy, making rainbow tables infeasible. PBKDF2/bcrypt
 * would add unnecessary latency to the ingest hot path (which hashes the
 * incoming key on every request).
 */

import { createHash, randomBytes } from "crypto";

/** Key prefix used to identify LoopStorm Guard API keys. */
const KEY_PREFIX = "lsg_";

/** Number of random bytes to generate (produces 32 hex chars). */
const KEY_RANDOM_BYTES = 16;

/**
 * Result of generating a new API key.
 */
export interface GeneratedApiKey {
  /** The full raw key, e.g. `lsg_a1b2c3d4...`. Return to user ONCE. */
  rawKey: string;
  /** SHA-256 hex digest of `rawKey`. Store in `api_keys.key_hash`. */
  keyHash: string;
  /** First 8 characters of `rawKey`. Store in `api_keys.key_prefix`. */
  keyPrefix: string;
}

/**
 * Generate a new API key with its hash and prefix.
 *
 * @returns Generated key components. The `rawKey` must be returned to the
 *   user immediately and then discarded — it is NEVER stored.
 */
export function generateApiKey(): GeneratedApiKey {
  const randomHex = randomBytes(KEY_RANDOM_BYTES).toString("hex");
  const rawKey = `${KEY_PREFIX}${randomHex}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8);

  return { rawKey, keyHash, keyPrefix };
}

/**
 * Compute the SHA-256 hex digest of a raw API key.
 *
 * Used both at key creation time and on each ingest request to verify the
 * incoming Bearer token against the stored hash.
 *
 * @param rawKey - The full raw API key string
 * @returns 64-character lowercase hex SHA-256 digest
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/**
 * Extract the key prefix (first 8 characters) from a raw API key.
 *
 * The prefix is used to narrow the hash lookup to a small set of candidates
 * before performing the timing-safe comparison in the auth middleware.
 *
 * @param rawKey - The full raw API key string
 * @returns First 8 characters of the key
 */
export function extractKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 8);
}

/**
 * Validate that a string looks like a LoopStorm Guard API key.
 *
 * This is a syntactic check only — it does not verify the key against the
 * database. Use it to provide better error messages to callers who send
 * malformed keys.
 *
 * @param key - The key string to validate
 * @returns true if the key has the correct format
 */
export function isValidKeyFormat(key: string): boolean {
  // lsg_ + exactly 32 hex chars = 36 chars total
  return /^lsg_[0-9a-f]{32}$/.test(key);
}
