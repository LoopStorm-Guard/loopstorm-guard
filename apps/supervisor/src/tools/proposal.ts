// SPDX-License-Identifier: MIT
/**
 * Proposal tools — create proposals in the backend.
 *
 * 2 tools: propose_budget_adjustment, flag_for_review
 */

import { randomBytes } from "node:crypto";
import type { BackendClient } from "../lib/backend-client.js";

function generateProposalId(): string {
  return `prop_${randomBytes(4).toString("hex")}`;
}

export async function proposeBudgetAdjustment(
  client: BackendClient,
  supervisorRunId: string,
  params: {
    target_agent: string;
    dimension: string;
    current_value: number;
    proposed_value: number;
    rationale: string;
    confidence: number;
    supporting_run_ids: string[];
    trigger_run_id?: string;
  }
) {
  const proposalId = generateProposalId();

  const result = await client.supervisorTools.createProposal.mutate({
    proposal_id: proposalId,
    supervisor_run_id: supervisorRunId,
    trigger_run_id: params.trigger_run_id,
    proposal_type: "budget_adjustment",
    target_agent: params.target_agent,
    rationale: params.rationale,
    confidence: params.confidence,
    supporting_runs: params.supporting_run_ids,
    proposed_changes: {
      dimension: params.dimension,
      current_value: params.current_value,
      proposed_value: params.proposed_value,
    },
  });

  return { proposal_id: proposalId, ...result };
}

export async function flagForReview(
  client: BackendClient,
  supervisorRunId: string,
  params: {
    target_agent?: string;
    rationale: string;
    confidence: number;
    supporting_run_ids: string[];
    recommendation: string;
    trigger_run_id?: string;
  }
) {
  const proposalId = generateProposalId();

  const result = await client.supervisorTools.createProposal.mutate({
    proposal_id: proposalId,
    supervisor_run_id: supervisorRunId,
    trigger_run_id: params.trigger_run_id,
    proposal_type: "flag_for_review",
    target_agent: params.target_agent,
    rationale: params.rationale,
    confidence: params.confidence,
    supporting_runs: params.supporting_run_ids,
    proposed_changes: {
      recommendation: params.recommendation,
    },
  });

  return { proposal_id: proposalId, ...result };
}
