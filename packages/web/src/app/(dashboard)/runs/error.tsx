// SPDX-License-Identifier: AGPL-3.0-only
"use client";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RunsError({ error, reset }: ErrorProps) {
  return (
    <div
      style={{
        padding: "2rem",
        backgroundColor: "rgba(255, 59, 59, 0.05)",
        border: "1px solid rgba(255, 59, 59, 0.2)",
        borderRadius: "0.5rem",
        textAlign: "center",
      }}
    >
      <p style={{ color: "var(--color-accent-red)", fontWeight: "500", marginBottom: "0.5rem" }}>
        Failed to load runs
      </p>
      <p style={{ color: "oklch(0.55 0.00 0)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        {error.message}
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          padding: "0.375rem 0.875rem",
          backgroundColor: "transparent",
          border: "1px solid var(--color-border)",
          borderRadius: "0.375rem",
          color: "oklch(0.65 0.00 0)",
          cursor: "pointer",
          fontSize: "0.875rem",
        }}
      >
        Retry
      </button>
    </div>
  );
}
