// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Auth layout — centered card layout for sign-in and sign-up pages.
 *
 * No sidebar or header. Just a centered card on the dark background.
 */

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--color-bg)",
        padding: "1rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "24rem",
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "0.5rem",
          padding: "2rem",
        }}
      >
        <div style={{ marginBottom: "1.5rem", textAlign: "center" }}>
          <h1
            style={{
              fontSize: "1.25rem",
              fontWeight: "600",
              color: "oklch(0.92 0.00 0)",
              margin: 0,
            }}
          >
            LoopStorm Guard
          </h1>
          <p
            style={{
              fontSize: "0.75rem",
              color: "oklch(0.55 0.00 0)",
              marginTop: "0.25rem",
              marginBottom: 0,
            }}
          >
            Runtime enforcement for AI agents
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
