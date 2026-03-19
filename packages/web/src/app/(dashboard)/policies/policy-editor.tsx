// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PolicyEditor — JSON textarea with syntax validation feedback.
 *
 * Client component. Provides:
 * - Textarea for JSON policy content
 * - Real-time JSON.parse validation on blur
 * - Character count display
 * - Server-side validation errors displayed inline
 */

"use client";

import { useState } from "react";

interface PolicyEditorProps {
  value: string;
  onChange: (value: string) => void;
  serverErrors?: string[];
}

export function PolicyEditor({ value, onChange, serverErrors }: PolicyEditorProps) {
  const [localError, setLocalError] = useState<string | null>(null);

  function handleBlur() {
    if (!value.trim()) {
      setLocalError(null);
      return;
    }
    try {
      JSON.parse(value);
      setLocalError(null);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  const hasError = !!localError || (serverErrors && serverErrors.length > 0);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.375rem",
        }}
      >
        <label
          htmlFor="policy-content"
          style={{
            fontSize: "0.75rem",
            fontWeight: "500",
            color: "oklch(0.65 0.00 0)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Policy Content (JSON)
        </label>
        <span style={{ fontSize: "0.6875rem", color: "oklch(0.45 0.00 0)", fontFamily: "var(--font-mono)" }}>
          {value.length} chars
        </span>
      </div>

      <textarea
        id="policy-content"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        spellCheck={false}
        rows={20}
        data-testid="policy-content-editor"
        style={{
          width: "100%",
          padding: "0.75rem",
          backgroundColor: "var(--color-bg)",
          border: `1px solid ${hasError ? "rgba(255, 59, 59, 0.5)" : "var(--color-border)"}`,
          borderRadius: "0.375rem",
          color: "var(--color-mono)",
          fontFamily: "var(--font-mono)",
          fontSize: "0.8125rem",
          lineHeight: "1.6",
          resize: "vertical",
          outline: "none",
          boxSizing: "border-box",
        }}
        placeholder='{"schema_version": 1, "rules": []}'
      />

      {localError && (
        <p
          style={{
            marginTop: "0.25rem",
            fontSize: "0.75rem",
            color: "var(--color-accent-red)",
          }}
          data-testid="policy-json-error"
        >
          JSON error: {localError}
        </p>
      )}

      {serverErrors && serverErrors.length > 0 && (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem 0.75rem",
            backgroundColor: "rgba(255, 59, 59, 0.08)",
            border: "1px solid rgba(255, 59, 59, 0.3)",
            borderRadius: "0.375rem",
          }}
          data-testid="policy-server-errors"
        >
          <p style={{ fontSize: "0.75rem", color: "var(--color-accent-red)", margin: "0 0 0.25rem", fontWeight: "500" }}>
            Validation errors:
          </p>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {serverErrors.map((err, i) => (
              <li key={i} style={{ fontSize: "0.75rem", color: "var(--color-accent-red)" }}>
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
