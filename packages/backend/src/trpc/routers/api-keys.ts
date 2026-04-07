// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC router for API key management.
 *
 * Procedures:
 * - `apiKeys.create` — generate a new API key, return the raw key ONCE
 * - `apiKeys.list`   — list API keys for the current tenant (NEVER returns key_hash)
 * - `apiKeys.revoke` — mark an API key as revoked
 *
 * Security invariants:
 * - `key_hash` is NEVER returned in any response.
 * - The raw key is returned ONLY from `apiKeys.create`, in a one-time response.
 * - All procedures are tenant-scoped via RLS + application-level checks.
 * - Revoke checks that the key belongs to the current tenant before updating.
 *
 * Pagination: `apiKeys.list` uses cursor-based pagination on the `id` UUID
 * field (UUID v4, random — not time-ordered). For the small expected number
 * of API keys per tenant (< 100), this is adequate.
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { apiKeys } from "../../db/schema.js";
import { generateApiKey } from "../../lib/api-key-gen.js";
import { protectedProcedure, router } from "../trpc.js";

export const apiKeysRouter = router({
  /**
   * Create a new API key for the current tenant.
   *
   * Returns the raw key ONCE in the `key` field. After this response,
   * the raw key is gone forever — not stored anywhere.
   *
   * The caller (web dashboard) must display and ask the user to copy
   * the key before the response is dismissed.
   */
  create: protectedProcedure
    .input(
      z.object({
        /** Human-readable label, e.g. "prod-agent-1" */
        name: z.string().min(1).max(255),
        /** Required scopes. Must include "ingest" for SDK usage. */
        scopes: z.array(z.enum(["ingest", "read", "supervisor"])).min(1),
        /**
         * Number of days until expiry. Omit for no expiry.
         * Range: 1–365 days.
         */
        expires_in_days: z.number().int().min(1).max(365).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // ctx.tenantId and ctx.userId are guaranteed non-null by protectedProcedure
      const tenantId = ctx.tenantId ?? "";
      const userId = ctx.userId ?? "";

      const { rawKey, keyHash, keyPrefix } = generateApiKey();

      const expiresAt = input.expires_in_days
        ? new Date(Date.now() + input.expires_in_days * 24 * 60 * 60 * 1000)
        : null;

      const [created] = await db
        .insert(apiKeys)
        .values({
          tenant_id: tenantId,
          user_id: userId,
          name: input.name,
          key_prefix: keyPrefix,
          key_hash: keyHash,
          scopes: input.scopes,
          expires_at: expiresAt,
          is_revoked: false,
        })
        .returning({
          id: apiKeys.id,
          key_prefix: apiKeys.key_prefix,
        });

      if (!created) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create API key",
        });
      }

      return {
        id: created.id,
        /** The raw key. Shown ONCE — never available again. */
        key: rawKey,
        key_prefix: created.key_prefix,
      };
    }),

  /**
   * List API keys for the current tenant.
   *
   * Returns metadata only — NEVER includes `key_hash` or the raw key.
   * Results are ordered by `created_at` descending (newest first).
   */
  list: protectedProcedure
    .input(
      z.object({
        /**
         * Cursor for pagination: ISO 8601 datetime of the last seen
         * `created_at` value. Returns items created before this timestamp.
         * Omit for the first page.
         */
        cursor: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      const rows = await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          key_prefix: apiKeys.key_prefix,
          scopes: apiKeys.scopes,
          last_used_at: apiKeys.last_used_at,
          expires_at: apiKeys.expires_at,
          is_revoked: apiKeys.is_revoked,
          created_at: apiKeys.created_at,
          // tenant_id: excluded — RLS enforces it, no need to expose
          // user_id: excluded — internal implementation detail
          // key_hash: NEVER returned — security invariant
        })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.tenant_id, tenantId),
            // Cursor: return items created before the cursor timestamp
            input.cursor ? lt(apiKeys.created_at, new Date(input.cursor)) : undefined
          )
        )
        .orderBy(desc(apiKeys.created_at))
        .limit(input.limit + 1); // fetch one extra to detect next page

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      // nextCursor is the created_at of the last item in the page
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? lastItem.created_at.toISOString() : null;

      return {
        items,
        nextCursor,
      };
    }),

  /**
   * Revoke an API key.
   *
   * Sets `is_revoked = true`. Revoked keys are rejected by the ingest
   * endpoint immediately. Revocation is permanent — keys cannot be un-revoked.
   *
   * Guards:
   * - The key must belong to the current tenant (RLS + explicit check).
   * - Already-revoked keys are idempotent (no error, returns current state).
   */
  revoke: protectedProcedure
    .input(
      z.object({
        /** UUID of the API key to revoke. */
        id: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      // Verify the key exists and belongs to this tenant before updating.
      // Even though RLS enforces tenant isolation at the DB level, we do
      // an explicit check here to return a clear NOT_FOUND error rather than
      // silently updating 0 rows.
      const [existing] = await db
        .select({ id: apiKeys.id, is_revoked: apiKeys.is_revoked })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.tenant_id, tenantId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }

      // Idempotent: if already revoked, return success without updating.
      if (existing.is_revoked) {
        return { id: existing.id, is_revoked: true as const };
      }

      await db
        .update(apiKeys)
        .set({ is_revoked: true })
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.tenant_id, tenantId)));

      return { id: input.id, is_revoked: true as const };
    }),
});
