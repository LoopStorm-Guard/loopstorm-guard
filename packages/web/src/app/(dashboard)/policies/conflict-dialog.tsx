// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ConflictDialog — optimistic concurrency conflict resolution.
 *
 * Displayed when a policy update returns CONFLICT (409) — meaning another
 * user modified the policy since the current user loaded it.
 *
 * Options:
 * - "Re-fetch and edit": reload the current version, losing edits
 * - "Overwrite": re-submit with the latest version number (force save)
 */

"use client";

interface ConflictDialogProps {
  open: boolean;
  currentVersion: number;
  storedVersion: number;
  onRefetch: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function ConflictDialog({
  open,
  currentVersion,
  storedVersion,
  onRefetch,
  onOverwrite,
  onCancel,
  isLoading,
}: ConflictDialogProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
      data-testid="conflict-dialog"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      {/* Overlay */}
      <div
        style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0, 0, 0, 0.6)" }}
        onClick={onCancel}
      />

      {/* Dialog */}
      <div
        style={{
          position: "relative",
          backgroundColor: "var(--color-surface)",
          border: "1px solid rgba(255, 107, 0, 0.4)",
          borderRadius: "0.5rem",
          padding: "1.5rem",
          width: "100%",
          maxWidth: "28rem",
          zIndex: 1,
        }}
      >
        <h3
          id="conflict-dialog-title"
          style={{
            fontSize: "1rem",
            fontWeight: "600",
            color: "var(--color-accent-amber)",
            margin: "0 0 0.5rem",
          }}
        >
          Edit conflict detected
        </h3>
        <p style={{ fontSize: "0.875rem", color: "oklch(0.65 0.00 0)", margin: "0 0 0.75rem" }}>
          This policy was modified by another user while you were editing.
        </p>
        <div
          style={{
            display: "flex",
            gap: "1.5rem",
            padding: "0.625rem 0.875rem",
            backgroundColor: "rgba(255, 107, 0, 0.06)",
            border: "1px solid rgba(255, 107, 0, 0.2)",
            borderRadius: "0.375rem",
            marginBottom: "1.25rem",
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
          }}
        >
          <div>
            <div style={{ color: "oklch(0.50 0.00 0)", marginBottom: "0.125rem" }}>Your version</div>
            <div style={{ color: "oklch(0.80 0.00 0)" }}>v{currentVersion}</div>
          </div>
          <div>
            <div style={{ color: "oklch(0.50 0.00 0)", marginBottom: "0.125rem" }}>Current version</div>
            <div style={{ color: "var(--color-accent-amber)" }}>v{storedVersion}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexDirection: "column" }}>
          <button
            type="button"
            onClick={onRefetch}
            disabled={isLoading}
            data-testid="btn-conflict-refetch"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "rgba(255, 107, 0, 0.1)",
              border: "1px solid rgba(255, 107, 0, 0.4)",
              borderRadius: "0.375rem",
              color: "var(--color-accent-amber)",
              fontSize: "0.875rem",
              fontWeight: "500",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            Re-fetch and edit — discard my changes, load current version
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            disabled={isLoading}
            data-testid="btn-conflict-overwrite"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "rgba(255, 59, 59, 0.08)",
              border: "1px solid rgba(255, 59, 59, 0.3)",
              borderRadius: "0.375rem",
              color: "var(--color-accent-red)",
              fontSize: "0.875rem",
              fontWeight: "500",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            Overwrite — save my version, discard their changes
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "transparent",
              border: "1px solid var(--color-border)",
              borderRadius: "0.375rem",
              color: "oklch(0.55 0.00 0)",
              fontSize: "0.875rem",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            Cancel — stay on the edit page
          </button>
        </div>
      </div>
    </div>
  );
}
