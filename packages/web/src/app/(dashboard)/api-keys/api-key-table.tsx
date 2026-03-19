// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ApiKeyManager — API key table with create dialog and revoke functionality.
 *
 * Client component. Handles:
 * - Displaying key list (prefix, scopes, last used, expires, status)
 * - Create key dialog with one-time key display
 * - Revoke with confirm dialog
 *
 * Security: key_hash is never returned by the backend. The raw key is only
 * shown once in the create response. We display a copy-to-clipboard box.
 */

"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { TimeAgo } from "@/components/ui/time-ago";
import { CopyButton } from "@/components/ui/copy-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CreateKeyDialog } from "./create-key-dialog";
import { trpc } from "@/lib/trpc-client";

type ApiKeyItem = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  // Dates arrive as ISO strings when serialized across server→client boundary
  last_used_at: Date | string | null;
  expires_at: Date | string | null;
  is_revoked: boolean;
  created_at: Date | string;
};

interface ApiKeyManagerProps {
  initialItems: ApiKeyItem[];
  initialNextCursor: string | null;
}

const thStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  textAlign: "left",
  fontSize: "0.6875rem",
  fontWeight: "500",
  color: "oklch(0.50 0.00 0)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid var(--color-border)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "0.625rem 0.75rem",
  fontSize: "0.8125rem",
  color: "oklch(0.75 0.00 0)",
  borderBottom: "1px solid rgba(31, 31, 31, 0.5)",
  verticalAlign: "middle",
};

function getKeyStatus(key: ApiKeyItem): { label: string; color: string } {
  if (key.is_revoked) return { label: "Revoked", color: "var(--color-accent-red)" };
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return { label: "Expired", color: "oklch(0.55 0.00 0)" };
  }
  return { label: "Active", color: "var(--color-accent-green)" };
}

export function ApiKeyManager({ initialItems, initialNextCursor: _initialNextCursor }: ApiKeyManagerProps) {
  const [items, setItems] = useState<ApiKeyItem[]>(initialItems);
  const [showCreate, setShowCreate] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: (result) => {
      setItems((prev) =>
        prev.map((k) => (k.id === result.id ? { ...k, is_revoked: true } : k))
      );
      setRevokeId(null);
    },
  });

  function handleKeyCreated(newKey: ApiKeyItem) {
    setItems((prev) => [newKey, ...prev]);
  }

  return (
    <div>
      {/* Create button */}
      <div style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          data-testid="btn-create-api-key"
          style={{
            padding: "0.375rem 0.875rem",
            backgroundColor: "rgba(255, 107, 0, 0.15)",
            border: "1px solid rgba(255, 107, 0, 0.4)",
            borderRadius: "0.375rem",
            color: "var(--color-accent-amber)",
            fontSize: "0.8125rem",
            fontWeight: "500",
            cursor: "pointer",
          }}
        >
          + Create API Key
        </button>
      </div>

      {/* Key table */}
      {items.length === 0 ? (
        <EmptyState
          title="No API keys"
          description="Create an API key to authenticate SDK agents against the LoopStorm Guard backend."
        />
      ) : (
        <div
          style={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Prefix</th>
                <th style={thStyle}>Scopes</th>
                <th style={thStyle}>Last Used</th>
                <th style={thStyle}>Expires</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((key) => {
                const status = getKeyStatus(key);
                const isActive = !key.is_revoked && !(key.expires_at && new Date(key.expires_at) < new Date());
                return (
                  <tr key={key.id} data-testid={`api-key-row-${key.id}`}>
                    <td style={tdStyle}>
                      <span style={{ color: "oklch(0.82 0.00 0)" }}>{key.name}</span>
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.75rem",
                          color: "var(--color-mono)",
                        }}
                      >
                        {key.key_prefix}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                        {key.scopes.map((scope) => (
                          <span
                            key={scope}
                            style={{
                              padding: "0.125rem 0.375rem",
                              backgroundColor: "rgba(100, 100, 100, 0.15)",
                              borderRadius: "0.25rem",
                              fontSize: "0.6875rem",
                              fontFamily: "var(--font-mono)",
                              color: "oklch(0.60 0.00 0)",
                            }}
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <TimeAgo date={key.last_used_at} fallback="Never" />
                    </td>
                    <td style={tdStyle}>
                      {key.expires_at ? (
                        <TimeAgo date={key.expires_at} fallback="—" />
                      ) : (
                        <span style={{ color: "oklch(0.45 0.00 0)" }}>Never</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: "0.75rem", fontWeight: "500", color: status.color }}>
                        {status.label}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {isActive && (
                        <button
                          type="button"
                          onClick={() => setRevokeId(key.id)}
                          data-testid={`btn-revoke-${key.id}`}
                          style={{
                            padding: "0.2rem 0.5rem",
                            backgroundColor: "transparent",
                            border: "1px solid rgba(255, 59, 59, 0.3)",
                            borderRadius: "0.25rem",
                            color: "var(--color-accent-red)",
                            fontSize: "0.6875rem",
                            cursor: "pointer",
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create key dialog */}
      {showCreate && (
        <CreateKeyDialog
          onClose={() => setShowCreate(false)}
          onCreated={handleKeyCreated}
        />
      )}

      {/* Revoke confirm dialog */}
      <ConfirmDialog
        open={!!revokeId}
        title="Revoke API Key"
        message="This will permanently revoke the key. It cannot be undone. Any agents using this key will immediately lose access."
        confirmLabel="Revoke Key"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          if (revokeId) revokeMutation.mutate({ id: revokeId });
        }}
        onCancel={() => setRevokeId(null)}
        isLoading={revokeMutation.isPending}
      />
    </div>
  );
}
