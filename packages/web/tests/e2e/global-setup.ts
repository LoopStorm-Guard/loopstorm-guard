// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Playwright global setup — runs once before the entire test suite.
 *
 * Responsibilities:
 *   1. Wait for the backend health endpoint to respond (max 60s).
 *   2. Wait for the Next.js frontend to respond (max 60s).
 *
 * In CI the servers are started as background processes by the workflow.
 * Locally, developers start servers manually before running `bunx playwright test`.
 *
 * We do NOT attempt to create a test user here — the tests that require
 * authenticated sessions are currently test.skip and will be enabled
 * separately once a test-user seeding strategy is agreed on.
 */

import { chromium, type FullConfig } from "@playwright/test";

const BACKEND_HEALTH_URL = "http://localhost:3001/api/health";
const FRONTEND_URL = "http://localhost:3000";
// Poll interval and total wait budget
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 60_000;

/**
 * Poll a URL until it returns a 2xx response or the budget is exhausted.
 * Returns normally on success, throws on timeout.
 */
async function waitForServer(url: string, label: string): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) {
        console.log(`[global-setup] ${label} ready at ${url}`);
        return;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `[global-setup] ${label} did not become ready at ${url} within ${MAX_WAIT_MS}ms. ` +
      `Last error: ${lastError}`
  );
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  console.log("[global-setup] Waiting for services to be ready...");

  // Wait for both servers in parallel. Either can fail independently so
  // we use Promise.all to surface both errors if they both time out.
  await Promise.all([
    waitForServer(BACKEND_HEALTH_URL, "backend"),
    waitForServer(FRONTEND_URL, "frontend"),
  ]);

  // Verify the backend database is healthy (not just the process).
  // The /api/health endpoint returns { "status": "ok", "db": "ok" } when
  // both the process and the DB connection are healthy.
  const healthRes = await fetch(BACKEND_HEALTH_URL);
  const health = (await healthRes.json()) as { status: string; db: string };
  if (health.db !== "ok") {
    throw new Error(
      `[global-setup] Backend DB is not healthy: ${JSON.stringify(health)}. ` +
        "Ensure the PostgreSQL service is running and migrations have been applied."
    );
  }

  console.log("[global-setup] All services healthy. Running tests.");

  // Launch a throwaway browser to warm up Chromium's process pool.
  // This avoids the first test in the suite paying the full browser launch cost.
  const browser = await chromium.launch();
  await browser.close();
}
