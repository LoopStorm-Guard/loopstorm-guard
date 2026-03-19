// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BudgetBar — horizontal progress bar for budget/usage tracking.
 *
 * Design system thresholds (NON-NEGOTIABLE):
 * - Below 80%: green (var(--color-budget-ok))
 * - >= 80%: amber (var(--color-budget-warn))
 * - >= 100%: red (var(--color-budget-exceeded)) + "EXCEEDED" label
 *
 * Never shows $0.00 as a hard cap. Cap must be > 0 to render a bar.
 */

interface BudgetBarProps {
  label: string;
  used: number;
  cap: number;
  unit?: string;
  formatValue?: (v: number) => string;
}

function defaultFormat(v: number, unit: string): string {
  if (unit === "$") {
    return `$${v.toFixed(4)}`;
  }
  if (v >= 1_000_000) {
    return `${(v / 1_000_000).toFixed(1)}M`;
  }
  if (v >= 1_000) {
    return `${(v / 1_000).toFixed(1)}k`;
  }
  return `${v}`;
}

export function BudgetBar({ label, used, cap, unit = "", formatValue }: BudgetBarProps) {
  // Never render a bar with a $0.00 cap — it indicates broken data
  if (!cap || cap <= 0) {
    return null;
  }

  const pct = Math.min((used / cap) * 100, 100);
  const exceeded = used >= cap;
  const warned = pct >= 80;

  let barColor: string;
  if (exceeded) {
    barColor = "var(--color-budget-exceeded)";
  } else if (warned) {
    barColor = "var(--color-budget-warn)";
  } else {
    barColor = "var(--color-budget-ok)";
  }

  const usedStr = formatValue ? formatValue(used) : defaultFormat(used, unit);
  const capStr = formatValue ? formatValue(cap) : defaultFormat(cap, unit);

  return (
    <div style={{ marginBottom: "0.5rem" }} data-testid={`budget-bar-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.25rem",
        }}
      >
        <span style={{ fontSize: "0.6875rem", color: "oklch(0.55 0.00 0)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}
        </span>
        <span
          style={{
            fontSize: "0.6875rem",
            fontFamily: "var(--font-mono)",
            color: exceeded ? "var(--color-accent-red)" : "oklch(0.65 0.00 0)",
          }}
        >
          {exceeded && (
            <span style={{ color: "var(--color-accent-red)", fontWeight: "600", marginRight: "0.25rem" }}>
              EXCEEDED
            </span>
          )}
          {usedStr} / {capStr} &middot; {pct.toFixed(0)}%
        </span>
      </div>
      <div
        style={{
          height: "0.25rem",
          backgroundColor: "var(--color-border)",
          borderRadius: "9999px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: barColor,
            borderRadius: "9999px",
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}
