// SPDX-License-Identifier: MIT
/**
 * MCP <-> LoopStorm DecisionRequest/Response translation.
 * Spec: specs/mcp-proxy-mode.md Section 3.1-3.2
 */

import { DecisionRequest, type DecisionResponse, argsHash } from "@loopstorm/ipc-client";
import {
  LOOPSTORM_APPROVAL_REQUIRED,
  LOOPSTORM_COOLDOWN,
  LOOPSTORM_DENIED,
  LOOPSTORM_KILLED,
  type LoopStormErrorData,
  buildErrorData,
} from "./errors.js";

export interface McpToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface RunContext {
  runId: string;
  seq: number;
  agentName?: string | undefined;
  agentRole?: string | undefined;
  environment?: string | undefined;
}

/**
 * Translate an MCP tools/call request into a LoopStorm DecisionRequest.
 */
export function mcpToolCallToDecisionRequest(
  params: McpToolCallParams,
  ctx: RunContext
): DecisionRequest {
  const args = params.arguments ?? null;
  const hash = argsHash(args);

  return new DecisionRequest({
    schema_version: 1,
    run_id: ctx.runId,
    seq: ctx.seq,
    tool: params.name,
    args_hash: hash,
    ts: new Date().toISOString(),
    args_redacted: args as Record<string, unknown> | undefined,
    agent_name: ctx.agentName,
    agent_role: ctx.agentRole,
    environment: ctx.environment,
  });
}

export interface McpErrorResult {
  isError: true;
  code: number;
  message: string;
  data: LoopStormErrorData;
}

/**
 * Translate a LoopStorm DecisionResponse into an MCP error (for non-allow decisions).
 * Returns null if the decision is "allow" (call should be forwarded).
 */
export function decisionResponseToMcpError(response: DecisionResponse): McpErrorResult | null {
  switch (response.decision) {
    case "allow":
      return null;

    case "deny":
      return {
        isError: true,
        code: LOOPSTORM_DENIED,
        message: "Tool call denied by policy",
        data: buildErrorData({ rule_id: response.ruleId, reason: response.reason }),
      };

    case "cooldown":
      return {
        isError: true,
        code: LOOPSTORM_COOLDOWN,
        message: "Tool call paused: loop detected",
        data: buildErrorData({
          cooldown_ms: response.cooldownMs,
          cooldown_message: response.cooldownMessage,
        }),
      };

    case "kill":
      return {
        isError: true,
        code: LOOPSTORM_KILLED,
        message: "Run terminated",
        data: buildErrorData({ rule_id: response.ruleId, reason: response.reason }),
      };

    case "require_approval":
      return {
        isError: true,
        code: LOOPSTORM_APPROVAL_REQUIRED,
        message: "Tool call held for human approval",
        data: buildErrorData({
          approval_id: response.approvalId,
          approval_timeout_ms: response.approvalTimeoutMs,
        }),
      };

    default:
      return {
        isError: true,
        code: LOOPSTORM_KILLED,
        message: `Unknown decision: ${response.decision}`,
        data: buildErrorData({ reason: `Unknown decision type: ${response.decision}` }),
      };
  }
}
