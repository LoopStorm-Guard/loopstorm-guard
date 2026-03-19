// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Session authentication middleware for LoopStorm Guard.
 *
 * This module provides `getSession()` — a helper that validates a Better Auth
 * session from an incoming HTTP request. It is called by the tRPC auth
 * middleware (src/trpc/trpc.ts) for all protected procedures.
 *
 * The session object returned by Better Auth includes our custom `tenant_id`
 * field (added to the users table). The tRPC middleware reads this to set
 * the PostgreSQL RLS context for the duration of the request.
 *
 * Error contract: throws `TRPCError({ code: "UNAUTHORIZED" })` if no valid
 * session is present. The caller (tRPC middleware) should NOT add additional
 * wrapping — let the error propagate to the tRPC error formatter.
 */

import { TRPCError } from "@trpc/server";
import { auth } from "../auth.js";

/**
 * Validated session returned by Better Auth.
 *
 * The `user` object includes all columns from the `users` table. Our schema
 * adds `tenant_id` to that table, so it will be present here once the user's
 * tenant has been created (after registration flow completes).
 */
export type SessionData = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * Extract and validate the Better Auth session from the request headers.
 *
 * @param request - The raw Request object (from Hono's `c.req.raw`)
 * @returns The validated session object including user and session data
 * @throws TRPCError(UNAUTHORIZED) if no valid session is present
 */
export async function getSession(request: Request): Promise<NonNullable<SessionData>> {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  return session;
}
