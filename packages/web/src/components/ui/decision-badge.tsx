// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DecisionBadge — colored pill for enforcement decision types.
 *
 * Layer 1 (enforcement plane) component. Clinical, mechanical styling.
 * No supervisor styling here — supervisor analysis uses separate components.
 *
 * Design system rules:
 * - allow: emerald, no border
 * - deny: red, no border
 * - cooldown: orange/amber, no border
 * - kill: red WITH 2px border (visually distinct from deny)
 * - require_approval: amber/purple, amber border
 */

type Decision = "allow" | "deny" | "cooldown" | "kill" | "require_approval" | string;

interface DecisionBadgeProps {
  decision: Decision;
  size?: "sm" | "md";
}

const DECISION_STYLES: Record<string, React.CSSProperties> = {
  allow: {
    backgroundColor: "rgba(0, 200, 83, 0.15)",
    color: "var(--color-accent-green)",
    border: "1px solid rgba(0, 200, 83, 0.3)",
  },
  deny: {
    backgroundColor: "rgba(255, 59, 59, 0.15)",
    color: "var(--color-accent-red)",
    border: "1px solid rgba(255, 59, 59, 0.3)",
  },
  cooldown: {
    backgroundColor: "rgba(255, 107, 0, 0.15)",
    color: "var(--color-accent-amber)",
    border: "1px solid rgba(255, 107, 0, 0.3)",
  },
  kill: {
    backgroundColor: "rgba(255, 59, 59, 0.15)",
    color: "var(--color-accent-red)",
    // KILL must have 2px solid border to distinguish from deny
    border: "2px solid var(--color-accent-red)",
    fontWeight: "700",
  },
  require_approval: {
    backgroundColor: "rgba(155, 109, 255, 0.15)",
    color: "var(--color-accent-purple)",
    border: "1px solid rgba(155, 109, 255, 0.4)",
  },
};

const DECISION_LABELS: Record<string, string> = {
  allow: "allow",
  deny: "deny",
  cooldown: "cooldown",
  kill: "kill",
  require_approval: "approval required",
};

export function DecisionBadge({ decision, size = "md" }: DecisionBadgeProps) {
  const style = DECISION_STYLES[decision] ?? {
    backgroundColor: "rgba(100, 100, 100, 0.15)",
    color: "oklch(0.65 0.00 0)",
    border: "1px solid rgba(100, 100, 100, 0.3)",
  };

  const label = DECISION_LABELS[decision] ?? decision;

  const paddingStyle =
    size === "sm"
      ? { padding: "0.125rem 0.375rem", fontSize: "0.6875rem" }
      : { padding: "0.2rem 0.5rem", fontSize: "0.75rem" };

  return (
    <span
      data-testid={`decision-badge-${decision}`}
      style={{
        ...style,
        ...paddingStyle,
        borderRadius: "0.25rem",
        fontFamily: "var(--font-mono)",
        fontWeight: style.fontWeight ?? "500",
        textTransform: "lowercase",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {label}
    </span>
  );
}
