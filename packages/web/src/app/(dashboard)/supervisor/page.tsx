// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Supervisor page — server component.
 *
 * Fetches open escalations (highest urgency) and pending proposals
 * server-side. The client components handle actions (approve, reject,
 * acknowledge) and polling.
 *
 * The escalate_to_human invariant (ADR-012, C10): this page and its
 * acknowledge functionality must always render and be accessible.
 */

import { createServerTRPCClient } from "@/lib/trpc-server";
import { EscalationQueue } from "./escalation-queue";
import { ProposalQueue } from "./proposal-queue";

export const metadata = {
  title: "Supervisor — LoopStorm Guard",
};

export default async function SupervisorPage() {
  const trpc = await createServerTRPCClient();

  type EscalationsResult = Awaited<ReturnType<typeof trpc.supervisor.listEscalations.query>>;
  type ProposalsResult = Awaited<ReturnType<typeof trpc.supervisor.listProposals.query>>;

  let escalations: EscalationsResult = {
    items: [],
    nextCursor: null,
  };
  let proposals: ProposalsResult = {
    items: [],
    nextCursor: null,
  };

  try {
    [escalations, proposals] = await Promise.all([
      trpc.supervisor.listEscalations.query({ status: "open", limit: 20 }),
      trpc.supervisor.listProposals.query({ status: "pending", limit: 20 }),
    ]);
  } catch {
    // Render empty state on error
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* Layer 2 indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 0.75rem",
          backgroundColor: "rgba(196, 169, 107, 0.05)",
          border: "1px solid rgba(196, 169, 107, 0.2)",
          borderRadius: "0.375rem",
        }}
      >
        <span style={{ fontSize: "1rem" }}>🧠</span>
        <span
          style={{
            fontSize: "0.75rem",
            color: "var(--color-supervisor)",
            fontStyle: "italic",
          }}
        >
          AI Supervisor — advisory only · human approval required · observation plane only
        </span>
      </div>

      {/* Escalations section (top — highest urgency) */}
      <EscalationQueue
        initialItems={escalations.items}
        initialNextCursor={escalations.nextCursor}
      />

      {/* Proposals section */}
      <ProposalQueue initialItems={proposals.items} initialNextCursor={proposals.nextCursor} />
    </div>
  );
}
