// SPDX-License-Identifier: MIT
/**
 * Public type definitions for the LoopStorm TypeScript shim.
 */

export interface GuardOptions {
  /** Path to the engine socket. Defaults to platform-specific path. */
  socketPath?: string | undefined;
  /** If true (default), allow calls when engine is unavailable. */
  failOpen?: boolean | undefined;
  /** Fixed run ID. Generated as UUID v4 if not provided. */
  runId?: string | undefined;
  /** Agent role tag for policy matching (ADR-008). */
  agentRole?: string | undefined;
  /** Human-readable agent name. */
  agentName?: string | undefined;
  /** Environment tag (e.g. "production", "staging"). */
  environment?: string | undefined;
  /** Model name (e.g. "gpt-4o", "claude-3-opus"). */
  model?: string | undefined;
  /** Socket timeout in seconds. Default: 10. */
  timeout?: number | undefined;
}

export interface BudgetRemaining {
  costUsd?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  callCount?: number | undefined;
}

export interface DecisionResult {
  decision: string;
  ruleId?: string | undefined;
  reason?: string | undefined;
  cooldownMs?: number | undefined;
  cooldownMessage?: string | undefined;
  budgetRemaining?: BudgetRemaining | undefined;
}

export type EnforcementDecision = "allow" | "deny" | "cooldown" | "kill" | "require_approval";
