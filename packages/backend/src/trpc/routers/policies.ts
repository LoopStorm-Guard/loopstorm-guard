// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC router for policy pack management in LoopStorm Guard.
 *
 * Procedures:
 * - `policies.list`   — list policy packs for the current tenant
 * - `policies.get`    — get a single policy pack by id
 * - `policies.create` — create a new policy pack (validates content)
 * - `policies.update` — update a policy pack with optimistic concurrency
 *
 * Policy pack content is validated against `policy.schema.json` (via
 * `validatePolicy` from lib/policy-validate.ts) before any write.
 *
 * The `escalate_to_human` invariant (ADR-012, C13) is enforced in
 * `validatePolicy` — no policy rule may block that tool.
 *
 * Optimistic concurrency for `policies.update`:
 * - The client sends the current `version` number it read.
 * - The server checks that the stored version matches.
 * - If matched, the update proceeds and increments `version`.
 * - If not matched, the update fails with CONFLICT.
 * This prevents lost updates when two dashboard users edit the same policy.
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { policyPacks } from "../../db/schema.js";
import { validatePolicy } from "../../lib/policy-validate.js";
import { protectedProcedure, router } from "../trpc.js";

/**
 * Zod schema for policy pack content (loose validation — the strict
 * validation is done by validatePolicy() using the canonical schema).
 * We accept any JSON object here and let validatePolicy() produce errors.
 */
const policyContentSchema = z.record(z.unknown());

export const policiesRouter = router({
  /**
   * List policy packs for the current tenant.
   *
   * Returns active and inactive packs. Ordered by created_at DESC.
   * Cursor-based pagination on created_at.
   */
  list: protectedProcedure
    .input(
      z.object({
        cursor: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        /** Filter to active packs only. Default false (return all). */
        active_only: z.boolean().default(false),
      }),
    )
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      const conditions = [eq(policyPacks.tenant_id, tenantId)];

      if (input.cursor) {
        conditions.push(lt(policyPacks.created_at, new Date(input.cursor)));
      }

      if (input.active_only) {
        conditions.push(eq(policyPacks.is_active, true));
      }

      const rows = await db
        .select({
          id: policyPacks.id,
          tenant_id: policyPacks.tenant_id,
          name: policyPacks.name,
          description: policyPacks.description,
          agent_role: policyPacks.agent_role,
          environment: policyPacks.environment,
          schema_version: policyPacks.schema_version,
          is_active: policyPacks.is_active,
          version: policyPacks.version,
          created_by: policyPacks.created_by,
          created_at: policyPacks.created_at,
          updated_at: policyPacks.updated_at,
          // content is excluded from list — it can be large.
          // Use policies.get to retrieve the full content.
        })
        .from(policyPacks)
        .where(and(...conditions))
        .orderBy(desc(policyPacks.created_at))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const lastItem = items[items.length - 1];
      const nextCursor =
        hasMore && lastItem ? lastItem.created_at.toISOString() : null;

      return { items, nextCursor };
    }),

  /**
   * Get a single policy pack by id, including its content.
   *
   * Returns null if the policy pack does not exist or does not belong
   * to the current tenant (cross-tenant isolation — not a 404 error).
   */
  get: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      const [row] = await db
        .select()
        .from(policyPacks)
        .where(
          and(
            eq(policyPacks.id, input.id),
            eq(policyPacks.tenant_id, tenantId),
          ),
        )
        .limit(1);

      return row ?? null;
    }),

  /**
   * Create a new policy pack.
   *
   * The content is validated against the canonical policy schema before insert.
   * Returns a structured validation error if the policy is invalid.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().max(1000).optional(),
        /** Target agent role this policy applies to. Optional. */
        agent_role: z.string().max(255).optional(),
        /** Environment this policy applies to (e.g. "production"). Optional. */
        environment: z.string().max(255).optional(),
        /** The policy pack content as a JSON object. Must conform to policy schema. */
        content: policyContentSchema,
        /** Whether to activate this policy immediately. Default true. */
        is_active: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";
      const userId = ctx.userId ?? "";

      // Validate policy content before insert
      const validation = validatePolicy(input.content);
      if (!validation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Policy content validation failed",
          cause: validation.errors,
        });
      }

      const [created] = await db
        .insert(policyPacks)
        .values({
          tenant_id: tenantId,
          name: input.name,
          description: input.description ?? null,
          agent_role: input.agent_role ?? null,
          environment: input.environment ?? null,
          // biome-ignore lint/suspicious/noExplicitAny: jsonb column accepts any JSON
          content: input.content as any,
          schema_version: 1,
          is_active: input.is_active,
          version: 1,
          created_by: userId,
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create policy pack",
        });
      }

      return created;
    }),

  /**
   * Update a policy pack with optimistic concurrency control.
   *
   * The client must send the `version` it last read. The server checks that
   * the stored version matches before applying the update. If another user
   * has already modified the policy (version mismatch), returns CONFLICT.
   *
   * On success, increments the `version` counter.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        /**
         * The version the client read. Must match the stored version.
         * If not, the update is rejected with CONFLICT.
         */
        version: z.number().int().min(1),
        // All update fields are optional — only provided fields are updated
        name: z.string().min(1).max(255).optional(),
        description: z.string().max(1000).nullable().optional(),
        agent_role: z.string().max(255).nullable().optional(),
        environment: z.string().max(255).nullable().optional(),
        content: policyContentSchema.optional(),
        is_active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      // Fetch the current record to check version and tenant
      const [existing] = await db
        .select({
          id: policyPacks.id,
          version: policyPacks.version,
          tenant_id: policyPacks.tenant_id,
        })
        .from(policyPacks)
        .where(
          and(
            eq(policyPacks.id, input.id),
            eq(policyPacks.tenant_id, tenantId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy pack not found",
        });
      }

      // Optimistic concurrency check
      if (existing.version !== input.version) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Policy pack has been modified by another user. Your version: ${input.version}, current version: ${existing.version}. Re-fetch and retry.`,
        });
      }

      // If content is being updated, validate it
      if (input.content !== undefined) {
        const validation = validatePolicy(input.content);
        if (!validation.valid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Policy content validation failed",
            cause: validation.errors,
          });
        }
      }

      // Build the update set — only include provided fields
      const updateSet: Record<string, unknown> = {
        version: existing.version + 1,
        updated_at: new Date(),
      };

      if (input.name !== undefined) updateSet["name"] = input.name;
      if (input.description !== undefined) updateSet["description"] = input.description;
      if (input.agent_role !== undefined) updateSet["agent_role"] = input.agent_role;
      if (input.environment !== undefined) updateSet["environment"] = input.environment;
      if (input.content !== undefined) updateSet["content"] = input.content;
      if (input.is_active !== undefined) updateSet["is_active"] = input.is_active;

      const [updated] = await db
        .update(policyPacks)
        // biome-ignore lint/suspicious/noExplicitAny: dynamic update set
        .set(updateSet as any)
        .where(
          and(
            eq(policyPacks.id, input.id),
            eq(policyPacks.tenant_id, tenantId),
            // Double-check version in WHERE to prevent lost updates under
            // concurrent requests (even though we checked above — TOCTOU defense)
            eq(policyPacks.version, input.version),
          ),
        )
        .returning();

      if (!updated) {
        // The version check in WHERE failed — another concurrent update won
        throw new TRPCError({
          code: "CONFLICT",
          message: "Policy pack was modified concurrently. Please re-fetch and retry.",
        });
      }

      return updated;
    }),
});
