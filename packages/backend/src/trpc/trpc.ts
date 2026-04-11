// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC instance, middleware chain, and procedure builders for LoopStorm Guard.
 *
 * Exports:
 * - `router`            — for building tRPC routers
 * - `publicProcedure`   — no auth required (e.g., health check)
 * - `protectedProcedure`— requires a valid Better Auth session + tenant
 * - `apiKeyProcedure`   — requires a valid API key (for ingest operations)
 * - `dualAuthProcedure` — accepts either session or API key
 *
 * ADR-020: Every authenticated procedure is wrapped in a `db.transaction()`
 * that sets the tenant RLS context on the transaction client BEFORE any query
 * runs. The transaction client is injected into `ctx.db`, shadowing the
 * module-level singleton. Procedures MUST use `ctx.db` exclusively.
 *
 * Auth middleware flow (protectedProcedure):
 * 1. Extract Better Auth session from request headers/cookies.
 * 2. Read `tenant_id` from session.user (our custom column).
 * 3. Open a database transaction (`db.transaction()`).
 * 4. Call `setTenantRlsContext(tx, tenantId)` on the tx client inside the transaction.
 * 5. Shadow `ctx.db = tx` so all procedure queries use the scoped client.
 * 6. Attach `userId`, `tenantId`, and `db` to context and call `next()`.
 * 7. Commit on success, roll back on throw.
 *
 * API key middleware flow (apiKeyProcedure):
 * 1. Read `Authorization: Bearer` header.
 * 2. Hash the key and look it up in `api_keys` table.
 * 3. Open a database transaction.
 * 4. Call `setTenantRlsContext(tx, tenantId)` inside the transaction.
 * 5. Shadow `ctx.db = tx`.
 * 6. Attach `tenantId`, `apiKeyScopes`, `apiKeyId` to context and call `next()`.
 *
 * Error contract:
 * - Authentication failures throw UNAUTHORIZED.
 * - Missing tenant throws FORBIDDEN.
 * - Internal errors are NOT surfaced (no stack traces to clients).
 */

import { TRPCError, initTRPC } from "@trpc/server";
import { ensureTenantId } from "../auth.js";
import { db } from "../db/client.js";
import { authenticateApiKey } from "../middleware/api-key.js";
import { getSession } from "../middleware/auth.js";
import { setTenantRlsContext } from "../middleware/tenant.js";
import type { TRPCContext } from "./context.js";

// Initialize tRPC with our context type.
const t = initTRPC.context<TRPCContext>().create();

// ---------------------------------------------------------------------------
// Base builders — exported for use in routers
// ---------------------------------------------------------------------------

/** Build a tRPC router. */
export const router = t.router;

/** Build a procedure with no authentication requirement. */
export const publicProcedure = t.procedure;

// ---------------------------------------------------------------------------
// Auth middleware — session-based (web dashboard)
// ---------------------------------------------------------------------------

const authMiddleware = t.middleware(async ({ ctx, next }) => {
  // Validate the Better Auth session from cookies/headers.
  const session = await getSession(ctx.request);

  // Our custom column on the users table. Better Auth's TypeScript types do not
  // know about the tenant_id column we added — cast through unknown is safe here
  // because the drizzleAdapter is configured with our schema that includes it.
  // biome-ignore lint/suspicious/noExplicitAny: Better Auth custom column
  let tenantId = (session.user as any).tenant_id as string | null | undefined;

  // Self-healing: if tenant_id is missing (stale session cache or failed hook),
  // attempt to resolve or provision the tenant before rejecting the request.
  if (!tenantId) {
    tenantId = await ensureTenantId({
      id: session.user.id,
      name: session.user.name ?? "",
      email: session.user.email,
    });
  }

  if (!tenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tenant associated with this account",
    });
  }

  // ADR-020: Open a transaction, set RLS context on the tx client, and shadow
  // ctx.db with the tx. The entire procedure handler runs inside this transaction.
  // On success: transaction commits, RLS context is cleared automatically.
  // On throw: transaction rolls back, RLS context is cleared automatically.
  // Either way, the connection returns to the pool with no lingering state.
  return db.transaction(async (tx) => {
    await setTenantRlsContext(tx, tenantId as string);

    return next({
      ctx: {
        ...ctx,
        userId: session.user.id,
        tenantId,
        db: tx, // ADR-020: shadow the singleton with the transaction client
      },
    });
  });
});

/**
 * Procedure that requires a valid Better Auth session with a tenant.
 * Use this for all web dashboard procedures.
 */
export const protectedProcedure = t.procedure.use(authMiddleware);

// ---------------------------------------------------------------------------
// API key middleware — for SDK ingest operations
// ---------------------------------------------------------------------------

const apiKeyMiddleware = t.middleware(async ({ ctx, next }) => {
  const authHeader = ctx.request.headers.get("authorization");
  const result = await authenticateApiKey(authHeader);

  if (!result) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Valid API key required",
    });
  }

  // ADR-020: Open a transaction, set RLS context, shadow ctx.db.
  return db.transaction(async (tx) => {
    await setTenantRlsContext(tx, result.tenant_id);

    return next({
      ctx: {
        ...ctx,
        userId: null, // API keys are not tied to a specific user
        tenantId: result.tenant_id,
        db: tx, // ADR-020: shadow the singleton with the transaction client
        // Expose scopes so the ingest handler can verify "ingest" scope.
        // We extend the context type inline here rather than polluting
        // TRPCContext (which is shared by all procedure types).
        apiKeyScopes: result.scopes,
        apiKeyId: result.api_key_id,
      },
    });
  });
});

/**
 * Procedure that requires a valid API key.
 * Use this for the events.ingest procedure (and future SDK-facing endpoints).
 */
export const apiKeyProcedure = t.procedure.use(apiKeyMiddleware);

// ---------------------------------------------------------------------------
// Dual-auth middleware — accepts either session or API key
// Used by events.ingest which can be called from both dashboard and SDK.
// ---------------------------------------------------------------------------

const dualAuthMiddleware = t.middleware(async ({ ctx, next }) => {
  const authHeader = ctx.request.headers.get("authorization");

  // Try API key first (Bearer token = SDK/CLI call)
  if (authHeader?.startsWith("Bearer ")) {
    const result = await authenticateApiKey(authHeader);
    if (result) {
      // ADR-020: transaction + RLS context on tx client.
      return db.transaction(async (tx) => {
        await setTenantRlsContext(tx, result.tenant_id);
        return next({
          ctx: {
            ...ctx,
            userId: null,
            tenantId: result.tenant_id,
            db: tx, // ADR-020: shadow the singleton
          },
        });
      });
    }
    // Bearer token present but invalid — reject immediately (don't fall through
    // to session auth, which would give a misleading error message)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid API key",
    });
  }

  // No Bearer token — try session auth
  const session = await getSession(ctx.request);
  // biome-ignore lint/suspicious/noExplicitAny: Better Auth custom column not in its types
  let tenantId = (session.user as any).tenant_id as string | null | undefined;

  // Self-healing: if tenant_id is missing (stale session cache or failed hook),
  // attempt to resolve or provision the tenant before rejecting the request.
  if (!tenantId) {
    tenantId = await ensureTenantId({
      id: session.user.id,
      name: session.user.name ?? "",
      email: session.user.email,
    });
  }

  if (!tenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tenant associated with this account",
    });
  }

  // ADR-020: transaction + RLS context on tx client.
  return db.transaction(async (tx) => {
    await setTenantRlsContext(tx, tenantId as string);
    return next({
      ctx: {
        ...ctx,
        userId: session.user.id,
        tenantId,
        db: tx, // ADR-020: shadow the singleton
      },
    });
  });
});

/**
 * Procedure that accepts either a session cookie or an API key.
 * Use this for the events.ingest procedure.
 */
export const dualAuthProcedure = t.procedure.use(dualAuthMiddleware);
