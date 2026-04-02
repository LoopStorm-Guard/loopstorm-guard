// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LoopStorm Guard API server entry point.
 *
 * Tech stack: Hono (routing) + Bun (runtime) + Drizzle ORM (PostgreSQL)
 *             + tRPC (type-safe procedures) + Better Auth (authentication, ADR-011)
 *
 * Route layout:
 *   GET  /api/health              — liveness check with DB ping
 *   GET  /api/health/supervisor   — supervisor queue health
 *   ALL  /api/auth/**             — Better Auth handler (login, register, OAuth)
 *   ALL  /api/trpc/**             — tRPC procedure handler
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
import { createContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";

const app = new Hono();

// ---------------------------------------------------------------------------
// CORS — must come before all route handlers
// ---------------------------------------------------------------------------

// Parse allowed origins from env. Fall back to localhost for development only.
// In production, ALLOWED_ORIGINS must be set — otherwise all CORS requests are rejected.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : env.NODE_ENV === "production"
    ? []
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

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

// Named export for tests and tRPC type extraction — use this when importing
// the Hono app instance directly (e.g., for request injection in tests).
export { app };

// Re-export AppRouter type for the frontend package
export type { AppRouter } from "./trpc/router.js";

// Idiomatic Bun auto-serve: exporting an object with `fetch` and `port` tells
// Bun to start the server automatically when this file is the entry point.
// This avoids the EADDRINUSE double-bind that occurs when Bun 1.2.x detects
// a `.fetch` method on `export default` *and* an explicit `Bun.serve()` call
// both fire on startup.
const port = Number(process.env.PORT) || env.PORT;
console.warn(`[loopstorm-api] starting on port ${port}`);

export default {
  fetch: app.fetch,
  port,
};
