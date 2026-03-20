// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EscalationQueue — live escalation list with acknowledge action.
 *
 * Client component. Polls every 5 seconds (Realtime in v1.1).
 * The escalate_to_human invariant ensures this always renders.
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
  // created_at arrives as ISO string when serialized across server→client boundary
  created_at: Date | string;
  trigger_run_id: string | null;
};

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
}: { item: EscalationItem; onAcknowledge: (id: string, notes?: string) => void }) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");

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
              onClick={() => onAcknowledge(item.id, notes)}
              data-testid={`btn-acknowledge-${item.id}`}
              style={{
                padding: "0.375rem 0.75rem",
                backgroundColor: "rgba(0, 200, 83, 0.1)",
                border: "1px solid rgba(0, 200, 83, 0.3)",
                borderRadius: "0.375rem",
                color: "var(--color-accent-green)",
                fontSize: "0.8125rem",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Acknowledge
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
        <button
          type="button"
          onClick={() => setShowNotes(true)}
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
    </div>
  );
}

export function EscalationQueue({ initialItems, initialNextCursor: _nc }: EscalationQueueProps) {
  const [items, setItems] = useState<EscalationItem[]>(initialItems);

  const acknowledgeMutation = trpc.supervisor.acknowledgeEscalation.useMutation({
    onSuccess: (result) => {
      setItems((prev) => prev.filter((e) => e.id !== result.id));
    },
  });

  function handleAcknowledge(id: string, notes?: string) {
    acknowledgeMutation.mutate({ id, resolution_notes: notes });
  }

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
        {items.length > 0 && (
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

      {items.length === 0 ? (
        <EmptyState
          title="No active escalations"
          description="All clear — no open escalations requiring attention."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {items.map((item) => (
            <EscalationCard key={item.id} item={item} onAcknowledge={handleAcknowledge} />
          ))}
        </div>
      )}
    </div>
  );
}
