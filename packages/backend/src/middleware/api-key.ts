// SPDX-License-Identifier: AGPL-3.0-only
/**
 * API key authentication middleware for LoopStorm Guard.
 *
 * SDK instances (engine, shims, CLI) authenticate to the ingest endpoint
 * using API keys in the `Authorization: Bearer <key>` header (AD-P3-3).
 *
 * Security properties:
 * - Raw keys are NEVER stored in the database.
 * - Only the SHA-256 hex digest is stored (`key_hash` column).
 * - The incoming key is hashed and compared against stored hashes.
 * - Hash comparison uses timing-safe equality to prevent timing attacks.
 * - Revoked and expired keys are rejected.
 * - `last_used_at` is updated asynchronously (fire-and-forget) so it does
 *   not add latency to the authentication hot path.
 *
 * This function returns `null` for any authentication failure rather than
 * throwing. The caller is responsible for returning a 401 response. This
 * design keeps the auth logic testable without setting up error boundaries.
 */

import { timingSafeEqual, createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema.js";

/**
 * Result of a successful API key authentication.
 */
export interface ApiKeyAuthResult {
  tenant_id: string;
  api_key_id: string;
  scopes: string[];
}

/**
 * Authenticate a request using its `Authorization: Bearer` header.
 *
 * @param authHeader - The raw Authorization header value, or null/undefined
 * @returns Authentication result if valid, or null if authentication fails
 */
export async function authenticateApiKey(
  authHeader: string | null | undefined,
): Promise<ApiKeyAuthResult | null> {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey) {
    return null;
  }

  // Compute SHA-256 of the incoming key for hash comparison.
  const incomingHash = createHash("sha256").update(rawKey).digest("hex");

  // Fetch all non-revoked keys and compare hashes in constant time.
  // We cannot query by hash directly here because timing-safe comparison
  // must be done in application code. However, to avoid a full table scan,
  // we use the key_prefix (first 8 chars) to narrow the lookup.
  //
  // The key_prefix is NOT secret — it is shown in the UI for identification.
  // An attacker who knows the prefix still cannot authenticate without the
  // full key because the hash comparison will fail.
  const prefix = rawKey.slice(0, 8);

  const candidates = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.key_prefix, prefix), eq(apiKeys.is_revoked, false)))
    .limit(5); // at most 5 keys with the same prefix per tenant (safety limit)

  let matchedKey: (typeof candidates)[number] | undefined;

  for (const candidate of candidates) {
    // Timing-safe comparison to prevent timing attacks on key discovery.
    // Both buffers must be the same length (both are 64-char hex strings).
    const storedHashBuf = Buffer.from(candidate.key_hash, "utf8");
    const incomingHashBuf = Buffer.from(incomingHash, "utf8");

    if (
      storedHashBuf.length === incomingHashBuf.length &&
      timingSafeEqual(storedHashBuf, incomingHashBuf)
    ) {
      matchedKey = candidate;
      break;
    }
  }

  if (!matchedKey) {
    return null;
  }

  // Check expiry
  if (matchedKey.expires_at !== null && matchedKey.expires_at < new Date()) {
    return null;
  }

  // Update last_used_at asynchronously — non-critical, fire and forget.
  // We intentionally swallow errors here; a failure to update last_used_at
  // must never cause an authenticated request to fail.
  void db
    .update(apiKeys)
    .set({ last_used_at: new Date() })
    .where(eq(apiKeys.id, matchedKey.id))
    .execute()
    .catch(() => {
      // Non-critical — log in production but never throw
    });

  return {
    tenant_id: matchedKey.tenant_id,
    api_key_id: matchedKey.id,
    scopes: matchedKey.scopes ?? [],
  };
}
