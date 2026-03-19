// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EventDetail — expandable event card with full event data.
 *
 * Client component. Shows event args (via JsonViewer), rule_id, reason,
 * model, tokens, cost, latency when expanded.
 *
 * Hash fields: truncated to 16 chars + "…", JetBrains Mono, tooltip.
 * Tool names: JetBrains Mono, var(--color-mono).
 * Redacted fields: displayed as-is, never unmasked.
 */

"use client";

import { useState } from "react";
import { DecisionBadge } from "@/components/ui/decision-badge";
import { JsonViewer } from "@/components/ui/json-viewer";

type EventItem = {
  id: string;
  seq: number;
  event_type: string;
  ts: Date;
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

interface EventDetailProps {
  event: EventItem;
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "oklch(0.50 0.00 0)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "0.125rem",
};

const fieldValueStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "oklch(0.75 0.00 0)",
};

function HashField({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={fieldLabelStyle}>{label}</div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
          color: "var(--color-mono)",
        }}
        title={`${label}: ${value} (SHA-256, tamper-evident chain link)`}
      >
        {value.slice(0, 16)}…
      </span>
    </div>
  );
}

export function EventDetail({ event }: EventDetailProps) {
  const [expanded, setExpanded] = useState(false);

  // Supervisor events get distinct visual treatment (Layer 2)
  const isSupervisorEvent = event.event_type.startsWith("supervisor_");

  const borderColor = isSupervisorEvent ? "rgba(196, 169, 107, 0.3)" : "var(--color-border)";
  const bgColor = isSupervisorEvent ? "rgba(196, 169, 107, 0.03)" : "rgba(255, 255, 255, 0.01)";

  return (
    <div
      style={{
        borderLeft: `2px solid ${borderColor}`,
        backgroundColor: bgColor,
        borderRadius: "0 0.375rem 0.375rem 0",
        marginBottom: "0.375rem",
        overflow: "hidden",
      }}
    >
      {/* Summary row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        data-testid={`event-detail-${event.seq}`}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 0.75rem",
          backgroundColor: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          flexWrap: "wrap",
        }}
      >
        {/* Seq number */}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.6875rem",
            color: "oklch(0.45 0.00 0)",
            minWidth: "2.5rem",
          }}
        >
          #{event.seq}
        </span>

        {/* Timestamp */}
        <span style={{ fontSize: "0.6875rem", color: "oklch(0.50 0.00 0)", minWidth: "5rem" }}>
          {event.ts.toLocaleTimeString()}
        </span>

        {/* Event type */}
        <span
          style={{
            fontSize: "0.75rem",
            color: isSupervisorEvent ? "var(--color-supervisor)" : "oklch(0.65 0.00 0)",
            fontStyle: isSupervisorEvent ? "italic" : "normal",
            minWidth: "8rem",
          }}
        >
          {event.event_type}
        </span>

        {/* Tool name */}
        {event.tool && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              color: "var(--color-mono)",
            }}
          >
            {event.tool}
          </span>
        )}

        {/* Decision badge */}
        {event.decision && (
          <DecisionBadge decision={event.decision} size="sm" />
        )}

        {/* Latency */}
        {event.latency_ms !== null && (
          <span style={{ marginLeft: "auto", fontSize: "0.6875rem", color: "oklch(0.45 0.00 0)", fontFamily: "var(--font-mono)" }}>
            {event.latency_ms}ms
          </span>
        )}

        {/* Expand indicator */}
        <span style={{ fontSize: "0.625rem", color: "oklch(0.40 0.00 0)", marginLeft: "0.25rem" }}>
          {expanded ? "▼" : "▶"}
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            padding: "0.75rem",
            borderTop: "1px solid var(--color-border)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(12rem, 1fr))",
            gap: "0.75rem",
          }}
        >
          <HashField value={event.hash} label="Event Hash" />

          {event.args_hash && <HashField value={event.args_hash} label="Args Hash" />}

          {event.rule_id && (
            <div>
              <div style={fieldLabelStyle}>Rule</div>
              <span style={{ ...fieldValueStyle, fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--color-mono)" }}>
                {event.rule_id}
              </span>
            </div>
          )}

          {event.reason && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={fieldLabelStyle}>Reason</div>
              <span style={{ ...fieldValueStyle, color: "oklch(0.65 0.00 0)" }}>
                {event.reason}
              </span>
            </div>
          )}

          {event.model && (
            <div>
              <div style={fieldLabelStyle}>Model</div>
              <span style={{ ...fieldValueStyle, fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                {event.model}
              </span>
            </div>
          )}

          {event.input_tokens !== null && (
            <div>
              <div style={fieldLabelStyle}>Input Tokens</div>
              <span style={{ ...fieldValueStyle, fontFamily: "var(--font-mono)" }}>
                {event.input_tokens.toLocaleString()}
              </span>
            </div>
          )}

          {event.output_tokens !== null && (
            <div>
              <div style={fieldLabelStyle}>Output Tokens</div>
              <span style={{ ...fieldValueStyle, fontFamily: "var(--font-mono)" }}>
                {event.output_tokens.toLocaleString()}
              </span>
            </div>
          )}

          {event.estimated_cost_usd !== null && (
            <div>
              <div style={fieldLabelStyle}>Cost</div>
              <span style={{ ...fieldValueStyle, fontFamily: "var(--font-mono)" }}>
                ${event.estimated_cost_usd.toFixed(6)}
              </span>
            </div>
          )}

          {/* Args (redacted) — display as-is, never unmask */}
          {event.args_redacted !== null && event.args_redacted !== undefined && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ ...fieldLabelStyle, marginBottom: "0.375rem" }}>
                Args (redacted)
              </div>
              <JsonViewer data={event.args_redacted} initiallyExpanded={false} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
