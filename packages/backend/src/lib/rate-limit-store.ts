// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Postgres-backed fixed-window rate-limit store (ADR-022 AC-22-10).
 *
 * Usage:
 *   const res = await incrementBucket("email:forget-password:ip:1.2.3.4", 3600, 5);
 *   if (!res.allowed) return json({ error: "rate_limited" }, 429);
 *
 * Contract:
 *   - Uses the service-scoped Drizzle client (not the per-request RLS client).
 *     The bucket table has a deny-all RLS policy; only the service role bypass
 *     can read/write.
 *   - Atomic via `INSERT … ON CONFLICT (key, window_start) DO UPDATE SET
 *     count = count + 1 RETURNING count`.
 *   - Fixed window: `window_start` is `date_trunc`-style floored to the window
 *     size, so concurrent requests within the window collapse onto the same row.
 *   - Fail-closed: any DB error returns `{ allowed: false }` with a full-window
 *     retryAfter. The caller decides whether to surface the 429 or fall through
 *     (email endpoints always fail closed; ADR-022 §Security Considerations).
 */

import { sql } from "../db/client.js";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfter: number;
}

/**
 * Increment the bucket keyed by `key` for the current fixed window of size
 * `windowSec` seconds. Returns `allowed: false` when the post-increment count
 * exceeds `limit`.
 */
export async function incrementBucket(
  key: string,
  windowSec: number,
  limit: number
): Promise<RateLimitResult> {
  // Floor the current epoch to the nearest window boundary. All writes within
  // the window land on the same composite PK row.
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStartSec = nowSec - (nowSec % windowSec);
  const windowStart = new Date(windowStartSec * 1000);

  try {
    const rows = await sql<{ count: number }[]>`
      INSERT INTO rate_limit_buckets (key, window_start, count)
      VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = rate_limit_buckets.count + 1
      RETURNING count
    `;
    const count = rows[0]?.count ?? limit + 1;
    const retryAfter = Math.max(1, windowSec - (nowSec - windowStartSec));
    return { allowed: count <= limit, count, retryAfter };
  } catch (err) {
    console.error("[rate-limit] bucket store error — failing closed:", err);
    return { allowed: false, count: limit + 1, retryAfter: windowSec };
  }
}

/**
 * SHA-256 hex of a string, used to key per-email buckets without storing the
 * plaintext email address in the bucket table.
 */
export async function hashEmailKey(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
