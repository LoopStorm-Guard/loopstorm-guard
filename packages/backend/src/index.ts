// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LoopStorm Guard API server entry point.
 *
 * Tech stack: Hono (routing) + Bun (runtime) + Drizzle ORM (PostgreSQL)
 *             + tRPC (type-safe procedures) + Better Auth (authentication, ADR-011)
 *
 * IMPORTANT: This file is licensed AGPL-3.0-only. Do not import it from
 * any MIT-licensed package. Dependency direction: AGPL -> MIT only (ADR-013).
 */

import { Hono } from "hono";

const app = new Hono();

// Health check — unauthenticated, required by observability config
app.get("/api/health", async (c) => {
  // TODO(backend): add db ping check
  return c.json({ status: "ok", db: "ok" });
});

app.get("/api/health/supervisor", async (c) => {
  // TODO(backend): query supervisor job counts
  return c.json({ pending_jobs: 0, failed_jobs_24h: 0 });
});

// TODO(backend): mount tRPC router
// TODO(backend): mount Better Auth routes
// TODO(backend): mount ingest endpoint
// TODO(backend): mount supervisor cron endpoints

export default app;

// Bun entry point
if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  console.warn(`[loopstorm-api] starting on port ${port}`);
  Bun.serve({ fetch: app.fetch, port });
}
