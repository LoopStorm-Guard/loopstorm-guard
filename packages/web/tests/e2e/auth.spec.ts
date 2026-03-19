// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Auth E2E tests — sign in, sign up, sign out, invalid credentials.
 *
 * These tests run against the full stack. A test user must be seeded
 * or created before these tests run.
 *
 * Test data: uses TEST_USER_EMAIL / TEST_USER_PASSWORD env vars.
 */

import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_USER_EMAIL ?? "test@loopstorm.dev";
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? "test-password-123";

test.describe("Authentication", () => {
  test("sign-in page renders correctly", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByTestId("input-email")).toBeVisible();
    await expect(page.getByTestId("input-password")).toBeVisible();
    await expect(page.getByTestId("btn-submit")).toBeVisible();
    await expect(page.getByTestId("btn-google")).toBeVisible();
    await expect(page.getByText("Sign in to your account")).toBeVisible();
  });

  test("sign-up page renders correctly", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByTestId("input-name")).toBeVisible();
    await expect(page.getByTestId("input-email")).toBeVisible();
    await expect(page.getByTestId("input-password")).toBeVisible();
    await expect(page.getByTestId("btn-submit")).toBeVisible();
    await expect(page.getByText("Create an account")).toBeVisible();
  });

  test("invalid credentials show error", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByTestId("input-email").fill("wrong@example.com");
    await page.getByTestId("input-password").fill("wrong-password");
    await page.getByTestId("btn-submit").click();
    await expect(page.getByTestId("auth-error")).toBeVisible({ timeout: 5000 });
  });

  test("unauthenticated access to /runs redirects to sign-in", async ({ page }) => {
    await page.goto("/runs");
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 5000 });
  });

  test("unauthenticated access to /policies redirects to sign-in", async ({ page }) => {
    await page.goto("/policies");
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 5000 });
  });

  test("unauthenticated access to /api-keys redirects to sign-in", async ({ page }) => {
    await page.goto("/api-keys");
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 5000 });
  });

  // This test requires a live backend with a seeded test user
  test.skip("successful sign-in redirects to /runs", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByTestId("input-email").fill(TEST_EMAIL);
    await page.getByTestId("input-password").fill(TEST_PASSWORD);
    await page.getByTestId("btn-submit").click();
    await expect(page).toHaveURL("/runs", { timeout: 10000 });
  });

  // This test requires a live backend with a seeded test user
  test.skip("sign-out clears session and redirects to sign-in", async ({ page }) => {
    // Sign in first
    await page.goto("/sign-in");
    await page.getByTestId("input-email").fill(TEST_EMAIL);
    await page.getByTestId("input-password").fill(TEST_PASSWORD);
    await page.getByTestId("btn-submit").click();
    await page.waitForURL("/runs");

    // Sign out
    await page.getByTestId("btn-sign-out").click();
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 5000 });
  });
});
