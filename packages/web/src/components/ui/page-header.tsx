// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PageHeader — page title with optional description and action buttons.
 *
 * Server component.
 */

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: "1.5rem",
        gap: "1rem",
      }}
    >
      <div>
        <h1
          style={{
            fontSize: "1.125rem",
            fontWeight: "600",
            color: "oklch(0.88 0.00 0)",
            margin: 0,
          }}
        >
          {title}
        </h1>
        {description && (
          <p
            style={{
              fontSize: "0.8125rem",
              color: "oklch(0.55 0.00 0)",
              margin: "0.25rem 0 0",
            }}
          >
            {description}
          </p>
        )}
      </div>
      {actions && <div style={{ flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}
