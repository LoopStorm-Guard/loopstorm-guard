// SPDX-License-Identifier: MIT
/**
 * LLM provider interface for the AI Supervisor.
 *
 * This abstraction allows swapping between the real Anthropic API and a
 * deterministic mock for testing. The interface mirrors the Claude Messages
 * API shape closely to minimize mapping overhead.
 *
 * ADR-014 Gate 4: LLM provider interface.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatParams {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  max_tokens: number;
}

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[] | string;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMResponse {
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  usage: { input_tokens: number; output_tokens: number };
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface LLMProvider {
  chat(params: ChatParams): Promise<LLMResponse>;
}
