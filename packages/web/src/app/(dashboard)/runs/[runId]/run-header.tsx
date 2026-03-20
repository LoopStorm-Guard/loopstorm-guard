// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RunHeader — run metadata display with chain badge and budget bars.
 *
 * Renders:
 * - Agent name, role, environment, policy pack ID
 * - StatusBadge for run status
 * - ChainBadge (client) — verifies chain integrity on mount
 * - BudgetBar components for cost, input tokens, output tokens, call count
 * - Duration, started_at, ended_at
 */

import { BudgetBar } from "@/components/ui/budget-bar";
import { ChainBadge } from "@/components/ui/chain-badge";
import { StatusBadge } from "@/components/ui/status-badge";

type Run = {
  run_id: string;
  agent_name: string | null;
  agent_role: string | null;
  environment: string | null;
  policy_pack_id: string | null;
  status: string;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_call_count: number;
  event_count: number;
  started_at: string | null;
  ended_at: string | null;
};

interface RunHeaderProps {
  run: Run;
}

function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt) return "—";
  if (!endedAt) return "Still running";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

const metaItemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.125rem",
};

const metaLabelStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "oklch(0.50 0.00 0)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const metaValueStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "oklch(0.78 0.00 0)",
};

export function RunHeader({ run }: RunHeaderProps) {
  const duration = formatDuration(run.started_at, run.ended_at);

  return (
    <div
      style={{
        backgroundColor: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        padding: "1.25rem",
      }}
    >
      {/* Top row: status + chain badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
        }}
      >
        <StatusBadge status={run.status} />
        <ChainBadge runId={run.run_id} />
      </div>

      {/* Metadata grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(10rem, 1fr))",
          gap: "0.875rem",
          marginBottom: "1rem",
        }}
      >
        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>Run ID</span>
          <span
            style={{
              ...metaValueStyle,
              fontFamily: "var(--font-mono)",
              color: "var(--color-mono)",
              fontSize: "0.75rem",
            }}
            title={run.run_id}
          >
            {run.run_id.slice(0, 16)}…
          </span>
        </div>

        {run.agent_role && (
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>Role</span>
            <span
              style={{
                ...metaValueStyle,
                fontFamily: "var(--font-mono)",
                color: "var(--color-accent-purple)",
              }}
            >
              {run.agent_role}
            </span>
          </div>
        )}

        {run.environment && (
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>Environment</span>
            <span style={metaValueStyle}>{run.environment}</span>
          </div>
        )}

        {run.policy_pack_id && (
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>Policy Pack</span>
            <span
              style={{
                ...metaValueStyle,
                fontFamily: "var(--font-mono)",
                color: "var(--color-mono)",
                fontSize: "0.75rem",
              }}
              title={run.policy_pack_id}
            >
              {run.policy_pack_id.slice(0, 8)}…
            </span>
          </div>
        )}

        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>Duration</span>
          <span style={{ ...metaValueStyle, fontFamily: "var(--font-mono)" }}>{duration}</span>
        </div>

        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>Events</span>
          <span style={{ ...metaValueStyle, fontFamily: "var(--font-mono)" }}>
            {run.event_count}
          </span>
        </div>

        <div style={metaItemStyle}>
          <span style={metaLabelStyle}>Started</span>
          <span style={{ ...metaValueStyle, fontSize: "0.75rem" }}>
            {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
          </span>
        </div>

        {run.ended_at && (
          <div style={metaItemStyle}>
            <span style={metaLabelStyle}>Ended</span>
            <span style={{ ...metaValueStyle, fontSize: "0.75rem" }}>
              {new Date(run.ended_at).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* Budget bars — only show if there is meaningful budget data */}
      {(run.total_cost_usd > 0 || run.total_call_count > 0) && (
        <div
          style={{
            borderTop: "1px solid var(--color-border)",
            paddingTop: "0.875rem",
            marginTop: "0.875rem",
          }}
        >
          <span
            style={{
              fontSize: "0.6875rem",
              color: "oklch(0.50 0.00 0)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              display: "block",
              marginBottom: "0.5rem",
            }}
          >
            Resource Usage
          </span>
          {run.total_cost_usd > 0 && (
            <BudgetBar
              label="Cost (USD)"
              used={run.total_cost_usd}
              cap={Math.max(run.total_cost_usd * 1.5, 0.01)}
              unit="$"
              formatValue={(v) => `$${v.toFixed(4)}`}
            />
          )}
          {run.total_call_count > 0 && (
            <BudgetBar
              label="Tool Calls"
              used={run.total_call_count}
              cap={Math.max(run.total_call_count * 1.5, 1)}
            />
          )}
          {run.total_input_tokens > 0 && (
            <BudgetBar
              label="Input Tokens"
              used={run.total_input_tokens}
              cap={Math.max(run.total_input_tokens * 1.5, 1)}
            />
          )}
          {run.total_output_tokens > 0 && (
            <BudgetBar
              label="Output Tokens"
              used={run.total_output_tokens}
              cap={Math.max(run.total_output_tokens * 1.5, 1)}
            />
          )}
        </div>
      )}
    </div>
  );
}
