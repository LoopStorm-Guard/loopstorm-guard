// SPDX-License-Identifier: MIT
/**
 * TypeScript types for LoopStorm events (audit log and backend ingest).
 * These must stay in sync with schemas/events/event.schema.json.
 */

export type EventType =
  | "run_started"
  | "policy_decision"
  | "budget_update"
  | "budget_soft_cap_warning"
  | "budget_exceeded"
  | "loop_detected"
  | "run_ended"
  | "system_event"
  | "supervisor_run_started"
  | "supervisor_tool_call"
  | "supervisor_proposal_created"
  | "supervisor_escalation_created";

export type RunStatus =
  | "started"
  | "completed"
  | "terminated_budget"
  | "terminated_loop"
  | "terminated_policy"
  | "abandoned"
  | "error";

export interface LoopStormEvent {
  schema_version: 1;
  event_type: EventType;
  run_id: string;
  seq: number;
  /** SHA-256 of this event's payload (all fields except hash and hash_prev) */
  hash: string;
  /** SHA-256 of previous event in this run's chain. Null for seq=1. */
  hash_prev: string | null;
  ts: string;
  agent_name?: string;
  agent_role?: string;
  tool?: string;
  args_hash?: string;
  args_redacted?: Record<string, unknown>;
  decision?: "allow" | "deny" | "cooldown" | "kill" | "require_approval";
  rule_id?: string;
  reason?: string;
  latency_ms?: number;
  policy_pack_id?: string;
  environment?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  run_status?: RunStatus;
  loop_rule?: string;
  loop_action?: "cooldown" | "kill";
  cooldown_ms?: number;
}
