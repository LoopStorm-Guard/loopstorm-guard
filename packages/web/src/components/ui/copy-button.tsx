// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CopyButton — click-to-copy for API keys, hashes, and other values.
 *
 * Client component: uses the Clipboard API.
 * Shows a brief "Copied!" confirmation after successful copy.
 */

"use client";

import { useState } from "react";

interface CopyButtonProps {
  value: string;
  label?: string;
  size?: "sm" | "md";
}

export function CopyButton({ value, label = "Copy", size = "md" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textArea = document.createElement("textarea");
      textArea.value = value;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const padding = size === "sm" ? "0.125rem 0.375rem" : "0.25rem 0.625rem";
  const fontSize = size === "sm" ? "0.6875rem" : "0.75rem";

  return (
    <button
      type="button"
      onClick={handleCopy}
      data-testid="btn-copy"
      style={{
        padding,
        fontSize,
        backgroundColor: copied ? "rgba(0, 200, 83, 0.1)" : "transparent",
        border: `1px solid ${copied ? "rgba(0, 200, 83, 0.3)" : "var(--color-border)"}`,
        borderRadius: "0.25rem",
        color: copied ? "var(--color-accent-green)" : "oklch(0.60 0.00 0)",
        cursor: "pointer",
        transition: "all 0.15s ease",
        fontFamily: "var(--font-sans)",
      }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
