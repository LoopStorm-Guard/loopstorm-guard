// SPDX-License-Identifier: AGPL-3.0-only
/**
 * API Keys E2E tests — create, copy, revoke, one-time display.
 */

import { test, expect } from "@playwright/test";

test.describe("API Keys (unauthenticated)", () => {
  test("unauthenticated /api-keys redirects to sign-in", async ({ page }) => {
    await page.goto("/api-keys");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("API Keys management", () => {
  test.skip("create key dialog opens and shows form", async ({ page }) => {
    await page.goto("/api-keys");
    await page.getByTestId("btn-create-api-key").click();
    await expect(page.getByTestId("create-key-dialog")).toBeVisible();
    await expect(page.getByTestId("input-key-name")).toBeVisible();
    await expect(page.getByTestId("scope-ingest")).toBeVisible();
    await expect(page.getByTestId("scope-read")).toBeVisible();
  });

  test.skip("key creation shows one-time key display", async ({ page }) => {
    await page.goto("/api-keys");
    await page.getByTestId("btn-create-api-key").click();

    await page.getByTestId("input-key-name").fill("test-key");
    await page.getByTestId("btn-create-key-submit").click();

    // One-time key display
    await expect(page.getByTestId("api-key-value")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("btn-copy")).toBeVisible();

    // Dialog cannot be dismissed until user confirms
    await expect(page.getByTestId("btn-done-key")).toBeDisabled();
    await page.getByTestId("checkbox-copied-key").check();
    await expect(page.getByTestId("btn-done-key")).toBeEnabled();
  });

  test.skip("api key shown once then masked on reload", async ({ page }) => {
    await page.goto("/api-keys");
    await page.getByTestId("btn-create-api-key").click();
    await page.getByTestId("input-key-name").fill("test-mask-key");
    await page.getByTestId("btn-create-key-submit").click();

    // Get the displayed key
    const keyDisplay = page.getByTestId("api-key-value");
    await expect(keyDisplay).toBeVisible({ timeout: 5000 });
    const rawKey = await keyDisplay.textContent();

    // Confirm and close
    await page.getByTestId("checkbox-copied-key").check();
    await page.getByTestId("btn-done-key").click();

    // Reload page — key should not be visible (only prefix shown)
    await page.reload();
    await expect(page.getByText(rawKey ?? "")).not.toBeVisible();
  });

  test.skip("revoke key shows revoked status", async ({ page }) => {
    await page.goto("/api-keys");

    // Find an active revoke button
    const revokeBtn = page.locator("[data-testid^='btn-revoke-']").first();
    if (await revokeBtn.isVisible()) {
      await revokeBtn.click();
      // Confirm dialog
      await expect(page.getByTestId("confirm-dialog")).toBeVisible();
      await page.getByTestId("btn-confirm").click();
      // Status should change to Revoked
      await expect(page.getByText("Revoked")).toBeVisible({ timeout: 5000 });
    }
  });
});
