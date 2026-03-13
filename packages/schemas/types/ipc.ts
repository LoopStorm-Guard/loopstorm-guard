// SPDX-License-Identifier: MIT
/**
 * TypeScript types for the IPC protocol (ADR-001).
 * These must stay in sync with schemas/ipc/*.schema.json.
 */

export type Decision = "allow" | "deny" | "cooldown" | "kill" | "require_approval";

export interface DecisionRequest {
  schema_version: 1;
  run_id: string;
  seq: number;
  tool: string;
  /** SHA-256 hex of JCS-canonical args (RFC 8785) */
  args_hash: string;
  args_redacted?: Record<string, unknown>;
  agent_role?: string;
  agent_name?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  environment?: string;
  ts: string;
}

export interface DecisionResponse {
  schema_version: 1;
  run_id: string;
  seq: number;
  decision: Decision;
  rule_id?: string;
  reason?: string;
  cooldown_ms?: number;
  cooldown_message?: string;
  approval_id?: string;
  approval_timeout_ms?: number;
  approval_timeout_action?: "deny" | "allow" | "kill";
  budget_remaining?: {
    cost_usd?: number;
    input_tokens?: number;
    output_tokens?: number;
    call_count?: number;
  };
  ts?: string;
}
