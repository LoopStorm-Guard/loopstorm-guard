// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Playwright E2E test configuration for LoopStorm Guard web UI.
 *
 * Tests run against the full stack:
 * - Next.js frontend: localhost:3000
 * - Hono backend: localhost:3001
 * - PostgreSQL: configured in the backend's env
 *
 * Tests use data-testid attributes for reliable selectors.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Run sequentially to avoid auth state conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Include credentials for cookie-based auth
    extraHTTPHeaders: {},
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Ensure the dev server is running before tests
  // webServer is not configured here to allow manual server startup.
  // In CI, start the servers before running playwright.
});
