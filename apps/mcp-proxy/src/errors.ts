// SPDX-License-Identifier: MIT
/**
 * MCP error codes and response builders for LoopStorm enforcement decisions.
 * Spec: specs/mcp-proxy-mode.md Section 3.3
 */

/** Policy denied the tool call. */
export const LOOPSTORM_DENIED = -32001;
/** Loop detected; call paused. */
export const LOOPSTORM_COOLDOWN = -32002;
/** Run terminated by policy or budget. */
export const LOOPSTORM_KILLED = -32003;
/** Call held for human approval. */
export const LOOPSTORM_APPROVAL_REQUIRED = -32004;
/** Engine UDS connection failed. */
export const LOOPSTORM_ENGINE_UNAVAILABLE = -32005;

export interface LoopStormErrorData {
  loopstorm: true;
  rule_id?: string | undefined;
  reason?: string | undefined;
  cooldown_ms?: number | undefined;
  cooldown_message?: string | undefined;
  approval_id?: string | undefined;
  approval_timeout_ms?: number | undefined;
}

export function buildErrorData(fields: Omit<LoopStormErrorData, "loopstorm">): LoopStormErrorData {
  return { loopstorm: true, ...fields };
}
