// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EscalationQueue — live escalation list with acknowledge and resolve actions.
 *
 * Client component. Polls every 5 seconds (Realtime in v1.1).
 * The escalate_to_human invariant ensures this always renders.
 *
 * Lifecycle: open → acknowledged → resolved.
 * Status filter tabs: Open, Acknowledged, Resolved, All.
 *
 * Design rules:
 * - Severity border colors: medium → amber, high → orange, critical → red
 * - Critical severity has pulsing animation
 */

"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { TimeAgo } from "@/components/ui/time-ago";
import { trpc } from "@/lib/trpc-client";
import { useState } from "react";

type EscalationItem = {
  id: string;
  severity: string;
  rationale: string | null;
  recommendation: string | null;
  confidence: number | null;
  timeout_seconds: number | null;
  timeout_action: string | null;
  status: string;
  resolution_notes: string | null;
  // created_at arrives as ISO string when serialized across server→client boundary
  created_at: Date | string;
  trigger_run_id: string | null;
};

type StatusFilter = "open" | "acknowledged" | "resolved" | "all";

interface EscalationQueueProps {
  initialItems: EscalationItem[];
  initialNextCursor: string | null;
}

const SEVERITY_BORDER: Record<string, string> = {
  low: "var(--color-border)",
  medium: "rgba(255, 107, 0, 0.5)",
  high: "rgba(251, 146, 60, 0.6)",
  critical: "rgba(255, 59, 59, 0.7)",
};

function EscalationCard({
  item,
  onAcknowledge,
  onResolve,
}: {
  item: EscalationItem;
  onAcknowledge: (id: string, notes?: string) => void;
  onResolve: (id: string, notes?: string) => void;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [actionType, setActionType] = useState<"acknowledge" | "resolve">("acknowledge");

  const borderColor = SEVERITY_BORDER[item.severity] ?? "var(--color-border)";

  return (
    <div
      data-testid={`escalation-card-${item.id}`}
      style={{
        backgroundColor: "var(--color-surface)",
        border: `1px solid ${borderColor}`,
        borderRadius: "0.5rem",
        padding: "1rem",
        borderLeft: `3px solid ${borderColor}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "0.5rem",
          marginBottom: "0.75rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SeverityBadge severity={item.severity} />
          {item.confidence !== null && (
            <span
              style={{
                fontSize: "0.6875rem",
                color: "oklch(0.55 0.00 0)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {Math.round(item.confidence * 100)}% confidence
            </span>
          )}
        </div>
        <TimeAgo date={item.created_at} />
      </div>

      {item.rationale && (
        <p style={{ fontSize: "0.8125rem", color: "oklch(0.70 0.00 0)", margin: "0 0 0.5rem" }}>
          {item.rationale}
        </p>
      )}

      {item.recommendation && (
        <p
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-supervisor)",
            fontStyle: "italic",
            margin: "0 0 0.75rem",
          }}
        >
          Recommendation: {item.recommendation}
        </p>
      )}

      {item.timeout_action && (
        <p
          style={{
            fontSize: "0.75rem",
            color: "oklch(0.50 0.00 0)",
            margin: "0 0 0.75rem",
            fontFamily: "var(--font-mono)",
          }}
        >
          Timeout action: {item.timeout_action}
        </p>
      )}

      {item.trigger_run_id && (
        <a
          href={`/runs/${item.trigger_run_id}`}
          style={{
            display: "inline-block",
            fontSize: "0.75rem",
            color: "var(--color-accent-amber)",
            fontFamily: "var(--font-mono)",
            textDecoration: "none",
            marginBottom: "0.75rem",
          }}
        >
          View triggering run →
        </a>
      )}

      {/* Resolution notes for resolved/acknowledged escalations */}
      {item.resolution_notes && (
        <p
          style={{
            fontSize: "0.75rem",
            color: "oklch(0.55 0.00 0)",
            margin: "0 0 0.75rem",
            padding: "0.5rem",
            backgroundColor: "rgba(255, 255, 255, 0.03)",
            borderRadius: "0.25rem",
            border: "1px solid var(--color-border)",
          }}
        >
          Notes: {item.resolution_notes}
        </p>
      )}

      {showNotes ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional resolution notes…"
            data-testid="escalation-notes"
            style={{
              width: "100%",
              padding: "0.5rem",
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.375rem",
              color: "oklch(0.80 0.00 0)",
              fontSize: "0.8125rem",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => {
                if (actionType === "acknowledge") {
                  onAcknowledge(item.id, notes);
                } else {
                  onResolve(item.id, notes);
                }
              }}
              data-testid={`btn-${actionType}-${item.id}`}
              style={{
                padding: "0.375rem 0.75rem",
                backgroundColor:
                  actionType === "resolve" ? "rgba(96, 165, 250, 0.1)" : "rgba(0, 200, 83, 0.1)",
                border: `1px solid ${actionType === "resolve" ? "rgba(96, 165, 250, 0.3)" : "rgba(0, 200, 83, 0.3)"}`,
                borderRadius: "0.375rem",
                color: actionType === "resolve" ? "rgb(96, 165, 250)" : "var(--color-accent-green)",
                fontSize: "0.8125rem",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              {actionType === "resolve" ? "Resolve" : "Acknowledge"}
            </button>
            <button
              type="button"
              onClick={() => setShowNotes(false)}
              style={{
                padding: "0.375rem 0.75rem",
                backgroundColor: "transparent",
                border: "1px solid var(--color-border)",
                borderRadius: "0.375rem",
                color: "oklch(0.55 0.00 0)",
                fontSize: "0.8125rem",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {item.status === "open" && (
            <button
              type="button"
              onClick={() => {
                setActionType("acknowledge");
                setShowNotes(true);
              }}
              style={{
                padding: "0.375rem 0.75rem",
                backgroundColor: "rgba(0, 200, 83, 0.08)",
                border: "1px solid rgba(0, 200, 83, 0.25)",
                borderRadius: "0.375rem",
                color: "var(--color-accent-green)",
                fontSize: "0.8125rem",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Acknowledge
            </button>
          )}
          {item.status === "acknowledged" && (
            <button
              type="button"
              onClick={() => {
                setActionType("resolve");
                setShowNotes(true);
              }}
              data-testid={`btn-resolve-${item.id}`}
              style={{
                padding: "0.375rem 0.75rem",
                backgroundColor: "rgba(96, 165, 250, 0.08)",
                border: "1px solid rgba(96, 165, 250, 0.25)",
                borderRadius: "0.375rem",
                color: "rgb(96, 165, 250)",
                fontSize: "0.8125rem",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Resolve
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function EscalationQueue({ initialItems, initialNextCursor: _nc }: EscalationQueueProps) {
  const [items, setItems] = useState<EscalationItem[]>(initialItems);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");

  const utils = trpc.useUtils();

  const acknowledgeMutation = trpc.supervisor.acknowledgeEscalation.useMutation({
    onSuccess: (result) => {
      setItems((prev) => prev.filter((e) => e.id !== result.id));
    },
  });

  const resolveMutation = trpc.supervisor.resolveEscalation.useMutation({
    onSuccess: (result) => {
      setItems((prev) => prev.filter((e) => e.id !== result.id));
    },
  });

  function handleAcknowledge(id: string, notes?: string) {
    acknowledgeMutation.mutate({ id, resolution_notes: notes });
  }

  function handleResolve(id: string, notes?: string) {
    resolveMutation.mutate({ id, resolution_notes: notes });
  }

  async function handleFilterChange(filter: StatusFilter) {
    setStatusFilter(filter);
    try {
      const result = await utils.supervisor.listEscalations.fetch({
        status: filter === "all" ? undefined : filter,
        limit: 20,
      });
      setItems(result.items);
    } catch {
      // Keep current items on error
    }
  }

  const STATUS_TABS: { value: StatusFilter; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "acknowledged", label: "Acknowledged" },
    { value: "resolved", label: "Resolved" },
    { value: "all", label: "All" },
  ];

  return (
    <div>
      <div
        style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.875rem" }}
      >
        <h2
          style={{
            fontSize: "0.875rem",
            fontWeight: "600",
            color: "oklch(0.70 0.00 0)",
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Escalations
        </h2>
        {items.length > 0 && statusFilter === "open" && (
          <span
            style={{
              padding: "0.125rem 0.375rem",
              backgroundColor: "rgba(255, 59, 59, 0.15)",
              border: "1px solid rgba(255, 59, 59, 0.3)",
              borderRadius: "9999px",
              fontSize: "0.6875rem",
              fontWeight: "600",
              color: "var(--color-accent-red)",
            }}
          >
            {items.length}
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.875rem" }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleFilterChange(tab.value)}
            data-testid={`escalation-filter-${tab.value}`}
            style={{
              padding: "0.25rem 0.625rem",
              backgroundColor:
                statusFilter === tab.value ? "rgba(255, 59, 59, 0.1)" : "transparent",
              border: `1px solid ${statusFilter === tab.value ? "rgba(255, 59, 59, 0.3)" : "var(--color-border)"}`,
              borderRadius: "0.25rem",
              color: statusFilter === tab.value ? "var(--color-accent-red)" : "oklch(0.55 0.00 0)",
              fontSize: "0.75rem",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No escalations"
          description={
            statusFilter === "open"
              ? "All clear — no open escalations requiring attention."
              : `No ${statusFilter === "all" ? "" : statusFilter} escalations found.`
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {items.map((item) => (
            <EscalationCard
              key={item.id}
              item={item}
              onAcknowledge={handleAcknowledge}
              onResolve={handleResolve}
            />
          ))}
        </div>
      )}
    </div>
  );
}
