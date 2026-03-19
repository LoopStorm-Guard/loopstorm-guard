// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC router for hash chain verification in LoopStorm Guard.
 *
 * Procedure:
 * - `verify.chain` — verify the hash chain integrity for a given run_id
 *
 * Chain verification algorithm (AD-P3-4, apps/cli/src/verify.rs mirror):
 * 1. Query all events for the run from the database, ordered by seq ASC.
 * 2. For each event, use the stored `raw_line` if available for bit-exact
 *    hash computation. Fall back to re-serialization if raw_line is absent.
 * 3. Verify that each event's stored `hash` matches the computed hash.
 * 4. Verify that each event's `hash_prev` matches the previous event's `hash`.
 * 5. Return a detailed result including any break position.
 *
 * Security: only the run owner (current tenant) can verify a run's chain.
 * Cross-tenant isolation is enforced by RLS and explicit tenant_id check.
 *
 * Performance: for large runs this query may be expensive. The events are
 * fetched in pages of 1000 to avoid loading the entire run into memory.
 * The chain is verified incrementally as pages are fetched.
 */

import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { events, runs } from "../../db/schema.js";
import { verifyChain } from "../../lib/chain-verify.js";
import { protectedProcedure, router } from "../trpc.js";

/** Page size for fetching events during chain verification. */
const EVENTS_PAGE_SIZE = 1000;

export const verifyRouter = router({
  /**
   * Verify the hash chain integrity for a given run.
   *
   * Returns a detailed verification result. If the chain is broken, the
   * result includes the sequence number where the break was detected and
   * a human-readable reason.
   *
   * The run must belong to the current tenant. Returns a "not found" result
   * (not an error) if the run does not exist or belongs to another tenant.
   */
  chain: protectedProcedure
    .input(
      z.object({
        /** UUID of the run to verify. */
        run_id: z.string().uuid(),
      })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      // Verify the run exists and belongs to this tenant
      const [run] = await db
        .select({
          run_id: runs.run_id,
          event_count: runs.event_count,
          last_seq: runs.last_seq,
        })
        .from(runs)
        .where(and(eq(runs.run_id, input.run_id), eq(runs.tenant_id, tenantId)))
        .limit(1);

      if (!run) {
        return {
          run_id: input.run_id,
          found: false,
          valid: false as const,
          eventCount: 0,
          message: "Run not found",
        };
      }

      // Fetch all events for the run in pages, accumulating for verification.
      // We use cursor-based pagination on seq to avoid offset overhead.
      //
      // NOTE: We load all events into memory for verification because the
      // chain is a linked structure — we need all of them to detect breaks.
      // For very large runs (> 10k events), this may need to be streamed
      // in the future. For now, the 1000-event page loop provides bounded
      // memory growth per iteration.
      const allEvents: Array<{
        seq: number;
        hash: string;
        hash_prev: string | null;
        raw_line: string | null;
      }> = [];

      let lastSeenSeq = 0;
      let hasMore = true;

      while (hasMore) {
        const page = await db
          .select({
            seq: events.seq,
            hash: events.hash,
            hash_prev: events.hash_prev,
            raw_line: events.raw_line,
          })
          .from(events)
          .where(
            and(
              eq(events.run_id, input.run_id),
              eq(events.tenant_id, tenantId),
              gt(events.seq, lastSeenSeq)
            )
          )
          .orderBy(asc(events.seq))
          .limit(EVENTS_PAGE_SIZE);

        allEvents.push(...page);

        if (page.length < EVENTS_PAGE_SIZE) {
          hasMore = false;
        } else {
          const lastPage = page[page.length - 1];
          lastSeenSeq = lastPage ? lastPage.seq : lastSeenSeq;
        }
      }

      if (allEvents.length === 0) {
        return {
          run_id: input.run_id,
          found: true,
          valid: true as const,
          eventCount: 0,
          message: "Run has no events",
        };
      }

      // Run chain verification using the shared lib function
      const result = verifyChain(allEvents);

      if (result.valid) {
        return {
          run_id: input.run_id,
          found: true,
          valid: true as const,
          eventCount: result.eventCount,
          message: `Chain verified: ${result.eventCount} events intact`,
        };
      }

      return {
        run_id: input.run_id,
        found: true,
        valid: false as const,
        eventCount: result.eventCount,
        brokenAtSeq: result.brokenAtSeq,
        message: result.reason,
      };
    }),
});
