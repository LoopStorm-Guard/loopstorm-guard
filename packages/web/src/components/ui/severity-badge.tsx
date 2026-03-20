// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SeverityBadge — colored pill for supervisor escalation severity.
 *
 * Design system:
 * - low: neutral gray
 * - medium: amber
 * - high: orange
 * - critical: red with pulsing animation
 */

type Severity = "low" | "medium" | "high" | "critical" | string;

interface SeverityBadgeProps {
  severity: Severity;
  size?: "sm" | "md";
}

const SEVERITY_CONFIG: Record<
  string,
  { label: string; style: React.CSSProperties; pulse?: boolean }
> = {
  low: {
    label: "Low",
    style: {
      backgroundColor: "rgba(100, 100, 100, 0.15)",
      color: "oklch(0.65 0.00 0)",
      border: "1px solid rgba(100, 100, 100, 0.3)",
    },
  },
  medium: {
    label: "Medium",
    style: {
      backgroundColor: "rgba(255, 107, 0, 0.15)",
      color: "var(--color-accent-amber)",
      border: "1px solid rgba(255, 107, 0, 0.3)",
    },
  },
  high: {
    label: "High",
    style: {
      backgroundColor: "rgba(251, 146, 60, 0.15)",
      color: "rgb(251, 146, 60)",
      border: "1px solid rgba(251, 146, 60, 0.4)",
    },
  },
  critical: {
    label: "Critical",
    style: {
      backgroundColor: "rgba(255, 59, 59, 0.15)",
      color: "var(--color-accent-red)",
      border: "1px solid rgba(255, 59, 59, 0.4)",
    },
    pulse: true,
  },
};

export function SeverityBadge({ severity, size = "md" }: SeverityBadgeProps) {
  const config = SEVERITY_CONFIG[severity] ?? {
    label: severity,
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
      data-testid={`severity-badge-${severity}`}
      style={{
        ...config.style,
        ...paddingStyle,
        borderRadius: "0.25rem",
        fontWeight: "500",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        animation: config.pulse ? "pulse-critical 1s ease-in-out infinite" : undefined,
      }}
    >
      {config.label}
    </span>
  );
}
