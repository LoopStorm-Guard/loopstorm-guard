// SPDX-License-Identifier: MIT
/**
 * DecisionRequest/Response types and NDJSON serialization.
 *
 * Wire format uses snake_case field names per the IPC spec.
 */

/** Wire-format shape for a decision request (snake_case). */
export interface DecisionRequestWire {
  schema_version: number;
  run_id: string;
  seq: number;
  tool: string;
  args_hash: string;
  ts: string;
  args_redacted?: Record<string, unknown> | undefined;
  agent_role?: string | undefined;
  agent_name?: string | undefined;
  model?: string | undefined;
  input_tokens?: number | undefined;
  output_tokens?: number | undefined;
  estimated_cost_usd?: number | undefined;
  environment?: string | undefined;
}

/** IPC request sent from the shim to the engine. */
export class DecisionRequest {
  readonly schemaVersion: number;
  readonly runId: string;
  readonly seq: number;
  readonly tool: string;
  readonly argsHash: string;
  readonly ts: string;
  readonly argsRedacted: Record<string, unknown> | undefined;
  readonly agentRole: string | undefined;
  readonly agentName: string | undefined;
  readonly model: string | undefined;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly estimatedCostUsd: number | undefined;
  readonly environment: string | undefined;

  constructor(data: DecisionRequestWire) {
    this.schemaVersion = data.schema_version;
    this.runId = data.run_id;
    this.seq = data.seq;
    this.tool = data.tool;
    this.argsHash = data.args_hash;
    this.ts = data.ts;
    this.argsRedacted = data.args_redacted;
    this.agentRole = data.agent_role;
    this.agentName = data.agent_name;
    this.model = data.model;
    this.inputTokens = data.input_tokens;
    this.outputTokens = data.output_tokens;
    this.estimatedCostUsd = data.estimated_cost_usd;
    this.environment = data.environment;
  }

  /** Serialize to dict for JSON encoding, omitting undefined fields. */
  toDict(): Record<string, unknown> {
    const d: Record<string, unknown> = {
      schema_version: this.schemaVersion,
      run_id: this.runId,
      seq: this.seq,
      tool: this.tool,
      args_hash: this.argsHash,
      ts: this.ts,
    };
    if (this.argsRedacted !== undefined) d.args_redacted = this.argsRedacted;
    if (this.agentRole !== undefined) d.agent_role = this.agentRole;
    if (this.agentName !== undefined) d.agent_name = this.agentName;
    if (this.model !== undefined) d.model = this.model;
    if (this.inputTokens !== undefined) d.input_tokens = this.inputTokens;
    if (this.outputTokens !== undefined) d.output_tokens = this.outputTokens;
    if (this.estimatedCostUsd !== undefined) d.estimated_cost_usd = this.estimatedCostUsd;
    if (this.environment !== undefined) d.environment = this.environment;
    return d;
  }

  /** Serialize to NDJSON line (Buffer with trailing newline). */
  toNdjson(): Buffer {
    const json = JSON.stringify(this.toDict());
    return Buffer.from(`${json}\n`, "utf-8");
  }
}

/** Wire-format shape for a decision response (snake_case). */
export interface DecisionResponseWire {
  schema_version: number;
  run_id: string;
  seq: number;
  decision: string;
  rule_id?: string;
  reason?: string;
  cooldown_ms?: number;
  cooldown_message?: string;
  approval_id?: string;
  approval_timeout_ms?: number;
  approval_timeout_action?: string;
  budget_remaining?: Record<string, unknown>;
  ts?: string;
}

/** IPC response sent from the engine to the shim. */
export class DecisionResponse {
  readonly schemaVersion: number;
  readonly runId: string;
  readonly seq: number;
  readonly decision: string;
  readonly ruleId: string | undefined;
  readonly reason: string | undefined;
  readonly cooldownMs: number | undefined;
  readonly cooldownMessage: string | undefined;
  readonly approvalId: string | undefined;
  readonly approvalTimeoutMs: number | undefined;
  readonly approvalTimeoutAction: string | undefined;
  readonly budgetRemaining: Record<string, unknown> | undefined;
  readonly ts: string | undefined;

  constructor(data: DecisionResponseWire) {
    this.schemaVersion = data.schema_version;
    this.runId = data.run_id;
    this.seq = data.seq;
    this.decision = data.decision;
    this.ruleId = data.rule_id;
    this.reason = data.reason;
    this.cooldownMs = data.cooldown_ms;
    this.cooldownMessage = data.cooldown_message;
    this.approvalId = data.approval_id;
    this.approvalTimeoutMs = data.approval_timeout_ms;
    this.approvalTimeoutAction = data.approval_timeout_action;
    this.budgetRemaining = data.budget_remaining;
    this.ts = data.ts;
  }

  /** Deserialize from a JSON string, ignoring unknown fields. */
  static fromJson(jsonStr: string): DecisionResponse {
    const data = JSON.parse(jsonStr) as DecisionResponseWire;
    return new DecisionResponse(data);
  }
}
