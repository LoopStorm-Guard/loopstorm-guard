// SPDX-License-Identifier: MIT
/**
 * SupervisorSession — orchestrates a single supervisor analysis session.
 *
 * Session lifecycle:
 * 1. Generate supervisorRunId ("sup_" + 8 hex chars).
 * 2. Emit supervisor_run_started event via backend ingest.
 * 3. Enter tool-use loop with the LLM.
 * 4. Execute tool calls, emit supervisor_tool_call events.
 * 5. Track budget (client-side token→cost conversion).
 * 6. Stop on end_turn, max_tokens, or budget exhaustion.
 *
 * Spec reference: specs/task-briefs/v1.1-ai-supervisor.md, Task SUP-B9.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SupervisorConfig } from "./config.js";
import type { BackendClient } from "./lib/backend-client.js";
import type { ContentBlock, LLMProvider, LLMResponse, Message } from "./llm/provider.js";
import {
  DEEPSEEK_COST_PER_INPUT_TOKEN,
  DEEPSEEK_COST_PER_OUTPUT_TOKEN,
} from "./llm/deepseek.js";
import {
  buildTriggerMessage,
  checkTripwire,
  sanitizeToolResult,
} from "./lib/sanitize.js";
import { getSystemPrompt } from "./prompt.js";
import { TOOL_REGISTRY, getToolDefinitions } from "./tools/registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionParams {
  trigger: string;
  triggerRunId: string;
  tenantId: string;
  config: SupervisorConfig;
  llmProvider: LLMProvider;
  backendClient: BackendClient;
}

export interface SessionResult {
  supervisorRunId: string;
  trigger: string;
  triggerRunId: string;
  toolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  terminationReason: "end_turn" | "max_tokens" | "budget_exhausted" | "error";
}

// ---------------------------------------------------------------------------
// Cost constants (per-token pricing for budget tracking)
// T4: DeepSeek V3.2 pricing imported from llm/deepseek.ts (canonical source).
// Previous Claude Haiku constants ($0.25/$1.25 per 1M) replaced.
// ---------------------------------------------------------------------------

/** Cost per input token (DeepSeek V3.2 `deepseek-chat`). From deepseek.ts. */
const COST_PER_INPUT_TOKEN = DEEPSEEK_COST_PER_INPUT_TOKEN;
/** Cost per output token (DeepSeek V3.2 `deepseek-chat`). From deepseek.ts. */
const COST_PER_OUTPUT_TOKEN = DEEPSEEK_COST_PER_OUTPUT_TOKEN;
/** Maximum cost per session in USD (ADR-012, ADR-017). */
const MAX_SESSION_COST_USD = 2.0;
/** Maximum tool calls per session. */
const MAX_TOOL_CALLS = 100;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export class SupervisorSession {
  readonly supervisorRunId: string;
  /** UUID v4 used as run_id for the supervisor's own audit event stream. */
  readonly supervisorRunUuid: string;
  readonly trigger: string;
  readonly triggerRunId: string;
  readonly tenantId: string;

  private readonly config: SupervisorConfig;
  private readonly llm: LLMProvider;
  private readonly client: BackendClient;

  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private toolCallCount = 0;

  /** Monotonic sequence counter for supervisor events. */
  private eventSeq = 0;
  /** Hash of the last emitted event (for hash_prev chaining). */
  private lastHash: string | null = null;

  constructor(params: SessionParams) {
    this.supervisorRunId = `sup_${randomBytes(4).toString("hex")}`;
    this.supervisorRunUuid = randomUUID();
    this.trigger = params.trigger;
    this.triggerRunId = params.triggerRunId;
    this.tenantId = params.tenantId;
    this.config = params.config;
    this.llm = params.llmProvider;
    this.client = params.backendClient;
  }

  /**
   * Execute the supervisor session.
   */
  async execute(): Promise<SessionResult> {
    let terminationReason: SessionResult["terminationReason"] = "end_turn";

    try {
      // Emit supervisor_run_started event
      await this.emitEvent("supervisor_run_started", {
        trigger: this.trigger,
        trigger_run_id: this.triggerRunId,
      });

      // Build initial messages
      const systemPrompt = getSystemPrompt(this.config);
      const toolDefs = getToolDefinitions();

      // T5: use buildTriggerMessage — wraps trigger/runId in XML delimiters
      // and caps length, preventing prompt injection via the trigger payload.
      const messages: Message[] = [
        {
          role: "user",
          content: buildTriggerMessage(this.trigger, this.triggerRunId),
        },
      ];

      // Tool-use loop
      while (this.toolCallCount < MAX_TOOL_CALLS) {
        // Check budget
        if (this.estimatedCostUsd() >= MAX_SESSION_COST_USD) {
          terminationReason = "budget_exhausted";
          await this.emitEvent("supervisor_tool_call", {
            trigger: this.trigger,
            trigger_run_id: this.triggerRunId,
            rationale: "Session terminated: budget exhausted",
          });
          break;
        }

        // Call LLM
        let response: LLMResponse;
        try {
          response = await this.llm.chat({
            model: this.config.model,
            system: systemPrompt,
            messages,
            tools: toolDefs,
            max_tokens: 4096,
          });
        } catch (err) {
          console.error(
            `[supervisor-session] LLM error in session ${this.supervisorRunId}:`,
            err instanceof Error ? err.message : String(err)
          );
          terminationReason = "error";
          break;
        }

        // Track usage
        this.totalInputTokens += response.usage.input_tokens;
        this.totalOutputTokens += response.usage.output_tokens;

        // T5: tripwire check — if the LLM response contains the internal key,
        // terminate immediately (possible secret exfiltration via injection).
        const responseText = response.content
          .filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        if (checkTripwire(responseText, this.config.internalKey)) {
          terminationReason = "error";
          break;
        }

        // Check for end of conversation
        if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
          terminationReason = response.stop_reason;
          // Add assistant message for completeness
          messages.push({ role: "assistant", content: response.content });
          break;
        }

        // Process tool calls
        const toolUseBlocks = response.content.filter(
          (b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use"
        );

        if (toolUseBlocks.length === 0) {
          // No tool calls and not end_turn — treat as end
          terminationReason = "end_turn";
          messages.push({ role: "assistant", content: response.content });
          break;
        }

        // Add assistant message with tool use blocks
        messages.push({ role: "assistant", content: response.content });

        // Execute each tool call
        const toolResults: ContentBlock[] = [];
        for (const toolBlock of toolUseBlocks) {
          this.toolCallCount++;

          const entry = TOOL_REGISTRY[toolBlock.name];
          let resultContent: string;

          if (!entry) {
            resultContent = JSON.stringify({ error: `Unknown tool: ${toolBlock.name}` });
          } else {
            try {
              const result = await entry.handler(
                this.client,
                this.supervisorRunId,
                toolBlock.input as Record<string, unknown>
              );
              // T5: sanitize tool results — cap length to prevent context stuffing
              resultContent = sanitizeToolResult(result);
            } catch (err) {
              resultContent = JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          // Emit supervisor_tool_call event
          await this.emitEvent("supervisor_tool_call", {
            trigger: this.trigger,
            trigger_run_id: this.triggerRunId,
            rationale: `Tool call: ${toolBlock.name}`,
          });

          // Emit specialized events for proposals and escalations (I-5 status mapping)
          if (entry && !resultContent.includes('"error"')) {
            const input = toolBlock.input as Record<string, unknown>;
            if (
              toolBlock.name === "propose_budget_adjustment" ||
              toolBlock.name === "flag_for_review"
            ) {
              await this.emitEvent("supervisor_proposal_created", {
                trigger: this.trigger,
                trigger_run_id: this.triggerRunId,
                proposal_type:
                  toolBlock.name === "propose_budget_adjustment"
                    ? "budget_adjustment"
                    : "flag_for_review",
                target_agent: (input.target_agent as string) ?? null,
                rationale: (input.rationale as string) ?? null,
                confidence: (input.confidence as number) ?? null,
                status: "pending_approval", // I-5: DB uses "pending", events use "pending_approval"
              });
            } else if (toolBlock.name === "escalate_to_human") {
              await this.emitEvent("supervisor_escalation_created", {
                trigger: this.trigger,
                trigger_run_id: this.triggerRunId,
                severity: (input.severity as string) ?? null,
                rationale: (input.rationale as string) ?? null,
                confidence: (input.confidence as number) ?? null,
                recommendation: (input.recommendation as string) ?? null,
                timeout_seconds: (input.timeout_seconds as number) ?? null,
                timeout_action: (input.timeout_action as string) ?? null,
              });
            }
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: resultContent,
          });

          // Budget check after each tool call
          if (
            this.estimatedCostUsd() >= MAX_SESSION_COST_USD ||
            this.toolCallCount >= MAX_TOOL_CALLS
          ) {
            break;
          }
        }

        // Add tool results as user message
        messages.push({ role: "user", content: toolResults });
      }

      // Check if we hit the tool call limit
      if (this.toolCallCount >= MAX_TOOL_CALLS && terminationReason === "end_turn") {
        terminationReason = "budget_exhausted";
      }
    } catch (err) {
      console.error(
        `[supervisor-session] Session ${this.supervisorRunId} error:`,
        err instanceof Error ? err.message : String(err)
      );
      terminationReason = "error";
    }

    return {
      supervisorRunId: this.supervisorRunId,
      trigger: this.trigger,
      triggerRunId: this.triggerRunId,
      toolCallCount: this.toolCallCount,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      estimatedCostUsd: this.estimatedCostUsd(),
      terminationReason,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private estimatedCostUsd(): number {
    return (
      this.totalInputTokens * COST_PER_INPUT_TOKEN + this.totalOutputTokens * COST_PER_OUTPUT_TOKEN
    );
  }

  private async emitEvent(eventType: string, extra: Record<string, unknown>): Promise<void> {
    try {
      this.eventSeq++;

      // Build the event payload (without hash and hash_prev for hashing).
      // Hash algorithm matches the engine: SHA-256 of serialized payload
      // WITHOUT the hash and hash_prev fields (audit.rs L213-218).
      const payload = {
        schema_version: 1 as const,
        event_type: eventType,
        run_id: this.supervisorRunUuid,
        seq: this.eventSeq,
        ts: new Date().toISOString(),
        supervisor_run_id: this.supervisorRunId,
        agent_name: "loopstorm-supervisor",
        ...extra,
      };

      const payloadJson = JSON.stringify(payload);
      const hash = createHash("sha256").update(payloadJson, "utf8").digest("hex");

      // Use the dedicated supervisor event endpoint (bypasses hash chain
      // verification — see supervisor-tools.ts emitEvent for rationale).
      await this.client.supervisorTools.emitEvent.mutate({
        ...payload,
        hash,
        hash_prev: this.lastHash,
      });

      this.lastHash = hash;
    } catch (err) {
      // Event emission failure is non-fatal — log and continue
      console.warn(
        `[supervisor-session] Failed to emit ${eventType} event:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}
