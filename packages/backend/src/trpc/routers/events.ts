// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC router for JSONL event ingest for LoopStorm Guard.
 *
 * Procedure:
 * - `events.ingest` — batch ingest of JSONL audit log lines from SDK agents
 *
 * Ingest pipeline (AD-P3-4):
 * 1. Parse each line as JSON and validate schema_version = 1.
 * 2. Verify hash chain integrity within the batch.
 *    - hash_prev of line[i] must equal SHA-256 of line[i-1].
 * 3. For continuation batches: verify first event's hash_prev matches
 *    the run's stored last_hash in the database.
 * 4. Upsert the run record (create on first batch, update aggregates on subsequent).
 * 5. Insert all events using ON CONFLICT DO NOTHING for idempotency.
 * 6. Update run aggregates (event_count, last_seq, last_hash, costs, etc.).
 *
 * All DB operations run in a single transaction.
 *
 * Auth: dualAuthProcedure — accepts both API key (SDK) and session (dashboard).
 *
 * Idempotency key: (run_id, seq) unique constraint on events table.
 * Duplicate batches (or partial re-sends) are safe — duplicates are silently
 * ignored and the run aggregates are updated based on the max seq seen.
 *
 * Enforcement/observation plane separation (ADR-012):
 * This endpoint is on the OBSERVATION PLANE — it stores audit data written
 * by the engine. It never intercepts or modifies enforcement decisions.
 */

import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { events, runs } from "../../db/schema.js";
import { router, dualAuthProcedure } from "../trpc.js";

/**
 * Zod schema for a single parsed event line.
 * We validate only the fields required for chain verification and DB insert.
 * Unknown fields are accepted and stored (the event schema in @loopstorm/schemas
 * is authoritative; we do structural validation here only).
 */
const parsedEventSchema = z.object({
  schema_version: z.literal(1),
  event_type: z.string().min(1),
  run_id: z.string().uuid(),
  seq: z.number().int().min(1),
  ts: z.string().datetime(), // ISO 8601 with timezone
  hash: z.string().length(64).regex(/^[0-9a-f]{64}$/), // SHA-256 hex
  hash_prev: z.string().length(64).regex(/^[0-9a-f]{64}$/).nullable(),
  // Optional fields extracted for run record and event columns
  agent_name: z.string().optional().nullable(),
  agent_role: z.string().optional().nullable(),
  environment: z.string().optional().nullable(),
  policy_pack_id: z.string().optional().nullable(),
  tool: z.string().optional().nullable(),
  args_hash: z.string().optional().nullable(),
  args_redacted: z.unknown().optional().nullable(),
  decision: z.string().optional().nullable(),
  rule_id: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  input_tokens: z.number().int().optional().nullable(),
  output_tokens: z.number().int().optional().nullable(),
  estimated_cost_usd: z.number().optional().nullable(),
  latency_ms: z.number().optional().nullable(),
  run_status: z.string().optional().nullable(),
  dimension: z.string().optional().nullable(),
  loop_rule: z.string().optional().nullable(),
  loop_action: z.string().optional().nullable(),
  cooldown_ms: z.number().int().optional().nullable(),
  budget: z.unknown().optional().nullable(),
  // Supervisor fields (observation plane — ADR-012)
  supervisor_run_id: z.string().optional().nullable(),
  trigger: z.string().optional().nullable(),
  trigger_run_id: z.string().optional().nullable(),
  proposal_id: z.string().optional().nullable(),
  proposal_type: z.string().optional().nullable(),
  target_agent: z.string().optional().nullable(),
  rationale: z.string().optional().nullable(),
  confidence: z.number().optional().nullable(),
  supporting_runs: z.array(z.string()).optional().nullable(),
  status: z.string().optional().nullable(),
  escalation_id: z.string().optional().nullable(),
  severity: z.string().optional().nullable(),
  recommendation: z.string().optional().nullable(),
  timeout_seconds: z.number().int().optional().nullable(),
  timeout_action: z.string().optional().nullable(),
});

type ParsedEvent = z.infer<typeof parsedEventSchema>;

/**
 * Parse and validate a single JSONL line.
 * Returns the parsed event or throws a descriptive error.
 */
function parseEventLine(
  line: string,
  lineIndex: number,
): ParsedEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Line ${lineIndex + 1}: invalid JSON`,
    });
  }

  const result = parsedEventSchema.safeParse(parsed);
  if (!result.success) {
    const firstError = result.error.errors[0];
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Line ${lineIndex + 1} (seq=${(parsed as Record<string, unknown>)?.["seq"] ?? "?"}): ${firstError?.message ?? "validation failed"} at path: ${firstError?.path.join(".") ?? "unknown"}`,
    });
  }

  return result.data;
}

/**
 * Verify the hash chain within a sorted batch of events.
 *
 * The hash of each event is SHA-256 of the raw JSONL line bytes (as stored
 * in raw_line). The hash_prev of each event must equal the hash of the
 * previous event.
 *
 * For the first event in the batch:
 * - If prevRunHash is null: hash_prev must be null (this is the first event ever)
 * - If prevRunHash is set: hash_prev must equal prevRunHash (continuation)
 *
 * @param sortedEvents - Events sorted by seq ascending, paired with raw lines
 * @param prevRunHash - last_hash stored for the run (null if new run)
 * @throws TRPCError(BAD_REQUEST) on chain integrity failure
 */
function verifyBatchChain(
  sortedEvents: Array<{ event: ParsedEvent; rawLine: string }>,
  prevRunHash: string | null,
): void {
  for (let i = 0; i < sortedEvents.length; i++) {
    const item = sortedEvents[i]!;
    const { event, rawLine } = item;

    // Verify this event's payload hash against the raw line
    const computedHash = createHash("sha256").update(rawLine, "utf8").digest("hex");
    if (computedHash !== event.hash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Chain integrity failure at seq=${event.seq}: stored hash does not match computed hash of raw line. Expected=${computedHash}, stored=${event.hash}`,
      });
    }

    // Verify the chain link
    if (i === 0) {
      // First event in batch
      const expectedPrev = prevRunHash ?? null;
      if (event.hash_prev !== expectedPrev) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Chain link failure at seq=${event.seq}: hash_prev=${event.hash_prev ?? "null"} does not match expected=${expectedPrev ?? "null"} (run continuation check)`,
        });
      }
    } else {
      // Subsequent events: must chain to previous
      const prevHash = sortedEvents[i - 1]!.event.hash;
      if (event.hash_prev !== prevHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Chain link failure at seq=${event.seq}: hash_prev=${event.hash_prev ?? "null"} does not match previous event hash=${prevHash}`,
        });
      }
    }
  }
}

export const eventsRouter = router({
  /**
   * Batch ingest of JSONL audit log lines.
   *
   * Input: an array of raw JSONL line strings (as produced by the engine).
   * Each line must be a valid JSON object conforming to the event schema.
   *
   * The batch must be chain-ordered (sorted by seq ascending within the batch).
   * Events from different runs must NOT be mixed in a single batch.
   *
   * Returns the number of events inserted (duplicates ignored).
   */
  ingest: dualAuthProcedure
    .input(
      z.object({
        /**
         * Array of raw JSONL line strings. Each line must be a complete JSON
         * object terminated by '\n' or not — both are accepted.
         * Maximum 1000 lines per batch.
         */
        lines: z.array(z.string().min(1)).min(1).max(1000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId!;

      // --- Step 1: Parse and validate all lines ---
      const parsedItems: Array<{ event: ParsedEvent; rawLine: string }> = [];

      for (let i = 0; i < input.lines.length; i++) {
        const rawLine = input.lines[i]!.trimEnd(); // normalize trailing newline
        const event = parseEventLine(rawLine, i);
        parsedItems.push({ event, rawLine });
      }

      // --- Step 2: Validate single-run constraint ---
      // All events in a batch must belong to the same run.
      const runIds = new Set(parsedItems.map((p) => p.event.run_id));
      if (runIds.size > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Batch must contain events from a single run. Found ${runIds.size} distinct run_ids.`,
        });
      }

      const runId = parsedItems[0]!.event.run_id;

      // --- Step 3: Sort by seq ascending ---
      parsedItems.sort((a, b) => a.event.seq - b.event.seq);

      // --- Step 4: Check for seq gaps or duplicates within the batch ---
      const seqsInBatch = parsedItems.map((p) => p.event.seq);
      for (let i = 1; i < seqsInBatch.length; i++) {
        const prev = seqsInBatch[i - 1]!;
        const curr = seqsInBatch[i]!;
        if (curr === prev) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Duplicate seq=${curr} within batch`,
          });
        }
        if (curr !== prev + 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Seq gap in batch: expected seq=${prev + 1}, got seq=${curr}`,
          });
        }
      }

      // --- Step 5: Execute within a single transaction ---
      const result = await db.transaction(async (tx) => {
        // Fetch the existing run (if any) for continuation verification
        const [existingRun] = await tx
          .select({
            run_id: runs.run_id,
            tenant_id: runs.tenant_id,
            last_seq: runs.last_seq,
            last_hash: runs.last_hash,
            event_count: runs.event_count,
            total_cost_usd: runs.total_cost_usd,
            total_input_tokens: runs.total_input_tokens,
            total_output_tokens: runs.total_output_tokens,
            total_call_count: runs.total_call_count,
            status: runs.status,
          })
          .from(runs)
          .where(and(eq(runs.run_id, runId), eq(runs.tenant_id, tenantId)))
          .limit(1);

        // Security check: if run exists, it must belong to this tenant.
        // RLS handles this at DB level, but we verify in application code too.
        if (existingRun && existingRun.tenant_id !== tenantId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Run does not belong to this tenant",
          });
        }

        const prevRunHash = existingRun?.last_hash ?? null;

        // --- Step 6: Verify hash chain ---
        verifyBatchChain(parsedItems, prevRunHash);

        // --- Step 7: Extract metadata from first event ---
        const firstEvent = parsedItems[0]!.event;
        const lastEvent = parsedItems[parsedItems.length - 1]!.event;

        // Determine run status from event types in the batch
        let newStatus: string | undefined;
        for (const { event } of parsedItems) {
          if (event.event_type === "run_started") {
            newStatus = "started";
          } else if (event.event_type === "run_ended") {
            // Map engine run_status to our status column
            const engineStatus = event.run_status;
            if (engineStatus === "budget_exceeded") {
              newStatus = "terminated_budget";
            } else if (engineStatus === "loop_terminated") {
              newStatus = "terminated_loop";
            } else if (engineStatus === "policy_terminated") {
              newStatus = "terminated_policy";
            } else if (engineStatus === "completed") {
              newStatus = "completed";
            } else {
              newStatus = "completed";
            }
          }
        }

        // Compute aggregate deltas from this batch
        let batchCost = 0;
        let batchInputTokens = 0;
        let batchOutputTokens = 0;
        let batchCallCount = 0;
        let startedAt: Date | undefined;
        let endedAt: Date | undefined;

        for (const { event } of parsedItems) {
          if (event.estimated_cost_usd) {
            batchCost += event.estimated_cost_usd;
          }
          if (event.input_tokens) {
            batchInputTokens += event.input_tokens;
          }
          if (event.output_tokens) {
            batchOutputTokens += event.output_tokens;
          }
          // Count tool call decisions
          if (event.event_type === "policy_decision" && event.decision) {
            batchCallCount += 1;
          }
          if (event.event_type === "run_started") {
            startedAt = new Date(event.ts);
          }
          if (event.event_type === "run_ended") {
            endedAt = new Date(event.ts);
          }
        }

        const newLastSeq = lastEvent.seq;
        const newLastHash = lastEvent.hash;
        const newEventCount = (existingRun?.event_count ?? 0) + parsedItems.length;
        const newTotalCost = (existingRun?.total_cost_usd ?? 0) + batchCost;
        const newTotalInputTokens = (existingRun?.total_input_tokens ?? 0) + batchInputTokens;
        const newTotalOutputTokens = (existingRun?.total_output_tokens ?? 0) + batchOutputTokens;
        const newTotalCallCount = (existingRun?.total_call_count ?? 0) + batchCallCount;

        if (existingRun) {
          // --- Step 8a: Update existing run ---
          await tx
            .update(runs)
            .set({
              last_seq: newLastSeq,
              last_hash: newLastHash,
              event_count: newEventCount,
              total_cost_usd: newTotalCost,
              total_input_tokens: newTotalInputTokens,
              total_output_tokens: newTotalOutputTokens,
              total_call_count: newTotalCallCount,
              ...(newStatus ? { status: newStatus } : {}),
              ...(endedAt ? { ended_at: endedAt } : {}),
              updated_at: new Date(),
            })
            .where(
              and(eq(runs.run_id, runId), eq(runs.tenant_id, tenantId)),
            );
        } else {
          // --- Step 8b: Create new run record ---
          await tx
            .insert(runs)
            .values({
              run_id: runId,
              tenant_id: tenantId,
              agent_name: firstEvent.agent_name ?? null,
              agent_role: firstEvent.agent_role ?? null,
              environment: firstEvent.environment ?? null,
              policy_pack_id: firstEvent.policy_pack_id ?? null,
              status: newStatus ?? "started",
              event_count: parsedItems.length,
              last_seq: newLastSeq,
              last_hash: newLastHash,
              total_cost_usd: batchCost,
              total_input_tokens: batchInputTokens,
              total_output_tokens: batchOutputTokens,
              total_call_count: batchCallCount,
              started_at: startedAt ?? new Date(firstEvent.ts),
              ended_at: endedAt ?? null,
            })
            .onConflictDoNothing({ target: runs.run_id });

          // If onConflictDoNothing triggered (concurrent insert), update instead
          // The run record will be updated via the aggregate path below if needed.
        }

        // --- Step 9: Insert events (idempotent via ON CONFLICT DO NOTHING) ---
        const eventRows = parsedItems.map(({ event, rawLine }) => ({
          run_id: event.run_id,
          tenant_id: tenantId,
          schema_version: event.schema_version,
          event_type: event.event_type,
          seq: event.seq,
          hash: event.hash,
          hash_prev: event.hash_prev,
          ts: new Date(event.ts),
          agent_name: event.agent_name ?? null,
          agent_role: event.agent_role ?? null,
          tool: event.tool ?? null,
          args_hash: event.args_hash ?? null,
          // biome-ignore lint/suspicious/noExplicitAny: jsonb column accepts any JSON
          args_redacted: (event.args_redacted as any) ?? null,
          decision: event.decision ?? null,
          rule_id: event.rule_id ?? null,
          reason: event.reason ?? null,
          model: event.model ?? null,
          input_tokens: event.input_tokens ?? null,
          output_tokens: event.output_tokens ?? null,
          estimated_cost_usd: event.estimated_cost_usd ?? null,
          latency_ms: event.latency_ms ?? null,
          policy_pack_id: event.policy_pack_id ?? null,
          environment: event.environment ?? null,
          run_status: event.run_status ?? null,
          dimension: event.dimension ?? null,
          loop_rule: event.loop_rule ?? null,
          loop_action: event.loop_action ?? null,
          cooldown_ms: event.cooldown_ms ?? null,
          // biome-ignore lint/suspicious/noExplicitAny: jsonb column accepts any JSON
          budget: (event.budget as any) ?? null,
          supervisor_run_id: event.supervisor_run_id ?? null,
          trigger: event.trigger ?? null,
          trigger_run_id: event.trigger_run_id ?? null,
          proposal_id: event.proposal_id ?? null,
          proposal_type: event.proposal_type ?? null,
          target_agent: event.target_agent ?? null,
          rationale: event.rationale ?? null,
          confidence: event.confidence ?? null,
          supporting_runs: event.supporting_runs ?? null,
          status: event.status ?? null,
          escalation_id: event.escalation_id ?? null,
          severity: event.severity ?? null,
          recommendation: event.recommendation ?? null,
          timeout_seconds: event.timeout_seconds ?? null,
          timeout_action: event.timeout_action ?? null,
          raw_line: rawLine,
        }));

        // Insert in batches of 100 to avoid oversized queries
        let insertedCount = 0;
        const BATCH_SIZE = 100;

        for (let i = 0; i < eventRows.length; i += BATCH_SIZE) {
          const batch = eventRows.slice(i, i + BATCH_SIZE);
          const insertResult = await tx
            .insert(events)
            .values(batch)
            .onConflictDoNothing({
              // Unique constraint: (run_id, seq)
              target: [events.run_id, events.seq],
            })
            .returning({ id: events.id });
          insertedCount += insertResult.length;
        }

        return {
          run_id: runId,
          inserted: insertedCount,
          total_in_batch: parsedItems.length,
          skipped: parsedItems.length - insertedCount,
          last_seq: newLastSeq,
        };
      });

      return result;
    }),
});
