// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runs list page — server component.
 *
 * Fetches the initial page of runs server-side for fast first render.
 * The RunsTable client component handles pagination and filtering.
 */

import { createServerTRPCClient } from "@/lib/trpc-server";
import { PageHeader } from "@/components/ui/page-header";
import { RunsTable } from "./runs-table";

export const metadata = {
  title: "Runs — LoopStorm Guard",
};

export default async function RunsPage() {
  const trpc = await createServerTRPCClient();

  let initialData: Awaited<ReturnType<typeof trpc.runs.list>> | null = null;
  try {
    initialData = await trpc.runs.list({ limit: 50 });
  } catch {
    // If the fetch fails (e.g., backend not running), render empty state
    initialData = { items: [], nextCursor: null };
  }

  return (
    <div>
      <PageHeader
        title="Runs"
        description="Agent run history with enforcement decisions and audit chain status"
      />
      <RunsTable initialItems={initialData.items} initialNextCursor={initialData.nextCursor} />
    </div>
  );
}
