// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LoopStorm Guard Hono application.
 *
 * This module exports the fully-configured Hono app instance. It is imported
 * by two entry points:
 *   - `src/index.ts`     — Bun long-lived process (local dev, Mode 1 self-hosted)
 *   - `api/index.ts`     — Vercel Function entry point (production, Mode 3 SaaS)
 *
 * NOTHING in this file starts a server, binds a port, or launches background
 * jobs. Startup concerns belong in the entry points above.
 *
 * Route layout:
 *   GET  /api/health                          — liveness check with DB ping
 *   GET  /api/health/supervisor               — supervisor queue health
 *   GET  /api/internal/cron/timeout-checker   — Vercel Cron: expire stale proposals/escalations
 *   ALL  /api/auth/**                         — Better Auth handler (ADR-011)
 *   ALL  /api/trpc/**                         — tRPC procedure handler
 *
 * CORS:
 *   Allowed origins are configured via the ALLOWED_ORIGINS environment variable
 *   (comma-separated list). Defaults to localhost:3000 in development.
 *   The Better Auth cookie is SameSite=Lax and requires credentials: "include"
 *   on the frontend fetch client.
 *
 * IMPORTANT: This file is licensed AGPL-3.0-only. Do not import it from
 * any MIT-licensed package. Dependency direction: AGPL -> MIT only (ADR-013).
 */

import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
import { sql as pgSql } from "./db/client.js";
import { env } from "./env.js";
import { runTimeoutCheck } from "./jobs/timeout-checker.js";
import { createContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";

export const app = new Hono();

// ---------------------------------------------------------------------------
// CORS — must come before all route handlers
// ---------------------------------------------------------------------------

// Parse allowed origins from env.ts (already validated by zod + production guard).
// In production, ALLOWED_ORIGINS must be set or the server fails to boot (T2 fix).
// In development, falls back to localhost:3000 if not set.
const allowedOrigins =
  (env.ALLOWED_ORIGINS?.length ?? 0) > 0
    ? (env.ALLOWED_ORIGINS ?? [])
    : env.NODE_ENV === "production"
      ? [] // Will never reach here — validateProductionOrigins() would have thrown at startup
      : ["http://localhost:3000"];

app.use(
  "*",
  cors({
    origin: (origin) => {
      // Allow the request if the origin is in our allowlist.
      // Return null for disallowed origins (not undefined) — Hono/cors
      // will omit the ACAO header, causing the browser to block the request.
      if (!origin) return null;
      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true, // required for cookie-based Better Auth sessions
  })
);

// ---------------------------------------------------------------------------
// Health checks — unauthenticated, required by observability config
// ---------------------------------------------------------------------------

app.get("/api/health", async (c) => {
  // Ping the database to verify connectivity.
  // Use a lightweight query that does not touch any application table.
  let dbStatus = "ok";
  try {
    await pgSql`SELECT 1`;
  } catch {
    dbStatus = "error";
  }

  const status = dbStatus === "ok" ? 200 : 503;

  return c.json({ status: dbStatus === "ok" ? "ok" : "degraded", db: dbStatus }, status);
});

app.get("/api/health/supervisor", async (c) => {
  // TODO(P5): query supervisor_jobs for pending/failed counts once that table exists
  return c.json({ pending_jobs: 0, failed_jobs_24h: 0 });
});

// ---------------------------------------------------------------------------
// Vercel Cron: timeout checker (ADR-015 AC-15-4, AC-15-5)
//
// Replaces the in-process setInterval in src/index.ts for the Vercel
// deployment. Vercel Cron invokes this route every minute (vercel.json
// schedule: "* * * * *"). Vercel automatically injects the cron secret as
// the Authorization header; we validate it here.
//
// Non-Vercel callers (local dev, tests) must supply the same secret or omit
// it (when VERCEL_CRON_SECRET is unset, auth is skipped — safe in dev only).
// ---------------------------------------------------------------------------

app.get("/api/internal/cron/timeout-checker", async (c) => {
  // Validate the Vercel Cron secret.
  // Vercel injects: Authorization: Bearer <VERCEL_CRON_SECRET>
  // If the secret is not configured (local dev, Mode 1), skip the check.
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (cronSecret) {
    const authHeader = c.req.header("Authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }

  // Run the timeout expiry logic (proposals + escalations).
  // Errors are caught inside runTimeoutCheck and logged; they do not throw.
  const result = await runTimeoutCheck();

  return c.json({
    ok: true,
    expired_proposals: result.expiredProposals,
    expired_escalations: result.expiredEscalations,
  });
});

// ---------------------------------------------------------------------------
// Better Auth — mounts all auth routes under /api/auth/**
// Handles: POST /api/auth/sign-in/email, POST /api/auth/sign-up/email,
//          GET  /api/auth/callback/:provider, POST /api/auth/sign-out, etc.
// ---------------------------------------------------------------------------

app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

// ---------------------------------------------------------------------------
// tRPC — mounts all tRPC procedures under /api/trpc/**
// ---------------------------------------------------------------------------

app.use(
  "/api/trpc/**",
  trpcServer({
    router: appRouter,
    createContext,
    onError: ({ path, error }) => {
      // Log internal errors server-side. Never expose stack traces to clients.
      // tRPC will sanitize the error before sending it to the client.
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(`[tRPC] Internal error on ${path ?? "unknown"}:`, error.message);
      }
    },
  })
);

// Re-export AppRouter type — consumed by the frontend package and api/index.ts.
export type { AppRouter } from "./trpc/router.js";
