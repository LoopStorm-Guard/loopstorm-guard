// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ChainBadge — hash chain verification shield indicator.
 *
 * Client component: calls verify.chain on mount, updates state as it loads.
 *
 * States:
 * - pending: "◔ Verifying…" (gray)
 * - verified: "● Verified · N events · checked Nm ago" (green)
 * - broken: "● Tampered at #N" (red)
 * - not_found: "○ Not verified" (gray)
 *
 * The "● Verified" format is exact per spec — never "CHAIN VALID" or "CHAIN BROKEN".
 *
 * Design system: ChainBadge must have data-testid="chain-badge" on the span.
 */

"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc-client";

type ChainState =
  | { status: "pending" }
  | { status: "verified"; eventCount: number; checkedAt: Date }
  | { status: "broken"; brokenAtSeq: number }
  | { status: "not_found" }
  | { status: "error" };

interface ChainBadgeProps {
  runId: string;
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function ChainBadge({ runId }: ChainBadgeProps) {
  const [chainState, setChainState] = useState<ChainState>({ status: "pending" });

  const { data, isLoading, isError } = trpc.verify.chain.useQuery(
    { run_id: runId },
    {
      // Only verify once on mount — chain verification is expensive
      staleTime: 5 * 60 * 1000,
      retry: 1,
    }
  );

  useEffect(() => {
    if (isLoading) {
      setChainState({ status: "pending" });
      return;
    }
    if (isError) {
      setChainState({ status: "error" });
      return;
    }
    if (!data) {
      setChainState({ status: "not_found" });
      return;
    }
    if (!data.found) {
      setChainState({ status: "not_found" });
      return;
    }
    if (data.valid) {
      setChainState({
        status: "verified",
        eventCount: data.eventCount,
        checkedAt: new Date(),
      });
    } else {
      setChainState({
        status: "broken",
        brokenAtSeq: (data as { brokenAtSeq?: number }).brokenAtSeq ?? 0,
      });
    }
  }, [data, isLoading, isError]);

  let text = "";
  let color = "oklch(0.60 0.00 0)";

  switch (chainState.status) {
    case "pending":
      text = "◔ Verifying…";
      color = "oklch(0.60 0.00 0)";
      break;
    case "verified":
      text = `● Verified · ${chainState.eventCount} events · checked ${formatRelativeTime(chainState.checkedAt)}`;
      color = "var(--color-accent-green)";
      break;
    case "broken":
      text = `● Tampered at #${chainState.brokenAtSeq}`;
      color = "var(--color-accent-red)";
      break;
    case "not_found":
      text = "○ Not verified";
      color = "oklch(0.55 0.00 0)";
      break;
    case "error":
      text = "○ Verification failed";
      color = "oklch(0.55 0.00 0)";
      break;
  }

  return (
    <span
      data-testid="chain-badge"
      style={{
        fontSize: "0.75rem",
        fontFamily: "var(--font-mono)",
        color,
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
      }}
    >
      {text}
    </span>
  );
}
