// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Timeout checker for supervisor proposals and escalations.
 *
 * Expires:
 * - Pending proposals older than 86 400 seconds (24 hours).
 * - Open escalations older than their configured `timeout_seconds`.
 *
 * Items in other statuses (approved, rejected, acknowledged, resolved)
 * are never affected.
 *
 * Two execution modes (ADR-015):
 *
 * 1. **Vercel Functions (production):** `runTimeoutCheck()` is called directly
 *    from the `/api/internal/cron/timeout-checker` route handler (src/app.ts).
 *    Vercel Cron invokes that route every minute per vercel.json.
 *
 * 2. **Bun long-lived process (local dev, Mode 1):** `startTimeoutChecker()`
 *    wraps `runTimeoutCheck()` in a `setInterval` that fires every 60 seconds.
 *    Called from src/index.ts after the HTTP server starts.
 *
 * Spec reference: specs/task-briefs/v1.1-ai-supervisor.md, Task SUP-A6.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { supervisorEscalations, supervisorProposals } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Check interval in milliseconds (60 seconds). */
const CHECK_INTERVAL_MS = 60_000;

/** Proposals expire after this many seconds (24 hours). */
const PROPOSAL_TIMEOUT_SECONDS = 86_400;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TimeoutCheckResult {
  expiredProposals: number;
  expiredEscalations: number;
}

/**
 * Execute a single timeout check pass.
 *
 * Called directly from the Vercel Cron route handler (`src/app.ts`) and from
 * `startTimeoutChecker()` below.
 *
 * Errors are caught and logged — a failed check must not crash the caller.
 *
 * @returns Counts of expired proposals and escalations (both 0 on error).
 */
export async function runTimeoutCheck(): Promise<TimeoutCheckResult> {
  try {
    const [proposalCount, escalationCount] = await Promise.all([
      expireProposals(),
      expireEscalations(),
    ]);

    if (proposalCount > 0 || escalationCount > 0) {
      console.warn(
        `[timeout-checker] Expired ${proposalCount} proposal(s), ${escalationCount} escalation(s)`
      );
    }

    return { expiredProposals: proposalCount, expiredEscalations: escalationCount };
  } catch (err) {
    console.error(
      "[timeout-checker] Error during timeout check:",
      err instanceof Error ? err.message : String(err)
    );
    return { expiredProposals: 0, expiredEscalations: 0 };
  }
}

/**
 * Start the periodic timeout checker (Bun long-lived process mode only).
 *
 * Wraps `runTimeoutCheck()` in a setInterval. Used by `src/index.ts` for
 * local development and Mode 1 self-hosted deployments. NOT used on Vercel —
 * the cron route in src/app.ts handles that context.
 *
 * @returns An object with a `stop()` function to shut down the checker cleanly.
 */
export function startTimeoutChecker(): { stop: () => void } {
  // Run immediately on startup, then on interval
  void runTimeoutCheck();

  const intervalId = setInterval(() => {
    void runTimeoutCheck();
  }, CHECK_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(intervalId);
    },
  };
}

/**
 * Expire pending proposals that have exceeded their timeout.
 *
 * @returns The number of proposals expired.
 */
async function expireProposals(): Promise<number> {
  const cutoff = new Date(Date.now() - PROPOSAL_TIMEOUT_SECONDS * 1000);

  const result = await db
    .update(supervisorProposals)
    .set({
      status: "expired",
      updated_at: new Date(),
    })
    .where(
      and(eq(supervisorProposals.status, "pending"), lt(supervisorProposals.created_at, cutoff))
    )
    .returning({ id: supervisorProposals.id });

  return result.length;
}

/**
 * Expire open escalations that have exceeded their timeout_seconds.
 *
 * Each escalation has its own timeout_seconds value. If timeout_seconds
 * is null, the escalation never auto-expires (must be manually resolved).
 *
 * @returns The number of escalations expired.
 */
async function expireEscalations(): Promise<number> {
  // Use a SQL expression to compute the per-row expiry:
  // created_at + (timeout_seconds * interval '1 second') < NOW()
  const result = await db
    .update(supervisorEscalations)
    .set({
      status: "expired",
      updated_at: new Date(),
    })
    .where(
      and(
        eq(supervisorEscalations.status, "open"),
        // Only expire escalations that have a timeout configured
        sql`${supervisorEscalations.timeout_seconds} IS NOT NULL`,
        sql`${supervisorEscalations.created_at} + (${supervisorEscalations.timeout_seconds} * INTERVAL '1 second') < NOW()`
      )
    )
    .returning({ id: supervisorEscalations.id });

  return result.length;
}
