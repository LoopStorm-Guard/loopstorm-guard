// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LoadMoreButton — cursor-based pagination trigger.
 *
 * Renders a "Load more" button when there is a next cursor available.
 * Client component because it handles click events.
 */

"use client";

interface LoadMoreButtonProps {
  onLoadMore: () => void;
  isLoading?: boolean;
  hasMore: boolean;
}

export function LoadMoreButton({ onLoadMore, isLoading, hasMore }: LoadMoreButtonProps) {
  if (!hasMore) return null;

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "1rem 0" }}>
      <button
        type="button"
        onClick={onLoadMore}
        disabled={isLoading}
        data-testid="btn-load-more"
        style={{
          padding: "0.5rem 1.25rem",
          backgroundColor: "transparent",
          border: "1px solid var(--color-border)",
          borderRadius: "0.375rem",
          color: "oklch(0.65 0.00 0)",
          fontSize: "0.875rem",
          cursor: isLoading ? "not-allowed" : "pointer",
          opacity: isLoading ? 0.6 : 1,
        }}
      >
        {isLoading ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
