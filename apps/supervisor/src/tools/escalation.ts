// SPDX-License-Identifier: MIT
/**
 * Escalation tool — create escalations in the backend.
 *
 * 1 tool: escalate_to_human
 *
 * The escalate_to_human invariant (ADR-012, C13): this tool must ALWAYS
 * succeed. No policy rule or application logic may block it.
 */

import { randomBytes } from "node:crypto";
import type { BackendClient } from "../lib/backend-client.js";

function generateEscalationId(): string {
  return `esc_${randomBytes(4).toString("hex")}`;
}

export async function escalateToHuman(
  client: BackendClient,
  supervisorRunId: string,
  params: {
    severity: "low" | "medium" | "high" | "critical";
    rationale: string;
    recommendation?: string;
    confidence: number;
    supporting_run_ids: string[];
    timeout_seconds?: number;
    timeout_action?: "deny" | "allow" | "kill";
    trigger_run_id?: string;
  }
) {
  const escalationId = generateEscalationId();

  const result = await client.supervisorTools.createEscalation.mutate({
    escalation_id: escalationId,
    supervisor_run_id: supervisorRunId,
    trigger_run_id: params.trigger_run_id,
    severity: params.severity,
    rationale: params.rationale,
    recommendation: params.recommendation,
    confidence: params.confidence,
    supporting_runs: params.supporting_run_ids,
    timeout_seconds: params.timeout_seconds,
    timeout_action: params.timeout_action,
  });

  return { escalation_id: escalationId, ...result };
}
