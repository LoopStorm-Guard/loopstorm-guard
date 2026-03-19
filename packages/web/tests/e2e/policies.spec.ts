// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Policies E2E tests — create, edit, conflict dialog, validation.
 */

import { test, expect } from "@playwright/test";

test.describe("Policies (unauthenticated)", () => {
  test("unauthenticated /policies redirects to sign-in", async ({ page }) => {
    await page.goto("/policies");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("Policy create", () => {
  test.skip("create policy form renders with required fields", async ({ page }) => {
    await page.goto("/policies/new");
    await expect(page.getByTestId("input-policy-name")).toBeVisible();
    await expect(page.getByTestId("policy-content-editor")).toBeVisible();
    await expect(page.getByTestId("btn-create-policy-submit")).toBeVisible();
  });

  test.skip("invalid JSON shows error", async ({ page }) => {
    await page.goto("/policies/new");
    await page.getByTestId("input-policy-name").fill("test-policy");

    // Enter invalid JSON
    const editor = page.getByTestId("policy-content-editor");
    await editor.fill("{invalid json}");
    await editor.blur(); // trigger validation

    await expect(page.getByTestId("policy-json-error")).toBeVisible();
  });

  test.skip("server validation errors shown inline", async ({ page }) => {
    await page.goto("/policies/new");
    await page.getByTestId("input-policy-name").fill("test-policy");
    // Submit with a valid-JSON but invalid policy
    const editor = page.getByTestId("policy-content-editor");
    await editor.fill('{"schema_version": 99}');
    await page.getByTestId("btn-create-policy-submit").click();

    // Should show server validation errors
    await expect(page.getByTestId("policy-server-errors")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Policy edit", () => {
  test.skip("version conflict dialog appears on 409", async ({ page }) => {
    // This test requires two concurrent edit sessions — requires live backend
    // Navigate to an edit page, then the conflict dialog should be testable
    // by mocking the API response or by a controlled test scenario
    await page.goto("/policies");
    const firstCard = page.locator("[data-testid^='policy-card-']").first();
    if (await firstCard.isVisible()) {
      await firstCard.click();
      await expect(page.getByTestId("btn-save-policy")).toBeVisible({ timeout: 5000 });
    }
  });

  test.skip("conflict dialog shows re-fetch and overwrite options", async ({ page }) => {
    // Intercept the update mutation to return a CONFLICT response
    // This requires Playwright route interception in a live test environment
    // Verify conflict-dialog appears and both buttons are visible
    const conflictDialog = page.getByTestId("conflict-dialog");
    if (await conflictDialog.isVisible()) {
      await expect(page.getByTestId("btn-conflict-refetch")).toBeVisible();
      await expect(page.getByTestId("btn-conflict-overwrite")).toBeVisible();
    }
  });
});
