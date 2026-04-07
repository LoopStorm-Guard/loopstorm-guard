// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Periodic timeout checker for supervisor proposals and escalations.
 *
 * Runs every 60 seconds and expires:
 * - Pending proposals older than 86 400 seconds (24 hours).
 * - Open escalations older than their configured `timeout_seconds`.
 *
 * Items in other statuses (approved, rejected, acknowledged, resolved)
 * are never affected.
 *
 * Startup: called from the backend's main src/index.ts after the HTTP server starts.
 * Shutdown: returns a stop() function that clears the interval.
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
// Timeout checker
// ---------------------------------------------------------------------------

/**
 * Start the periodic timeout checker.
 *
 * @returns An object with a `stop()` function to shut down the checker cleanly.
 */
export function startTimeoutChecker(): { stop: () => void } {
  // Run immediately on startup, then on interval
  void runCheck();

  const intervalId = setInterval(() => {
    void runCheck();
  }, CHECK_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(intervalId);
    },
  };
}

/**
 * Execute a single timeout check pass.
 *
 * Errors are logged and swallowed — a failed check must not crash the server.
 */
async function runCheck(): Promise<void> {
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
  } catch (err) {
    console.error(
      "[timeout-checker] Error during timeout check:",
      err instanceof Error ? err.message : String(err)
    );
  }
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
