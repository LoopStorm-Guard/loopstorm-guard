// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LoopStorm Guard API server entry point — Bun long-lived process.
 *
 * This file is the entry point for local development and Mode 1 self-hosted
 * deployments. It imports the Hono app from src/app.ts and starts:
 *   - The HTTP server (Bun auto-serve via `export default`)
 *   - Background jobs (timeout-checker, trigger-dispatch)
 *
 * For Vercel Functions (production Mode 3 SaaS), the entry point is
 * api/index.ts. Background jobs run as Vercel Cron jobs declared in
 * vercel.json — they are NOT started here in that context.
 *
 * See ADR-015 for the full deployment architecture.
 *
 * IMPORTANT: This file is licensed AGPL-3.0-only. Do not import it from
 * any MIT-licensed package. Dependency direction: AGPL -> MIT only (ADR-013).
 */

import { app } from "./app.js";
import { env } from "./env.js";
import { startTimeoutChecker } from "./jobs/timeout-checker.js";
import { startTriggerDispatch } from "./lib/trigger-dispatch.js";

// ---------------------------------------------------------------------------
// Export — named export for tests, type extraction, and direct import
// ---------------------------------------------------------------------------

export { app };
export type { AppRouter } from "./trpc/router.js";

// ---------------------------------------------------------------------------
// Server startup (Bun auto-serve)
// ---------------------------------------------------------------------------

const port = Number(process.env.PORT) || env.PORT;
console.warn(`[loopstorm-api] starting on port ${port}`);

// ---------------------------------------------------------------------------
// Background jobs — started after the HTTP server is ready
//
// NOTE: These setInterval-based jobs are only appropriate for long-lived
// processes (local dev, Mode 1 self-hosted Docker/Fly.io). In Vercel
// Functions (production), the equivalent logic runs as Vercel Cron jobs
// declared in vercel.json (ADR-015 AC-15-4).
// ---------------------------------------------------------------------------

const timeoutChecker = startTimeoutChecker();
const triggerDispatch = startTriggerDispatch();

function shutdown() {
  console.warn("[loopstorm-api] shutting down background jobs...");
  timeoutChecker.stop();
  triggerDispatch.stop();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Idiomatic Bun auto-serve: exporting an object with `fetch` and `port` tells
// Bun to start the server automatically when this file is the entry point.
// This avoids the EADDRINUSE double-bind that occurs when Bun 1.2.x detects
// a `.fetch` method on `export default` *and* an explicit `Bun.serve()` call
// both fire on startup.
export default {
  fetch: app.fetch,
  port,
};
