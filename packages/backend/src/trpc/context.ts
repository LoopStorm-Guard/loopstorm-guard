// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC context type and factory for LoopStorm Guard.
 *
 * The context is created once per request and threaded through all tRPC
 * middleware and procedure handlers. It holds the raw request, the
 * authenticated user ID, and the tenant ID.
 *
 * Context population:
 * - `userId` and `tenantId` start as null (unauthenticated).
 * - The `authMiddleware` in trpc.ts populates them after validating the
 *   Better Auth session.
 * - For API key–authenticated requests (ingest), the `apiKeyMiddleware`
 *   populates only `tenantId` (API keys are not tied to a specific user
 *   for the purposes of ingest operations).
 *
 * The `db` instance is NOT placed on the context because Drizzle is a
 * module-level singleton (see src/db/client.ts). Procedures import `db`
 * directly. This simplifies testing: tests can mock `db` at the module level
 * without threading a mock through every context factory.
 */

import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

/**
 * The shape of the tRPC context available in every procedure.
 */
export interface TRPCContext {
  /** The raw HTTP request. Used by auth middleware to read session cookies/headers. */
  request: Request;
  /** ID of the authenticated user (Better Auth user.id), or null for API key auth. */
  userId: string | null;
  /** UUID of the current tenant, set after authentication. Null = unauthenticated. */
  tenantId: string | null;
}

/**
 * Factory function called by the Hono tRPC adapter on each request.
 * Produces an unauthenticated context; middleware populates the fields.
 *
 * @param opts - Options from the fetch adapter, including the raw Request
 * @returns An unauthenticated context to be enriched by middleware
 */
export function createContext({
  req,
}: FetchCreateContextFnOptions): TRPCContext {
  return {
    request: req,
    userId: null,
    tenantId: null,
  };
}
