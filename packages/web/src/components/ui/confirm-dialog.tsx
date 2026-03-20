// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ConfirmDialog — generic confirmation modal.
 *
 * Client component. Renders a modal overlay with title, message,
 * and confirm/cancel buttons.
 */

"use client";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
  isLoading,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <dialog
      aria-labelledby="confirm-dialog-title"
      data-testid="confirm-dialog"
      open
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        border: "none",
        background: "none",
        maxWidth: "100vw",
        maxHeight: "100vh",
        width: "100%",
        height: "100%",
      }}
    >
      {/* Overlay — keyboard-accessible close trigger */}
      <button
        type="button"
        aria-label="Close dialog"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          border: "none",
          cursor: "default",
          width: "100%",
          height: "100%",
        }}
        onClick={onCancel}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter" || e.key === " ") onCancel();
        }}
      />

      {/* Dialog panel */}
      <div
        style={{
          position: "relative",
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "0.5rem",
          padding: "1.5rem",
          width: "100%",
          maxWidth: "24rem",
          zIndex: 1,
        }}
      >
        <h3
          id="confirm-dialog-title"
          style={{
            fontSize: "1rem",
            fontWeight: "600",
            color: "oklch(0.85 0.00 0)",
            margin: "0 0 0.5rem",
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: "0.875rem",
            color: "oklch(0.60 0.00 0)",
            margin: "0 0 1.25rem",
          }}
        >
          {message}
        </p>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "transparent",
              border: "1px solid var(--color-border)",
              borderRadius: "0.375rem",
              color: "oklch(0.65 0.00 0)",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            data-testid="btn-confirm"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: danger ? "rgba(255, 59, 59, 0.15)" : "rgba(255, 107, 0, 0.15)",
              border: `1px solid ${danger ? "rgba(255, 59, 59, 0.4)" : "rgba(255, 107, 0, 0.4)"}`,
              borderRadius: "0.375rem",
              color: danger ? "var(--color-accent-red)" : "var(--color-accent-amber)",
              fontSize: "0.875rem",
              fontWeight: "500",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
