// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PolicyList — paginated list of policy pack cards.
 *
 * Client component. Each card links to the edit page.
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadMoreButton } from "@/components/ui/load-more";
import { TimeAgo } from "@/components/ui/time-ago";
import { trpc } from "@/lib/trpc-client";

type PolicyItem = {
  id: string;
  name: string;
  description: string | null;
  agent_role: string | null;
  environment: string | null;
  is_active: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
};

interface PolicyListProps {
  initialItems: PolicyItem[];
  initialNextCursor: string | null;
}

export function PolicyList({ initialItems, initialNextCursor }: PolicyListProps) {
  const router = useRouter();
  const [items, setItems] = useState<PolicyItem[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const utils = trpc.useUtils();

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await utils.policies.list.fetch({ limit: 50, cursor: nextCursor });
      setItems((prev) => [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No policies"
        description="Create your first policy pack to start enforcing rules on agent tool calls."
      />
    );
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(20rem, 1fr))", gap: "0.75rem" }}>
        {items.map((policy) => (
          <button
            key={policy.id}
            type="button"
            onClick={() => router.push(`/policies/${policy.id}/edit`)}
            data-testid={`policy-card-${policy.id}`}
            style={{
              backgroundColor: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              padding: "1rem",
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              transition: "border-color 0.15s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255, 107, 0, 0.3)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border)";
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ fontWeight: "500", color: "oklch(0.85 0.00 0)", fontSize: "0.875rem" }}>
                {policy.name}
              </span>
              <span
                style={{
                  padding: "0.125rem 0.375rem",
                  borderRadius: "0.25rem",
                  fontSize: "0.6875rem",
                  fontWeight: "500",
                  backgroundColor: policy.is_active ? "rgba(0, 200, 83, 0.1)" : "rgba(100, 100, 100, 0.1)",
                  color: policy.is_active ? "var(--color-accent-green)" : "oklch(0.55 0.00 0)",
                  border: `1px solid ${policy.is_active ? "rgba(0, 200, 83, 0.3)" : "rgba(100, 100, 100, 0.3)"}`,
                  whiteSpace: "nowrap",
                }}
              >
                {policy.is_active ? "Active" : "Inactive"}
              </span>
            </div>

            {policy.description && (
              <p style={{ fontSize: "0.8125rem", color: "oklch(0.55 0.00 0)", margin: 0 }}>
                {policy.description}
              </p>
            )}

            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              {policy.agent_role && (
                <span
                  style={{
                    fontSize: "0.6875rem",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-accent-purple)",
                  }}
                >
                  {policy.agent_role}
                </span>
              )}
              {policy.environment && (
                <span style={{ fontSize: "0.6875rem", color: "oklch(0.55 0.00 0)" }}>
                  {policy.environment}
                </span>
              )}
              <span
                style={{
                  fontSize: "0.6875rem",
                  fontFamily: "var(--font-mono)",
                  color: "oklch(0.45 0.00 0)",
                }}
              >
                v{policy.version}
              </span>
            </div>

            <div style={{ fontSize: "0.6875rem", color: "oklch(0.45 0.00 0)", marginTop: "auto" }}>
              Updated <TimeAgo date={policy.updated_at} />
            </div>
          </button>
        ))}
      </div>
      <LoadMoreButton hasMore={!!nextCursor} isLoading={loadingMore} onLoadMore={handleLoadMore} />
    </div>
  );
}
