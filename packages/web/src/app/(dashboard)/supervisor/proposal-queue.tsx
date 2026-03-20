// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ProposalQueue — supervisor proposal list with approve/reject actions.
 *
 * Client component. Shows pending proposals with approve and reject
 * buttons. Reject requires a reason (mandatory for audit trail).
 *
 * Layer 2 (Supervisor) visual treatment throughout.
 */

"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time-ago";
import { trpc } from "@/lib/trpc-client";
import { useState } from "react";

type ProposalItem = {
  id: string;
  proposal_type: string;
  target_agent: string | null;
  rationale: string | null;
  confidence: number | null;
  supporting_runs: string[] | null;
  status: string;
  // created_at arrives as ISO string when serialized across server→client boundary
  created_at: Date | string;
};

type StatusFilter = "pending" | "approved" | "rejected" | "all";

interface ProposalQueueProps {
  initialItems: ProposalItem[];
  initialNextCursor: string | null;
}

const PROPOSAL_TYPE_LABELS: Record<string, string> = {
  budget_adjustment: "Budget Adjustment",
  policy_change: "Policy Change",
  agent_profile_update: "Agent Profile Update",
  flag_for_review: "Flag for Review",
};

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  let color: string;
  let bg: string;
  if (pct >= 80) {
    color = "var(--color-accent-green)";
    bg = "rgba(0, 200, 83, 0.1)";
  } else if (pct >= 60) {
    color = "var(--color-accent-amber)";
    bg = "rgba(255, 107, 0, 0.1)";
  } else {
    color = "oklch(0.55 0.00 0)";
    bg = "rgba(100, 100, 100, 0.1)";
  }
  return (
    <span
      style={{
        padding: "0.125rem 0.375rem",
        backgroundColor: bg,
        borderRadius: "0.25rem",
        fontSize: "0.6875rem",
        fontFamily: "var(--font-mono)",
        color,
      }}
      data-testid="confidence-badge"
    >
      {pct}% confidence
    </span>
  );
}

function ProposalCard({
  item,
  onApprove,
  onReject,
}: {
  item: ProposalItem;
  onApprove: (id: string, notes?: string) => void;
  onReject: (id: string, notes: string) => void;
}) {
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
  const [notes, setNotes] = useState("");
  const [notesError, setNotesError] = useState<string | null>(null);

  function handleApprove() {
    onApprove(item.id, notes);
    setAction(null);
  }

  function handleReject() {
    if (!notes.trim()) {
      setNotesError("Rejection reason is required");
      return;
    }
    setNotesError(null);
    onReject(item.id, notes);
    setAction(null);
  }

  return (
    <div
      data-testid={`proposal-card-${item.id}`}
      style={{
        backgroundColor: "var(--color-surface)",
        border: "1px solid rgba(196, 169, 107, 0.2)",
        borderRadius: "0.5rem",
        padding: "1rem",
        borderLeft: "3px solid rgba(196, 169, 107, 0.4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "0.5rem",
          marginBottom: "0.625rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span
            style={{
              padding: "0.125rem 0.5rem",
              backgroundColor: "rgba(196, 169, 107, 0.1)",
              border: "1px solid rgba(196, 169, 107, 0.25)",
              borderRadius: "0.25rem",
              fontSize: "0.6875rem",
              fontFamily: "var(--font-mono)",
              color: "var(--color-supervisor)",
            }}
          >
            {PROPOSAL_TYPE_LABELS[item.proposal_type] ?? item.proposal_type}
          </span>
          {item.confidence !== null && <ConfidenceBadge confidence={item.confidence} />}
        </div>
        <TimeAgo date={item.created_at} />
      </div>

      {item.target_agent && (
        <p
          style={{
            fontSize: "0.75rem",
            color: "oklch(0.55 0.00 0)",
            margin: "0 0 0.5rem",
            fontFamily: "var(--font-mono)",
          }}
        >
          Target: {item.target_agent}
        </p>
      )}

      {item.rationale && (
        <p
          style={{
            fontSize: "0.8125rem",
            color: "oklch(0.70 0.00 0)",
            margin: "0 0 0.625rem",
            fontStyle: "italic",
          }}
        >
          {item.rationale}
        </p>
      )}

      {item.supporting_runs && item.supporting_runs.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <span
            style={{
              fontSize: "0.6875rem",
              color: "oklch(0.50 0.00 0)",
              display: "block",
              marginBottom: "0.25rem",
            }}
          >
            Supporting runs:
          </span>
          <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
            {item.supporting_runs.map((runId) => (
              <a
                key={runId}
                href={`/runs/${runId}`}
                style={{
                  fontSize: "0.6875rem",
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-accent-amber)",
                  textDecoration: "none",
                }}
              >
                {runId.slice(0, 8)}…
              </a>
            ))}
          </div>
        </div>
      )}

      {action === null && (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={() => setAction("approve")}
            data-testid={`btn-approve-${item.id}`}
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
            Approve
          </button>
          <button
            type="button"
            onClick={() => setAction("reject")}
            data-testid={`btn-reject-${item.id}`}
            style={{
              padding: "0.375rem 0.75rem",
              backgroundColor: "transparent",
              border: "1px solid var(--color-border)",
              borderRadius: "0.375rem",
              color: "oklch(0.60 0.00 0)",
              fontSize: "0.8125rem",
              cursor: "pointer",
            }}
          >
            Reject
          </button>
        </div>
      )}

      {action !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              if (notesError) setNotesError(null);
            }}
            rows={2}
            placeholder={
              action === "reject" ? "Rejection reason (required)…" : "Optional approval notes…"
            }
            data-testid={`${action}-notes-${item.id}`}
            style={{
              width: "100%",
              padding: "0.5rem",
              backgroundColor: "var(--color-bg)",
              border: `1px solid ${notesError ? "rgba(255, 59, 59, 0.5)" : "var(--color-border)"}`,
              borderRadius: "0.375rem",
              color: "oklch(0.80 0.00 0)",
              fontSize: "0.8125rem",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {notesError && (
            <p style={{ fontSize: "0.75rem", color: "var(--color-accent-red)", margin: 0 }}>
              {notesError}
            </p>
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={action === "approve" ? handleApprove : handleReject}
              data-testid={`btn-confirm-${action}-${item.id}`}
              style={{
                padding: "0.375rem 0.75rem",
                backgroundColor:
                  action === "approve" ? "rgba(0, 200, 83, 0.1)" : "rgba(255, 59, 59, 0.08)",
                border: `1px solid ${action === "approve" ? "rgba(0, 200, 83, 0.3)" : "rgba(255, 59, 59, 0.3)"}`,
                borderRadius: "0.375rem",
                color:
                  action === "approve" ? "var(--color-accent-green)" : "var(--color-accent-red)",
                fontSize: "0.8125rem",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Confirm {action === "approve" ? "Approval" : "Rejection"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAction(null);
                setNotes("");
                setNotesError(null);
              }}
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
      )}
    </div>
  );
}

export function ProposalQueue({ initialItems, initialNextCursor: _nc }: ProposalQueueProps) {
  const [items, setItems] = useState<ProposalItem[]>(initialItems);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");

  const utils = trpc.useUtils();

  const approveMutation = trpc.supervisor.approveProposal.useMutation({
    onSuccess: (result) => {
      setItems((prev) => prev.filter((p) => p.id !== result.id));
    },
  });

  const rejectMutation = trpc.supervisor.rejectProposal.useMutation({
    onSuccess: (result) => {
      setItems((prev) => prev.filter((p) => p.id !== result.id));
    },
  });

  async function handleFilterChange(filter: StatusFilter) {
    setStatusFilter(filter);
    try {
      const result = await utils.supervisor.listProposals.fetch({
        status: filter === "all" ? undefined : filter,
        limit: 20,
      });
      setItems(result.items);
    } catch {
      // Keep current items on error
    }
  }

  const STATUS_TABS: { value: StatusFilter; label: string }[] = [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
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
          Proposals
        </h2>
        {items.length > 0 && statusFilter === "pending" && (
          <span
            style={{
              padding: "0.125rem 0.375rem",
              backgroundColor: "rgba(196, 169, 107, 0.15)",
              border: "1px solid rgba(196, 169, 107, 0.3)",
              borderRadius: "9999px",
              fontSize: "0.6875rem",
              fontWeight: "600",
              color: "var(--color-supervisor)",
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
            data-testid={`proposal-filter-${tab.value}`}
            style={{
              padding: "0.25rem 0.625rem",
              backgroundColor:
                statusFilter === tab.value ? "rgba(196, 169, 107, 0.1)" : "transparent",
              border: `1px solid ${statusFilter === tab.value ? "rgba(196, 169, 107, 0.3)" : "var(--color-border)"}`,
              borderRadius: "0.25rem",
              color: statusFilter === tab.value ? "var(--color-supervisor)" : "oklch(0.55 0.00 0)",
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
          title="No pending proposals"
          description="The AI Supervisor has no pending proposals requiring your review."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {items.map((item) => (
            <ProposalCard
              key={item.id}
              item={item}
              onApprove={(id, notes) => approveMutation.mutate({ id, review_notes: notes })}
              onReject={(id, notes) => rejectMutation.mutate({ id, review_notes: notes })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
