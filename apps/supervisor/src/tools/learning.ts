// SPDX-License-Identifier: MIT
/**
 * Learning tools — record observations for future supervisor sessions.
 *
 * 3 tools: record_incident_pattern, update_agent_profile, record_intervention_outcome
 *
 * These are auto-approved entries (observations, not change requests).
 */

import { randomBytes } from "node:crypto";
import type { BackendClient } from "../lib/backend-client.js";

function generateProposalId(): string {
  return `prop_${randomBytes(4).toString("hex")}`;
}

export async function recordIncidentPattern(
  client: BackendClient,
  supervisorRunId: string,
  params: {
    target_agent?: string;
    pattern_description: string;
    confidence: number;
    supporting_run_ids: string[];
    trigger_run_id?: string;
  }
) {
  const proposalId = generateProposalId();

  const result = await client.supervisorTools.recordLearning.mutate({
    proposal_id: proposalId,
    supervisor_run_id: supervisorRunId,
    trigger_run_id: params.trigger_run_id,
    proposal_type: "incident_pattern",
    target_agent: params.target_agent,
    rationale: params.pattern_description,
    confidence: params.confidence,
    supporting_runs: params.supporting_run_ids,
    proposed_changes: {
      pattern_description: params.pattern_description,
    },
  });

  return result;
}

export async function updateAgentProfile(
  client: BackendClient,
  supervisorRunId: string,
  params: {
    target_agent: string;
    profile_update: Record<string, unknown>;
    rationale: string;
    confidence: number;
    supporting_run_ids: string[];
    trigger_run_id?: string;
  }
) {
  const proposalId = generateProposalId();

  const result = await client.supervisorTools.recordLearning.mutate({
    proposal_id: proposalId,
    supervisor_run_id: supervisorRunId,
    trigger_run_id: params.trigger_run_id,
    proposal_type: "agent_profile_update",
    target_agent: params.target_agent,
    rationale: params.rationale,
    confidence: params.confidence,
    supporting_runs: params.supporting_run_ids,
    proposed_changes: params.profile_update,
  });

  return result;
}

export async function recordInterventionOutcome(
  client: BackendClient,
  supervisorRunId: string,
  params: {
    target_agent?: string;
    intervention_type: string;
    outcome: string;
    rationale: string;
    confidence: number;
    supporting_run_ids: string[];
    trigger_run_id?: string;
  }
) {
  const proposalId = generateProposalId();

  const result = await client.supervisorTools.recordLearning.mutate({
    proposal_id: proposalId,
    supervisor_run_id: supervisorRunId,
    trigger_run_id: params.trigger_run_id,
    proposal_type: "intervention_outcome",
    target_agent: params.target_agent,
    rationale: params.rationale,
    confidence: params.confidence,
    supporting_runs: params.supporting_run_ids,
    proposed_changes: {
      intervention_type: params.intervention_type,
      outcome: params.outcome,
    },
  });

  return result;
}
