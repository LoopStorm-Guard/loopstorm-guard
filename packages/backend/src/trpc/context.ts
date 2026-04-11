// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC context type and factory for LoopStorm Guard.
 *
 * The context is created once per request and threaded through all tRPC
 * middleware and procedure handlers. It holds the raw request, the
 * authenticated user ID, the tenant ID, and a database client.
 *
 * Context population:
 * - `userId` and `tenantId` start as null (unauthenticated).
 * - The `db` field starts as the module-level singleton.
 * - The `withTenantTransaction` middleware (ADR-020) replaces `ctx.db`
 *   with a transaction client (`tx`) at the start of every authenticated
 *   procedure, ensuring all queries run inside a tenant-scoped transaction.
 * - The `authMiddleware` in trpc.ts populates `userId` and `tenantId` after
 *   validating the Better Auth session.
 * - For API key–authenticated requests (ingest), the `apiKeyMiddleware`
 *   populates only `tenantId` (API keys are not tied to a specific user
 *   for the purposes of ingest operations).
 *
 * ADR-020 CONTRACT: All authenticated procedures MUST use `ctx.db` for
 * database access. Never import and use the `db` singleton directly in a
 * procedure handler — that would bypass the RLS transaction scoping.
 */

import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { db } from "../db/client.js";
import type { DrizzleClient } from "../middleware/tenant.js";

/**
 * The shape of the tRPC context available in every procedure.
 *
 * The `db` field is the authoritative database client for the current request.
 * In authenticated procedures, the `withTenantTransaction` middleware shadows
 * it with a transaction-scoped client that has the RLS context already set.
 */
export interface TRPCContext {
  /** Index signature required by @hono/trpc-server's createContext contract. */
  [key: string]: unknown;
  /** The raw HTTP request. Used by auth middleware to read session cookies/headers. */
  request: Request;
  /** ID of the authenticated user (Better Auth user.id), or null for API key auth. */
  userId: string | null;
  /** UUID of the current tenant, set after authentication. Null = unauthenticated. */
  tenantId: string | null;
  /**
   * Database client for this request.
   *
   * In authenticated procedures (protectedProcedure, apiKeyProcedure,
   * dualAuthProcedure), this is replaced by the `withTenantTransaction`
   * middleware with a transaction client that has tenant RLS context set.
   *
   * In unauthenticated procedures (publicProcedure), this is the module-level
   * db singleton. Public procedures must not access RLS-protected tables.
   *
   * ADR-020: Procedures MUST use ctx.db, never the imported db singleton.
   */
  db: DrizzleClient;
}

/**
 * Factory function called by the Hono tRPC adapter on each request.
 * Produces an unauthenticated context; middleware populates the fields.
 *
 * @param opts - Options from the fetch adapter, including the raw Request
 * @returns An unauthenticated context to be enriched by middleware
 */
export function createContext({ req }: FetchCreateContextFnOptions): TRPCContext {
  return {
    request: req,
    userId: null,
    tenantId: null,
    db, // Will be shadowed by withTenantTransaction in authenticated procedures
  };
}
