// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Run detail page — server component.
 *
 * Fetches run metadata and the first page of events server-side.
 * The ChainBadge and EventTimeline are client components for interactivity.
 */

import { PageHeader } from "@/components/ui/page-header";
import { createServerTRPCClient } from "@/lib/trpc-server";
import { notFound } from "next/navigation";
import { EventTimeline } from "./event-timeline";
import { RunHeader } from "./run-header";

interface RunDetailPageProps {
  params: Promise<{ runId: string }>;
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { runId } = await params;
  const trpc = await createServerTRPCClient();

  let run: Awaited<ReturnType<typeof trpc.runs.get>> = null;
  let initialEvents: Awaited<ReturnType<typeof trpc.runs.getEvents>> = {
    items: [],
    nextCursor: null,
  };

  try {
    [run, initialEvents] = await Promise.all([
      trpc.runs.get({ run_id: runId }),
      trpc.runs.getEvents({ run_id: runId, limit: 100 }),
    ]);
  } catch {
    // If fetch fails, show not found
  }

  if (!run) {
    notFound();
  }

  return (
    <div>
      <PageHeader
        title={run.agent_name ?? "Unknown Agent"}
        description={`Run ${run.run_id.slice(0, 8)}… · ${run.environment ?? "unknown environment"}`}
      />
      <RunHeader run={run} />
      <div
        style={{
          borderTop: "1px solid var(--color-border)",
          marginTop: "1.5rem",
          paddingTop: "1.5rem",
        }}
      >
        <h2
          style={{
            fontSize: "0.875rem",
            fontWeight: "600",
            color: "oklch(0.70 0.00 0)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            margin: "0 0 1rem",
          }}
        >
          Event Timeline
        </h2>
        <EventTimeline
          runId={runId}
          initialItems={initialEvents.items}
          initialNextCursor={initialEvents.nextCursor}
        />
      </div>
    </div>
  );
}
