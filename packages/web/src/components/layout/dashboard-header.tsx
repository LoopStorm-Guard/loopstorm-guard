// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DashboardHeader — fixed top header with tenant context and user menu.
 *
 * Server component. UserMenu (client) handles session state and sign-out.
 */

import { UserMenu } from "./user-menu";

export function DashboardHeader() {
  return (
    <header
      style={{
        height: "var(--header-height)",
        backgroundColor: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 1.25rem",
        position: "fixed",
        top: 0,
        left: "var(--sidebar-width)",
        right: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span
          style={{
            fontSize: "0.75rem",
            color: "oklch(0.45 0.00 0)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          LoopStorm Guard
        </span>
        <span style={{ color: "var(--color-border)", fontSize: "0.875rem" }}>·</span>
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--color-accent-amber)",
            fontFamily: "var(--font-mono)",
          }}
        >
          control room
        </span>
      </div>
      <UserMenu />
    </header>
  );
}
