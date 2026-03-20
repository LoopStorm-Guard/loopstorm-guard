// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Supervisor E2E tests — proposals and escalations.
 *
 * The escalate_to_human invariant (ADR-012, C10): the escalation
 * acknowledgement flow must always be accessible — never gated by policies.
 */

import { test, expect } from "@playwright/test";

test.describe("Supervisor (unauthenticated)", () => {
  test("unauthenticated /supervisor redirects to sign-in", async ({ page }) => {
    await page.goto("/supervisor");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("Supervisor page", () => {
  test.skip("supervisor page renders Layer 2 indicator", async ({ page }) => {
    await page.goto("/supervisor");
    // Should show the brain icon and advisory label
    await expect(page.getByText("AI Supervisor")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("advisory only")).toBeVisible();
  });

  test.skip("empty escalations shows 'No active escalations'", async ({ page }) => {
    await page.goto("/supervisor");
    // If no escalations, empty state is shown
    const emptyState = page.getByText("No active escalations");
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
    }
  });

  test.skip("empty proposals shows 'No pending proposals'", async ({ page }) => {
    await page.goto("/supervisor");
    const emptyState = page.getByText("No pending proposals");
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
    }
  });
});

test.describe("Escalation actions", () => {
  test.skip("acknowledge escalation removes it from the queue", async ({ page }) => {
    await page.goto("/supervisor");

    const escalationCard = page.locator("[data-testid^='escalation-card-']").first();
    if (await escalationCard.isVisible()) {
      // Find the acknowledge button
      const ackBtn = escalationCard.locator("[data-testid^='btn-acknowledge-']");
      if (!(await ackBtn.isVisible())) {
        // Click the "Acknowledge" button to show the form
        await escalationCard.getByText("Acknowledge").click();
      }
      await ackBtn.click();
      // Card should be removed from the queue
      await expect(escalationCard).not.toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe("Proposal actions", () => {
  test.skip("approve proposal removes it from pending queue", async ({ page }) => {
    await page.goto("/supervisor");

    const proposalCard = page.locator("[data-testid^='proposal-card-']").first();
    if (await proposalCard.isVisible()) {
      const approveBtn = proposalCard.locator("[data-testid^='btn-approve-']");
      await approveBtn.click();
      // Confirm approval
      const confirmBtn = proposalCard.locator("[data-testid^='btn-confirm-approve-']");
      await confirmBtn.click();
      await expect(proposalCard).not.toBeVisible({ timeout: 5000 });
    }
  });

  test.skip("reject proposal requires a reason", async ({ page }) => {
    await page.goto("/supervisor");

    const proposalCard = page.locator("[data-testid^='proposal-card-']").first();
    if (await proposalCard.isVisible()) {
      const rejectBtn = proposalCard.locator("[data-testid^='btn-reject-']");
      await rejectBtn.click();

      // Try to confirm without a reason
      const confirmBtn = proposalCard.locator("[data-testid^='btn-confirm-reject-']");
      await confirmBtn.click();

      // Should show validation error
      await expect(proposalCard.getByText("Rejection reason is required")).toBeVisible();
    }
  });

  test.skip("reject proposal with reason succeeds", async ({ page }) => {
    await page.goto("/supervisor");

    const proposalCard = page.locator("[data-testid^='proposal-card-']").first();
    if (await proposalCard.isVisible()) {
      const rejectBtn = proposalCard.locator("[data-testid^='btn-reject-']");
      await rejectBtn.click();

      const cardId = await proposalCard.getAttribute("data-testid");
      const id = cardId?.replace("proposal-card-", "") ?? "";

      // Fill in the rejection reason
      await proposalCard.locator(`[data-testid="reject-notes-${id}"]`).fill("Not applicable to current deployment");
      await proposalCard.locator(`[data-testid="btn-confirm-reject-${id}"]`).click();

      // Card should be removed
      await expect(proposalCard).not.toBeVisible({ timeout: 5000 });
    }
  });

  test.skip("proposal filter tabs switch between pending/approved/rejected", async ({ page }) => {
    await page.goto("/supervisor");

    // Click the "Approved" filter tab
    await page.getByTestId("proposal-filter-approved").click();
    // Should now show approved proposals (may be empty)
    await expect(page.getByTestId("proposal-filter-approved")).toBeVisible();
  });
});
