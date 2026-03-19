// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CreateKeyDialog — API key creation modal with one-time key display.
 *
 * The raw key is shown once after creation with a prominent copy box.
 * The dialog cannot be dismissed until the user confirms they've copied the key.
 *
 * Design system: the key display box uses JetBrains Mono with the mono color.
 */

"use client";

import { useState } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { trpc } from "@/lib/trpc-client";

type ApiKeyItem = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: Date | null;
  expires_at: Date | null;
  is_revoked: boolean;
  created_at: Date;
};

interface CreateKeyDialogProps {
  onClose: () => void;
  onCreated: (key: ApiKeyItem) => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  backgroundColor: "#0a0a0a",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  color: "oklch(0.85 0.00 0)",
  fontSize: "0.875rem",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: "500",
  color: "oklch(0.65 0.00 0)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "0.25rem",
};

export function CreateKeyDialog({ onClose, onCreated }: CreateKeyDialogProps) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["ingest"]);
  const [expiryDays, setExpiryDays] = useState<string>("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (result) => {
      setCreatedKey(result.key);
      // Add the new key to the parent list
      onCreated({
        id: result.id,
        name,
        key_prefix: result.key_prefix,
        scopes,
        last_used_at: null,
        expires_at: expiryDays ? new Date(Date.now() + parseInt(expiryDays, 10) * 86400000) : null,
        is_revoked: false,
        created_at: new Date(),
      });
    },
  });

  function handleScopeToggle(scope: string) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (scopes.length === 0) return;
    createMutation.mutate({
      name,
      scopes: scopes as Array<"ingest" | "read">,
      expires_in_days: expiryDays ? parseInt(expiryDays, 10) : undefined,
    });
  }

  function handleDone() {
    if (confirmed) onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-key-dialog-title"
      data-testid="create-key-dialog"
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
      {/* Overlay — not dismissible during key display */}
      <div
        style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0, 0, 0, 0.7)" }}
        onClick={createdKey ? undefined : onClose}
      />

      <div
        style={{
          position: "relative",
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "0.5rem",
          padding: "1.5rem",
          width: "100%",
          maxWidth: "28rem",
          zIndex: 1,
        }}
      >
        {!createdKey ? (
          /* Create form */
          <>
            <h3
              id="create-key-dialog-title"
              style={{ fontSize: "1rem", fontWeight: "600", color: "oklch(0.85 0.00 0)", margin: "0 0 1.25rem" }}
            >
              Create API Key
            </h3>

            {createMutation.error && (
              <div
                style={{
                  padding: "0.5rem 0.75rem",
                  backgroundColor: "rgba(255, 59, 59, 0.08)",
                  border: "1px solid rgba(255, 59, 59, 0.3)",
                  borderRadius: "0.375rem",
                  color: "var(--color-accent-red)",
                  fontSize: "0.8125rem",
                  marginBottom: "1rem",
                }}
              >
                {createMutation.error.message}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label htmlFor="key-name" style={labelStyle}>Key Name *</label>
                <input
                  id="key-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  style={inputStyle}
                  data-testid="input-key-name"
                  placeholder="e.g. prod-agent-1"
                />
              </div>

              <div>
                <span style={labelStyle}>Scopes *</span>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  {(["ingest", "read"] as const).map((scope) => (
                    <label
                      key={scope}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        cursor: "pointer",
                        fontSize: "0.875rem",
                        color: "oklch(0.70 0.00 0)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope)}
                        onChange={() => handleScopeToggle(scope)}
                        data-testid={`scope-${scope}`}
                        style={{ accentColor: "var(--color-accent-amber)" }}
                      />
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>{scope}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="key-expiry" style={labelStyle}>Expires In (days)</label>
                <input
                  id="key-expiry"
                  type="number"
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  min={1}
                  max={365}
                  style={inputStyle}
                  data-testid="input-expiry-days"
                  placeholder="Leave blank for no expiry"
                />
              </div>

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: "0.5rem 1rem",
                    backgroundColor: "transparent",
                    border: "1px solid var(--color-border)",
                    borderRadius: "0.375rem",
                    color: "oklch(0.60 0.00 0)",
                    fontSize: "0.875rem",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || scopes.length === 0}
                  data-testid="btn-create-key-submit"
                  style={{
                    padding: "0.5rem 1rem",
                    backgroundColor: "rgba(255, 107, 0, 0.15)",
                    border: "1px solid rgba(255, 107, 0, 0.4)",
                    borderRadius: "0.375rem",
                    color: "var(--color-accent-amber)",
                    fontSize: "0.875rem",
                    fontWeight: "500",
                    cursor: createMutation.isPending ? "not-allowed" : "pointer",
                    opacity: createMutation.isPending || scopes.length === 0 ? 0.6 : 1,
                  }}
                >
                  {createMutation.isPending ? "Creating…" : "Create Key"}
                </button>
              </div>
            </form>
          </>
        ) : (
          /* One-time key display — cannot dismiss until confirmed */
          <>
            <h3
              id="create-key-dialog-title"
              style={{ fontSize: "1rem", fontWeight: "600", color: "var(--color-accent-green)", margin: "0 0 0.5rem" }}
            >
              API Key Created
            </h3>

            <div
              style={{
                padding: "0.625rem 0.75rem",
                backgroundColor: "rgba(255, 107, 0, 0.06)",
                border: "1px solid rgba(255, 107, 0, 0.3)",
                borderRadius: "0.375rem",
                marginBottom: "1rem",
                fontSize: "0.8125rem",
                color: "var(--color-accent-amber)",
              }}
            >
              Copy this key now. It will not be shown again.
            </div>

            {/* Key display box */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.75rem",
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.375rem",
                marginBottom: "1.25rem",
              }}
            >
              <span
                data-testid="api-key-value"
                style={{
                  flex: 1,
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.8125rem",
                  color: "var(--color-mono)",
                  wordBreak: "break-all",
                }}
              >
                {createdKey}
              </span>
              <CopyButton value={createdKey} label="Copy" />
            </div>

            {/* Confirmation checkbox */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginBottom: "1.25rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                color: "oklch(0.70 0.00 0)",
              }}
            >
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                data-testid="checkbox-copied-key"
                style={{ accentColor: "var(--color-accent-amber)", width: "1rem", height: "1rem" }}
              />
              I have copied this key and stored it securely
            </label>

            <button
              type="button"
              onClick={handleDone}
              disabled={!confirmed}
              data-testid="btn-done-key"
              style={{
                width: "100%",
                padding: "0.5rem 1rem",
                backgroundColor: confirmed ? "rgba(0, 200, 83, 0.15)" : "rgba(100, 100, 100, 0.1)",
                border: `1px solid ${confirmed ? "rgba(0, 200, 83, 0.4)" : "rgba(100, 100, 100, 0.3)"}`,
                borderRadius: "0.375rem",
                color: confirmed ? "var(--color-accent-green)" : "oklch(0.45 0.00 0)",
                fontSize: "0.875rem",
                fontWeight: "500",
                cursor: confirmed ? "pointer" : "not-allowed",
              }}
            >
              Done — close dialog
            </button>
          </>
        )}
      </div>
    </div>
  );
}
