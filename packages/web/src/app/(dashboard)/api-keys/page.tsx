// SPDX-License-Identifier: AGPL-3.0-only
/**
 * API Keys page — server component fetches key list.
 */

import { PageHeader } from "@/components/ui/page-header";
import { createServerTRPCClient } from "@/lib/trpc-server";
import { ApiKeyManager } from "./api-key-table";

export const metadata = {
  title: "API Keys — LoopStorm Guard",
};

export default async function ApiKeysPage() {
  const trpc = await createServerTRPCClient();

  let initialData: Awaited<ReturnType<typeof trpc.apiKeys.list>> = {
    items: [],
    nextCursor: null,
  };

  try {
    initialData = await trpc.apiKeys.list({ limit: 50 });
  } catch {
    // Render empty state on error
  }

  return (
    <div>
      <PageHeader title="API Keys" description="Manage API keys for SDK agent authentication" />
      <ApiKeyManager initialItems={initialData.items} initialNextCursor={initialData.nextCursor} />
    </div>
  );
}
