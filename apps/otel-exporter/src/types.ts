// SPDX-License-Identifier: MIT

/**
 * TypeScript interfaces for LoopStorm JSONL audit event fields.
 * Mirrors event.schema.json — all optional fields are truly optional.
 */

export interface BudgetDimension {
  current?: number;
  soft?: number;
  hard?: number;
}

export interface Budget {
  cost_usd?: BudgetDimension;
  input_tokens?: BudgetDimension;
  output_tokens?: BudgetDimension;
  call_count?: BudgetDimension;
}

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

export type DecisionType = "allow" | "deny" | "cooldown" | "kill" | "require_approval";

export type RunStatus =
  | "started"
  | "completed"
  | "terminated_budget"
  | "terminated_loop"
  | "terminated_policy"
  | "abandoned"
  | "error";

/** A parsed JSONL audit event conforming to event.schema.json. */
export interface ParsedEvent {
  // Required core fields
  schema_version: number;
  event_type: EventType;
  run_id: string;
  seq: number;
  hash: string;
  hash_prev: string | null;
  ts: string;

  // Optional fields
  agent_name?: string;
  agent_role?: string;
  tool?: string;
  args_hash?: string;
  args_redacted?: Record<string, unknown>;
  decision?: DecisionType;
  rule_id?: string;
  reason?: string;
  budget?: Budget;
  dimension?: string;
  loop_rule?: string;
  loop_action?: string;
  cooldown_ms?: number;
  run_status?: RunStatus;
  system_event_type?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  latency_ms?: number;
  policy_pack_id?: string;
  environment?: string;

  // Behavioral telemetry (v1.1)
  call_seq_fingerprint?: string;
  inter_call_ms?: number;
  token_rate_delta?: number;
  param_shape_hash?: string;

  // Supervisor fields
  supervisor_run_id?: string;
  trigger?: string;
  trigger_run_id?: string;
  proposal_id?: string;
  proposal_type?: string;
  target_agent?: string;
  rationale?: string;
  confidence?: number;
  supporting_runs?: string[];
  status?: string;
  escalation_id?: string;
  severity?: string;
  recommendation?: string;
  timeout_seconds?: number;
  timeout_action?: string;
}

/** Required fields that must be present for a valid event. */
export const REQUIRED_EVENT_FIELDS = ["run_id", "seq", "event_type", "hash", "ts"] as const;

export type RequiredField = (typeof REQUIRED_EVENT_FIELDS)[number];
