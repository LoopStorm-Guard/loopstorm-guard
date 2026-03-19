// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RunsTable — paginated table of agent runs.
 *
 * Client component: handles status filtering, pagination, and row click
 * navigation to /runs/[runId].
 *
 * Columns: Run ID, Agent, Status, Decisions, Cost, Duration, Started
 *
 * Design rules:
 * - Run ID: monospace, first 8 chars + "…"
 * - Duration: formatted as "9h 32m" (NOT raw timestamp)
 * - Status: StatusBadge (ABANDONED is amber, not green)
 * - Never show raw DB enum values
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { TimeAgo } from "@/components/ui/time-ago";
import { LoadMoreButton } from "@/components/ui/load-more";
import { EmptyState } from "@/components/ui/empty-state";
import { trpc } from "@/lib/trpc-client";

type RunItem = {
  run_id: string;
  agent_name: string | null;
  agent_role: string | null;
  status: string;
  total_call_count: number;
  total_cost_usd: number;
  started_at: Date;
  ended_at: Date | null;
  created_at: Date;
};

type StatusFilter =
  | "all"
  | "started"
  | "completed"
  | "terminated_budget"
  | "terminated_loop"
  | "terminated_policy"
  | "abandoned"
  | "error";

interface RunsTableProps {
  initialItems: RunItem[];
  initialNextCursor: string | null;
}

function formatDuration(startedAt: Date, endedAt: Date | null): string {
  if (!endedAt) return "Running";
  const ms = endedAt.getTime() - startedAt.getTime();
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "started", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "terminated_budget", label: "Budget Exceeded" },
  { value: "terminated_loop", label: "Loop Terminated" },
  { value: "terminated_policy", label: "Policy Terminated" },
  { value: "abandoned", label: "Abandoned" },
  { value: "error", label: "Error" },
];

const thStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  textAlign: "left",
  fontSize: "0.6875rem",
  fontWeight: "500",
  color: "oklch(0.50 0.00 0)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid var(--color-border)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "0.625rem 0.75rem",
  fontSize: "0.8125rem",
  color: "oklch(0.75 0.00 0)",
  borderBottom: "1px solid rgba(31, 31, 31, 0.5)",
  verticalAlign: "middle",
};

export function RunsTable({ initialItems, initialNextCursor }: RunsTableProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [items, setItems] = useState<RunItem[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const utils = trpc.useUtils();

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await utils.runs.list.fetch({
        limit: 50,
        cursor: nextCursor,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setItems((prev) => [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleFilterChange(newFilter: StatusFilter) {
    setStatusFilter(newFilter);
    setLoadingMore(true);
    try {
      const result = await utils.runs.list.fetch({
        limit: 50,
        status: newFilter === "all" ? undefined : newFilter,
      });
      setItems(result.items);
      setNextCursor(result.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      {/* Filter bar */}
      <div style={{ marginBottom: "1rem" }}>
        <select
          value={statusFilter}
          onChange={(e) => handleFilterChange(e.target.value as StatusFilter)}
          data-testid="runs-status-filter"
          style={{
            padding: "0.375rem 0.75rem",
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.375rem",
            color: "oklch(0.75 0.00 0)",
            fontSize: "0.8125rem",
            cursor: "pointer",
          }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <EmptyState
          title="No runs found"
          description={
            statusFilter === "all"
              ? "No agent runs have been recorded yet."
              : `No runs with status "${statusFilter}".`
          }
        />
      ) : (
        <div
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Run ID</th>
                <th style={thStyle}>Agent</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Decisions</th>
                <th style={thStyle}>Cost</th>
                <th style={thStyle}>Duration</th>
                <th style={thStyle}>Started</th>
              </tr>
            </thead>
            <tbody>
              {items.map((run) => (
                <tr
                  key={run.run_id}
                  onClick={() => router.push(`/runs/${run.run_id}`)}
                  data-testid={`run-row-${run.run_id}`}
                  style={{
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                      "rgba(255, 255, 255, 0.02)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "transparent";
                  }}
                >
                  <td style={tdStyle}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--color-mono)",
                        fontSize: "0.75rem",
                      }}
                      title={run.run_id}
                    >
                      {run.run_id.slice(0, 8)}…
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div>
                      <span style={{ color: "oklch(0.82 0.00 0)" }}>
                        {run.agent_name ?? "Unknown"}
                      </span>
                      {run.agent_role && (
                        <span
                          style={{
                            display: "block",
                            fontSize: "0.6875rem",
                            fontFamily: "var(--font-mono)",
                            color: "var(--color-accent-purple)",
                            marginTop: "0.125rem",
                          }}
                        >
                          {run.agent_role}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <StatusBadge status={run.status} size="sm" />
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                      {run.total_call_count}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                      ${run.total_cost_usd.toFixed(4)}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                      {formatDuration(run.started_at, run.ended_at)}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <TimeAgo date={run.started_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <LoadMoreButton
            hasMore={!!nextCursor}
            isLoading={loadingMore}
            onLoadMore={handleLoadMore}
          />
        </div>
      )}
    </div>
  );
}
