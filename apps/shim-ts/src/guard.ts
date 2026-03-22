// SPDX-License-Identifier: MIT
/**
 * Guard class — the primary entry point for wrapping agent tool calls.
 *
 * Communicates with the loopstorm-engine binary over IPC (Unix Domain Socket
 * on Linux/macOS, named pipe on Windows). The engine must be running before
 * any wrapped calls are made, or `failOpen: true` (default) allows unguarded
 * execution when the engine is unavailable.
 */

import { randomUUID } from "node:crypto";
import { argsHash } from "./args-hash.js";
import { EngineConnection, resolveSocketPath } from "./connection.js";
import {
  ApprovalRequiredError,
  CooldownError,
  EngineUnavailableError,
  PolicyDeniedError,
  RunTerminatedError,
} from "./errors.js";
import { OpenAIGuardedClient } from "./openai.js";
import { DecisionRequest, type DecisionResponse } from "./protocol.js";
import type { BudgetRemaining, DecisionResult, GuardOptions } from "./types.js";

export class Guard {
  private readonly socketPath: string;
  private readonly failOpen: boolean;
  private readonly _runId: string;
  private readonly agentRole: string | undefined;
  private readonly agentName: string | undefined;
  private readonly environment: string | undefined;
  private readonly model: string | undefined;
  private seq = 0;
  private readonly conn: EngineConnection;

  constructor(options: GuardOptions = {}) {
    this.socketPath = resolveSocketPath(options.socketPath);
    this.failOpen = options.failOpen ?? true;
    this._runId = options.runId ?? randomUUID();
    this.agentRole = options.agentRole;
    this.agentName = options.agentName;
    this.environment = options.environment;
    this.model = options.model;
    const timeoutMs = (options.timeout ?? 10) * 1000;
    this.conn = new EngineConnection(this.socketPath, timeoutMs);
  }

  /** The run_id for this Guard instance (fixed for its lifetime). */
  get runId(): string {
    return this._runId;
  }

  /**
   * Wraps a function with LoopStorm enforcement.
   *
   * @param toolName - Tool name for policy matching (e.g. "http.request")
   * @param fn - The function to wrap
   * @returns A wrapped function that enforces policy before each call
   */
  wrap<Args extends unknown[], Return>(
    toolName: string,
    fn: (...args: Args) => Return | Promise<Return>
  ): (...args: Args) => Promise<Return> {
    return async (...args: Args): Promise<Return> => {
      const callArgs: Record<string, unknown> = {};
      for (let i = 0; i < args.length; i++) {
        callArgs[`arg${i}`] = args[i];
      }
      await this.check(toolName, { args: callArgs });
      return fn(...args);
    };
  }

  /**
   * Send a decision request to the engine and enforce the result.
   *
   * Returns a DecisionResult on allow. Throws on deny, cooldown,
   * kill, or require_approval.
   */
  async check(
    toolName: string,
    options: {
      args?: Record<string, unknown> | undefined;
      inputTokens?: number | undefined;
      outputTokens?: number | undefined;
      estimatedCostUsd?: number | undefined;
    } = {}
  ): Promise<DecisionResult> {
    this.seq += 1;
    const seq = this.seq;

    const hash = argsHash(options.args ?? null);
    const ts = new Date().toISOString();

    const request = new DecisionRequest({
      schema_version: 1,
      run_id: this._runId,
      seq,
      tool: toolName,
      args_hash: hash,
      ts,
      args_redacted: options.args,
      agent_role: this.agentRole,
      agent_name: this.agentName,
      model: this.model,
      input_tokens: options.inputTokens,
      output_tokens: options.outputTokens,
      estimated_cost_usd: options.estimatedCostUsd,
      environment: this.environment,
    });

    const response = await this.send(request);
    if (response === null) {
      // Engine unavailable, fail_open allowed the call
      return { decision: "allow" };
    }

    // Verify seq and run_id echo
    if (response.seq !== seq || response.runId !== this._runId) {
      throw new RunTerminatedError(
        undefined,
        "protocol error: seq/run_id mismatch in engine response"
      );
    }

    return this.handleDecision(response);
  }

  /**
   * Wrap an OpenAI client to gate tool calls.
   *
   * Returns a proxy that intercepts `chat.completions.create()`
   * responses and checks each tool call through this Guard.
   */
  openai(client: unknown): OpenAIGuardedClient {
    return new OpenAIGuardedClient(client, this);
  }

  /** Close the IPC connection. */
  close(): void {
    this.conn.close();
  }

  private async send(request: DecisionRequest): Promise<DecisionResponse | null> {
    try {
      return await this.conn.request(request);
    } catch {
      // First failure: try one reconnect
      try {
        await this.conn.reconnect();
        return await this.conn.request(request);
      } catch (retryErr: unknown) {
        if (this.failOpen) {
          return null;
        }
        throw new EngineUnavailableError(
          retryErr instanceof Error ? retryErr.message : String(retryErr)
        );
      }
    }
  }

  private async handleDecision(response: DecisionResponse): Promise<DecisionResult> {
    let budget: BudgetRemaining | undefined;
    if (response.budgetRemaining) {
      const br = response.budgetRemaining;
      budget = {};
      if (br.cost_usd !== undefined) budget.costUsd = br.cost_usd as number;
      if (br.input_tokens !== undefined) budget.inputTokens = br.input_tokens as number;
      if (br.output_tokens !== undefined) budget.outputTokens = br.output_tokens as number;
      if (br.call_count !== undefined) budget.callCount = br.call_count as number;
    }

    const result: DecisionResult = { decision: response.decision };
    if (response.ruleId !== undefined) result.ruleId = response.ruleId;
    if (response.reason !== undefined) result.reason = response.reason;
    if (response.cooldownMs !== undefined) result.cooldownMs = response.cooldownMs;
    if (response.cooldownMessage !== undefined) result.cooldownMessage = response.cooldownMessage;
    if (budget !== undefined) result.budgetRemaining = budget;

    switch (response.decision) {
      case "allow":
        return result;

      case "deny":
        throw new PolicyDeniedError(response.ruleId, response.reason);

      case "cooldown": {
        const ms = response.cooldownMs ?? 0;
        if (ms > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, ms));
        }
        throw new CooldownError(ms, response.cooldownMessage);
      }

      case "kill":
        throw new RunTerminatedError(response.ruleId, response.reason);

      case "require_approval":
        throw new ApprovalRequiredError(
          response.approvalId ?? "",
          response.approvalTimeoutMs ?? 0,
          response.approvalTimeoutAction ?? "deny"
        );

      default:
        // Unknown decision — fail closed
        throw new RunTerminatedError(undefined, `unknown decision: ${response.decision}`);
    }
  }
}
