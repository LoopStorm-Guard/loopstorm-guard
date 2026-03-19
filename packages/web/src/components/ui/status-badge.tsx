// SPDX-License-Identifier: AGPL-3.0-only
/**
 * StatusBadge — colored pill for agent run status values.
 *
 * Design system rules:
 * - started/running: blue (pulsing dot indicator)
 * - completed: green
 * - terminated_budget: red, "Budget Exceeded" label (NOT raw enum)
 * - terminated_loop: orange, "Loop Terminated" label (NOT raw enum)
 * - terminated_policy: red, "Policy Terminated" label
 * - abandoned: AMBER (not green — this is a warning state)
 * - error: red
 *
 * Never render raw DB enum values. Always map to human-readable strings.
 */

type RunStatus =
  | "started"
  | "completed"
  | "terminated_budget"
  | "terminated_loop"
  | "terminated_policy"
  | "abandoned"
  | "error"
  | string;

interface StatusBadgeProps {
  status: RunStatus;
  size?: "sm" | "md";
}

const STATUS_CONFIG: Record<
  string,
  { label: string; style: React.CSSProperties; pulse?: boolean }
> = {
  started: {
    label: "Running",
    style: {
      backgroundColor: "rgba(59, 130, 246, 0.15)",
      color: "rgb(96, 165, 250)",
      border: "1px solid rgba(59, 130, 246, 0.3)",
    },
    pulse: true,
  },
  completed: {
    label: "Completed",
    style: {
      backgroundColor: "rgba(0, 200, 83, 0.15)",
      color: "var(--color-accent-green)",
      border: "1px solid rgba(0, 200, 83, 0.3)",
    },
  },
  terminated_budget: {
    label: "Budget Exceeded",
    style: {
      backgroundColor: "rgba(255, 59, 59, 0.15)",
      color: "var(--color-accent-red)",
      border: "1px solid rgba(255, 59, 59, 0.3)",
    },
  },
  terminated_loop: {
    label: "Loop Terminated",
    style: {
      backgroundColor: "rgba(255, 107, 0, 0.15)",
      color: "var(--color-accent-amber)",
      border: "1px solid rgba(255, 107, 0, 0.3)",
    },
  },
  terminated_policy: {
    label: "Policy Terminated",
    style: {
      backgroundColor: "rgba(255, 59, 59, 0.15)",
      color: "var(--color-accent-red)",
      border: "1px solid rgba(255, 59, 59, 0.3)",
    },
  },
  abandoned: {
    // IMPORTANT: abandoned is AMBER, NOT green — it is a warning state
    label: "Abandoned",
    style: {
      backgroundColor: "rgba(255, 107, 0, 0.15)",
      color: "var(--color-accent-amber)",
      border: "1px solid rgba(255, 107, 0, 0.3)",
    },
  },
  error: {
    label: "Error",
    style: {
      backgroundColor: "rgba(255, 59, 59, 0.15)",
      color: "var(--color-accent-red)",
      border: "1px solid rgba(255, 59, 59, 0.3)",
    },
  },
};

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    style: {
      backgroundColor: "rgba(100, 100, 100, 0.15)",
      color: "oklch(0.60 0.00 0)",
      border: "1px solid rgba(100, 100, 100, 0.3)",
    },
  };

  const paddingStyle =
    size === "sm"
      ? { padding: "0.125rem 0.375rem", fontSize: "0.6875rem" }
      : { padding: "0.2rem 0.5rem", fontSize: "0.75rem" };

  return (
    <span
      data-testid={`status-badge-${status}`}
      style={{
        ...config.style,
        ...paddingStyle,
        borderRadius: "0.25rem",
        fontWeight: "500",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
      }}
    >
      {config.pulse && (
        <span
          style={{
            width: "0.375rem",
            height: "0.375rem",
            borderRadius: "50%",
            backgroundColor: "rgb(96, 165, 250)",
            animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
          }}
        />
      )}
      {config.label}
    </span>
  );
}
