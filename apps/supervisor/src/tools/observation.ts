// SPDX-License-Identifier: MIT
/**
 * Observation tools — read data from the backend.
 *
 * 4 tools: read_run_events, read_agent_baseline, read_policy_pack, query_similar_runs
 */

import type { BackendClient } from "../lib/backend-client.js";

export async function readRunEvents(
  client: BackendClient,
  params: { run_id: string; event_type?: string; offset_seq?: number; limit?: number }
) {
  const result = await client.supervisorTools.getRunEvents.query({
    run_id: params.run_id,
    event_type: params.event_type,
    cursor: params.offset_seq,
    limit: params.limit ?? 500,
  });
  return result;
}

export async function readAgentBaseline(
  client: BackendClient,
  params: { agent_name: string; lookback_days?: number }
) {
  const result = await client.supervisorTools.getAgentBaseline.query({
    agent_name: params.agent_name,
    lookback_days: params.lookback_days ?? 30,
  });
  return result;
}

export async function readPolicyPack(client: BackendClient, params: { policy_pack_id: string }) {
  const result = await client.supervisorTools.getPolicyPack.query({
    id: params.policy_pack_id,
  });
  return result;
}

export async function querySimilarRuns(
  client: BackendClient,
  params: { fingerprint: string; scope?: "customer" | "anonymous_aggregate"; top_k?: number }
) {
  const result = await client.supervisorTools.querySimilarRuns.query({
    fingerprint: params.fingerprint,
    scope: params.scope ?? "customer",
    limit: params.top_k ?? 10,
  });
  return result;
}
