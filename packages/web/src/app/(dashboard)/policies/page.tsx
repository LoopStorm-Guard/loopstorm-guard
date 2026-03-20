// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Policies list page — server component.
 */

import { PageHeader } from "@/components/ui/page-header";
import { createServerTRPCClient } from "@/lib/trpc-server";
import Link from "next/link";
import { PolicyList } from "./policy-list";

export const metadata = {
  title: "Policies — LoopStorm Guard",
};

export default async function PoliciesPage() {
  const trpc = await createServerTRPCClient();

  let initialData: Awaited<ReturnType<typeof trpc.policies.list>> = {
    items: [],
    nextCursor: null,
  };

  try {
    initialData = await trpc.policies.list({ limit: 50 });
  } catch {
    // Render empty state on error
  }

  const createButton = (
    <Link
      href="/policies/new"
      data-testid="btn-create-policy"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0.375rem 0.875rem",
        backgroundColor: "rgba(255, 107, 0, 0.15)",
        border: "1px solid rgba(255, 107, 0, 0.4)",
        borderRadius: "0.375rem",
        color: "var(--color-accent-amber)",
        fontSize: "0.8125rem",
        fontWeight: "500",
        textDecoration: "none",
      }}
    >
      + Create Policy
    </Link>
  );

  return (
    <div>
      <PageHeader
        title="Policies"
        description="Policy packs define enforcement rules for agent tool calls"
        actions={createButton}
      />
      <PolicyList initialItems={initialData.items} initialNextCursor={initialData.nextCursor} />
    </div>
  );
}
