// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC router for AI Supervisor observation plane in LoopStorm Guard.
 *
 * Procedures:
 * - `supervisor.listProposals`          — list supervisor proposals for the tenant
 * - `supervisor.approveProposal`        — approve a pending proposal
 * - `supervisor.rejectProposal`         — reject a pending proposal
 * - `supervisor.listEscalations`        — list supervisor escalations for the tenant
 * - `supervisor.acknowledgeEscalation`  — acknowledge an open escalation
 * - `supervisor.resolveEscalation`      — resolve an acknowledged escalation
 *
 * Enforcement/observation plane separation (ADR-012):
 * These procedures are on the OBSERVATION PLANE. They record human decisions
 * about AI Supervisor proposals and escalations. They do NOT modify enforcement
 * configuration directly — approved proposals must be applied through a
 * separate workflow (e.g., updating a policy pack via policies.update).
 *
 * The `escalate_to_human` invariant (ADR-012, C13):
 * The escalation endpoints must ALWAYS be writable. No policy rule or
 * application logic may block the creation or acknowledgement of escalations.
 *
 * Security: all procedures use protectedProcedure (session auth + tenant RLS).
 * Cross-tenant isolation is enforced at both the DB level (RLS) and
 * application level (explicit tenant_id checks in WHERE clauses).
 *
 * ADR-020: All queries use ctx.db (the transaction-scoped client injected
 * by the protectedProcedure middleware). Never import the db singleton here.
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { supervisorEscalations, supervisorProposals } from "../../db/schema.js";
import { protectedProcedure, router } from "../trpc.js";

export const supervisorRouter = router({
  /**
   * List supervisor proposals for the current tenant.
   *
   * Proposals are created by the AI Supervisor when it identifies patterns
   * that warrant a policy or configuration change. They require human approval.
   *
   * Cursor-based pagination on created_at DESC.
   */
  listProposals: protectedProcedure
    .input(
      z.object({
        cursor: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        /** Filter by proposal status. Omit to return all. */
        status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
        /** Filter by proposal type. Omit to return all. */
        proposal_type: z
          .enum(["budget_adjustment", "policy_change", "agent_profile_update", "flag_for_review"])
          .optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      const conditions = [eq(supervisorProposals.tenant_id, tenantId)];

      if (input.cursor) {
        conditions.push(lt(supervisorProposals.created_at, new Date(input.cursor)));
      }

      if (input.status) {
        conditions.push(eq(supervisorProposals.status, input.status));
      }

      if (input.proposal_type) {
        conditions.push(eq(supervisorProposals.proposal_type, input.proposal_type));
      }

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const rows = await ctx.db
        .select()
        .from(supervisorProposals)
        .where(and(...conditions))
        .orderBy(desc(supervisorProposals.created_at))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? lastItem.created_at.toISOString() : null;

      return { items, nextCursor };
    }),

  /**
   * Approve a pending supervisor proposal.
   *
   * Sets status to "approved", records reviewed_by and reviewed_at.
   * Only pending proposals can be approved — already-resolved proposals
   * return a CONFLICT error.
   *
   * NOTE: Approval records the human decision. It does NOT automatically
   * apply the proposed change. The frontend/operator must take a subsequent
   * action (e.g., call policies.update) to apply the approved change.
   * This maintains enforcement/observation plane separation (ADR-012).
   */
  approveProposal: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        /** Optional notes from the reviewer. */
        review_notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";
      const userId = ctx.userId ?? "";

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      // Verify the proposal exists and belongs to this tenant
      const [existing] = await ctx.db
        .select({
          id: supervisorProposals.id,
          status: supervisorProposals.status,
          tenant_id: supervisorProposals.tenant_id,
        })
        .from(supervisorProposals)
        .where(
          and(eq(supervisorProposals.id, input.id), eq(supervisorProposals.tenant_id, tenantId))
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Proposal not found",
        });
      }

      if (existing.status !== "pending") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Proposal is already in status "${existing.status}". Only pending proposals can be approved.`,
        });
      }

      const now = new Date();

      const [updated] = await ctx.db
        .update(supervisorProposals)
        .set({
          status: "approved",
          reviewed_by: userId,
          reviewed_at: now,
          review_notes: input.review_notes ?? null,
          updated_at: now,
        })
        .where(
          and(
            eq(supervisorProposals.id, input.id),
            eq(supervisorProposals.tenant_id, tenantId),
            // Guard: ensure status is still pending (TOCTOU defense)
            eq(supervisorProposals.status, "pending")
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Proposal status changed concurrently. Please re-fetch and retry.",
        });
      }

      return updated;
    }),

  /**
   * Reject a pending supervisor proposal.
   *
   * Sets status to "rejected", records reviewed_by and reviewed_at.
   * Only pending proposals can be rejected.
   */
  rejectProposal: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        /** Reason for rejection. Required for audit trail clarity. */
        review_notes: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";
      const userId = ctx.userId ?? "";

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const [existing] = await ctx.db
        .select({
          id: supervisorProposals.id,
          status: supervisorProposals.status,
        })
        .from(supervisorProposals)
        .where(
          and(eq(supervisorProposals.id, input.id), eq(supervisorProposals.tenant_id, tenantId))
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Proposal not found",
        });
      }

      if (existing.status !== "pending") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Proposal is already in status "${existing.status}". Only pending proposals can be rejected.`,
        });
      }

      const now = new Date();

      const [updated] = await ctx.db
        .update(supervisorProposals)
        .set({
          status: "rejected",
          reviewed_by: userId,
          reviewed_at: now,
          review_notes: input.review_notes,
          updated_at: now,
        })
        .where(
          and(
            eq(supervisorProposals.id, input.id),
            eq(supervisorProposals.tenant_id, tenantId),
            eq(supervisorProposals.status, "pending")
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Proposal status changed concurrently. Please re-fetch and retry.",
        });
      }

      return updated;
    }),

  /**
   * List supervisor escalations for the current tenant.
   *
   * Escalations are raised when the AI Supervisor detects a situation
   * requiring immediate human attention. They have a severity level and
   * an optional timeout with a default action.
   *
   * Cursor-based pagination on created_at DESC.
   */
  listEscalations: protectedProcedure
    .input(
      z.object({
        cursor: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        /** Filter by escalation status. Omit to return all. */
        status: z.enum(["open", "acknowledged", "resolved", "expired"]).optional(),
        /** Filter by severity. Omit to return all. */
        severity: z.enum(["low", "medium", "high", "critical"]).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      const conditions = [eq(supervisorEscalations.tenant_id, tenantId)];

      if (input.cursor) {
        conditions.push(lt(supervisorEscalations.created_at, new Date(input.cursor)));
      }

      if (input.status) {
        conditions.push(eq(supervisorEscalations.status, input.status));
      }

      if (input.severity) {
        conditions.push(eq(supervisorEscalations.severity, input.severity));
      }

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const rows = await ctx.db
        .select()
        .from(supervisorEscalations)
        .where(and(...conditions))
        .orderBy(desc(supervisorEscalations.created_at))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? lastItem.created_at.toISOString() : null;

      return { items, nextCursor };
    }),

  /**
   * Acknowledge an open escalation.
   *
   * Sets status to "acknowledged", records acknowledged_by and acknowledged_at.
   * Only open escalations can be acknowledged.
   *
   * IMPORTANT: The `escalate_to_human` invariant (ADR-012, C13) requires that
   * this endpoint always be reachable. It must never be guarded by policy rules.
   */
  acknowledgeEscalation: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        /** Optional resolution notes. */
        resolution_notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";
      const userId = ctx.userId ?? "";

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const [existing] = await ctx.db
        .select({
          id: supervisorEscalations.id,
          status: supervisorEscalations.status,
        })
        .from(supervisorEscalations)
        .where(
          and(eq(supervisorEscalations.id, input.id), eq(supervisorEscalations.tenant_id, tenantId))
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Escalation not found",
        });
      }

      if (existing.status !== "open") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Escalation is already in status "${existing.status}". Only open escalations can be acknowledged.`,
        });
      }

      const now = new Date();

      const [updated] = await ctx.db
        .update(supervisorEscalations)
        .set({
          status: "acknowledged",
          acknowledged_by: userId,
          acknowledged_at: now,
          resolution_notes: input.resolution_notes ?? null,
          updated_at: now,
        })
        .where(
          and(
            eq(supervisorEscalations.id, input.id),
            eq(supervisorEscalations.tenant_id, tenantId),
            eq(supervisorEscalations.status, "open")
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Escalation status changed concurrently. Please re-fetch and retry.",
        });
      }

      return updated;
    }),

  /**
   * Resolve an acknowledged escalation.
   *
   * Sets status to "resolved", records resolution_notes and updated_at.
   * Only acknowledged escalations can be resolved — open, resolved, and
   * expired escalations return a CONFLICT error.
   *
   * Lifecycle: open → acknowledged → resolved.
   *
   * IMPORTANT: The `escalate_to_human` invariant (ADR-012, C13) requires that
   * this endpoint always be reachable. It must never be guarded by policy rules.
   */
  resolveEscalation: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        /** Optional notes describing the resolution. */
        resolution_notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId ?? "";

      // ADR-020: ctx.db is the transaction-scoped client from the middleware.
      const [existing] = await ctx.db
        .select({
          id: supervisorEscalations.id,
          status: supervisorEscalations.status,
        })
        .from(supervisorEscalations)
        .where(
          and(eq(supervisorEscalations.id, input.id), eq(supervisorEscalations.tenant_id, tenantId))
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Escalation not found",
        });
      }

      if (existing.status !== "acknowledged") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Escalation is in status "${existing.status}". Only acknowledged escalations can be resolved.`,
        });
      }

      const now = new Date();

      const [updated] = await ctx.db
        .update(supervisorEscalations)
        .set({
          status: "resolved",
          resolution_notes: input.resolution_notes ?? null,
          updated_at: now,
        })
        .where(
          and(
            eq(supervisorEscalations.id, input.id),
            eq(supervisorEscalations.tenant_id, tenantId),
            // Guard: ensure status is still acknowledged (TOCTOU defense)
            eq(supervisorEscalations.status, "acknowledged")
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Escalation status changed concurrently. Please re-fetch and retry.",
        });
      }

      return updated;
    }),
});
