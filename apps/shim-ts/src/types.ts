// SPDX-License-Identifier: MIT
/**
 * Shared type definitions for the LoopStorm TypeScript shim.
 * These mirror the IPC schemas defined in packages/schemas/.
 */

export interface GuardOptions {
  /** Path to a policy YAML file. Required in Mode 0. */
  policy?: string;
  /** Path to the engine Unix Domain Socket. Defaults to /tmp/loopstorm-engine.sock */
  socketPath?: string;
  /** Agent role tag for policy matching (ADR-008). */
  agentRole?: string;
  /** Human-readable agent name. */
  agentName?: string;
}

export interface ToolCall {
  /** Tool name (e.g., "http.request", "db.query"). */
  tool: string;
  /** Tool arguments — will be hashed and optionally redacted before sending to engine. */
  args: Record<string, unknown>;
}

export type EnforcementDecision = "allow" | "deny" | "cooldown" | "kill" | "require_approval";

export interface DecisionResponse {
  schemaVersion: number;
  runId: string;
  seq: number;
  decision: EnforcementDecision;
  ruleId?: string;
  reason?: string;
  cooldownMs?: number;
  cooldownMessage?: string;
  ts: string;
}

/** Thrown when the engine returns deny or kill. */
export class EnforcementError extends Error {
  constructor(
    public readonly decision: "deny" | "kill",
    public readonly ruleId: string | undefined,
    public readonly reason: string | undefined
  ) {
    super(`LoopStorm enforcement: ${decision}${reason ? ` — ${reason}` : ""}`);
    this.name = "EnforcementError";
  }
}
