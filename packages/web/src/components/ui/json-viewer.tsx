// SPDX-License-Identifier: AGPL-3.0-only
/**
 * JsonViewer — collapsible JSON tree display.
 *
 * Client component. Renders JSON with syntax highlighting and
 * expand/collapse for nested objects.
 */

"use client";

import { useState } from "react";

interface JsonViewerProps {
  data: unknown;
  initiallyExpanded?: boolean;
}

export function JsonViewer({ data, initiallyExpanded = true }: JsonViewerProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);

  const json = JSON.stringify(data, null, 2);
  const lineCount = json.split("\n").length;
  const isLarge = lineCount > 20;

  return (
    <div
      style={{
        backgroundColor: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: "0.375rem",
        overflow: "hidden",
      }}
    >
      {isLarge && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            width: "100%",
            padding: "0.25rem 0.75rem",
            backgroundColor: "transparent",
            border: "none",
            borderBottom: expanded ? "1px solid var(--color-border)" : "none",
            color: "oklch(0.55 0.00 0)",
            fontSize: "0.75rem",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          {expanded ? "▼ Collapse" : "▶ Expand"} ({lineCount} lines)
        </button>
      )}
      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: "0.75rem",
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
            color: "var(--color-mono)",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          <code>{json}</code>
        </pre>
      )}
    </div>
  );
}
