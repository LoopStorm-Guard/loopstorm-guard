// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EmptyState — placeholder for empty lists and pages.
 *
 * Server component. Renders a centered message with optional description
 * and action button.
 */

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "3rem 1rem",
        textAlign: "center",
        color: "oklch(0.55 0.00 0)",
      }}
      data-testid="empty-state"
    >
      <div
        style={{
          width: "2.5rem",
          height: "2.5rem",
          borderRadius: "50%",
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "0.75rem",
          fontSize: "1rem",
        }}
      >
        ○
      </div>
      <p style={{ fontWeight: "500", color: "oklch(0.70 0.00 0)", margin: "0 0 0.25rem" }}>
        {title}
      </p>
      {description && <p style={{ fontSize: "0.8125rem", margin: "0 0 0.75rem" }}>{description}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}
