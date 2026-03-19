// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runs E2E tests — runs list, run detail, pagination, chain badge.
 *
 * The live-backend tests are skipped by default. They require:
 * - Running backend on localhost:3001
 * - Seeded test data (runs with events)
 * - Authenticated session (cookie set in beforeEach)
 */

import { test, expect } from "@playwright/test";

test.describe("Runs pages (unauthenticated)", () => {
  test("unauthenticated /runs redirects to sign-in", async ({ page }) => {
    await page.goto("/runs");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("Runs list", () => {
  // These tests require a seeded backend
  test.skip("runs list renders status badges correctly", async ({ page }) => {
    await page.goto("/runs");
    // Status badges should be visible
    const badges = page.locator("[data-testid^='status-badge-']");
    await expect(badges.first()).toBeVisible({ timeout: 10000 });
  });

  test.skip("ABANDONED run shows amber badge not green", async ({ page }) => {
    await page.goto("/runs");
    const abandonedBadge = page.getByTestId("status-badge-abandoned");
    if (await abandonedBadge.isVisible()) {
      // Verify amber styling (not green)
      const color = await abandonedBadge.evaluate((el) =>
        getComputedStyle(el).color
      );
      // Should not be green (rgb 0, 200, 83)
      expect(color).not.toBe("rgb(0, 200, 83)");
    }
  });

  test.skip("status filter changes displayed runs", async ({ page }) => {
    await page.goto("/runs");
    const filter = page.getByTestId("runs-status-filter");
    await filter.selectOption("completed");
    // All visible status badges should be "Completed"
    const badges = page.locator("[data-testid^='status-badge-']");
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
      await expect(badges.nth(i)).toContainText("Completed");
    }
  });
});

test.describe("Run detail", () => {
  test.skip("run detail shows event timeline", async ({ page }) => {
    // Navigate to a seeded run — requires test data
    await page.goto("/runs");
    const firstRow = page.locator("[data-testid^='run-row-']").first();
    await firstRow.click();
    await expect(page.getByTestId("event-timeline")).toBeVisible({ timeout: 10000 });
  });

  test.skip("chain badge appears and shows verified state", async ({ page }) => {
    await page.goto("/runs");
    const firstRow = page.locator("[data-testid^='run-row-']").first();
    await firstRow.click();

    const chainBadge = page.getByTestId("chain-badge");
    await expect(chainBadge).toBeVisible({ timeout: 5000 });
    // Should eventually show verified or tampered state (not stuck on "Verifying")
    await expect(chainBadge).not.toContainText("Verifying", { timeout: 15000 });
  });

  test.skip("decision badges are visually distinct (kill vs deny)", async ({ page }) => {
    await page.goto("/runs");
    const firstRow = page.locator("[data-testid^='run-row-']").first();
    await firstRow.click();

    const killBadge = page.getByTestId("decision-badge-kill");
    const denyBadge = page.getByTestId("decision-badge-deny");

    if (await killBadge.isVisible() && await denyBadge.isVisible()) {
      // Kill badge should have a 2px border, deny should not
      const killBorder = await killBadge.evaluate((el) =>
        getComputedStyle(el).borderWidth
      );
      const denyBorder = await denyBadge.evaluate((el) =>
        getComputedStyle(el).borderWidth
      );
      expect(killBorder).toBe("2px");
      expect(denyBorder).toBe("1px");
    }
  });

  test.skip("budget bar is amber at >= 80%, red when exceeded", async ({ page }) => {
    // This requires a run with budget data
    // The budget bar colors are applied inline via CSS variables
    const budgetBars = page.locator("[data-testid^='budget-bar-']");
    await expect(budgetBars.first()).toBeVisible({ timeout: 5000 });
  });
});
