// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EventTimeline — paginated chronological event list.
 *
 * Client component. Renders each event as an expandable EventDetail row.
 * Supports cursor-based "load more" pagination.
 *
 * Design rules:
 * - Supervisor events (event_type starts with "supervisor_"): muted amber
 *   left border, italic text, Layer 2 visual treatment
 * - Decision dots colored by decision type
 * - Tool names: JetBrains Mono, var(--color-mono)
 */

"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { LoadMoreButton } from "@/components/ui/load-more";
import { trpc } from "@/lib/trpc-client";
import { useState } from "react";
import { EventDetail } from "./event-detail";

type EventItem = {
  id: string;
  seq: number;
  event_type: string;
  // ts arrives as ISO string when serialized across server→client boundary
  ts: Date | string;
  tool: string | null;
  decision: string | null;
  rule_id: string | null;
  reason: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  latency_ms: number | null;
  args_redacted: unknown;
  hash: string;
  args_hash: string | null;
  agent_name: string | null;
  agent_role: string | null;
};

interface EventTimelineProps {
  runId: string;
  initialItems: EventItem[];
  initialNextCursor: number | null;
}

export function EventTimeline({ runId, initialItems, initialNextCursor }: EventTimelineProps) {
  const [items, setItems] = useState<EventItem[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<number | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const utils = trpc.useUtils();

  async function handleLoadMore() {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await utils.runs.getEvents.fetch({
        run_id: runId,
        cursor: nextCursor,
        limit: 100,
      });
      setItems((prev) => [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (items.length === 0) {
    return <EmptyState title="No events" description="This run has no recorded events." />;
  }

  return (
    <div data-testid="event-timeline">
      {items.map((event) => (
        <EventDetail key={event.id} event={event} />
      ))}
      <LoadMoreButton
        hasMore={nextCursor !== null}
        isLoading={loadingMore}
        onLoadMore={handleLoadMore}
      />
    </div>
  );
}
