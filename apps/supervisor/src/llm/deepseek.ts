// SPDX-License-Identifier: MIT
/**
 * DeepSeek LLM provider implementation.
 *
 * Uses DeepSeek's OpenAI-compatible REST API via fetch.
 * No additional SDK dependency required.
 *
 * API reference: https://api-docs.deepseek.com/
 */

import type { ChatParams, ContentBlock, LLMProvider, LLMResponse } from "./provider.js";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

// ---------------------------------------------------------------------------
// DeepSeek V3.2 pricing constants (per-token, USD)
// Source: https://api-docs.deepseek.com/quick_start/pricing (2026-04-10)
// Review quarterly and on every supervisor release (ADR-017 consequence 4).
// ---------------------------------------------------------------------------

/** Cost per input token for DeepSeek V3.2 (`deepseek-chat`): $0.27 / 1M tokens. */
export const DEEPSEEK_COST_PER_INPUT_TOKEN = 0.27 / 1_000_000;
/** Cost per output token for DeepSeek V3.2 (`deepseek-chat`): $1.10 / 1M tokens. */
export const DEEPSEEK_COST_PER_OUTPUT_TOKEN = 1.10 / 1_000_000;

export class DeepSeekProvider implements LLMProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(params: ChatParams): Promise<LLMResponse> {
    const messages = [
      { role: "system", content: params.system },
      ...params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const tools = params.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.max_tokens,
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as DeepSeekResponse;
    const choice = data.choices[0];
    if (!choice) {
      throw new Error("DeepSeek API returned no choices");
    }

    const content: ContentBlock[] = [];

    // Text content
    if (choice.message.content) {
      content.push({ type: "text", text: choice.message.content });
    }

    // Tool calls
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: unknown;
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = tc.function.arguments;
        }
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    const stopReason =
      choice.finish_reason === "tool_calls"
        ? "tool_use"
        : choice.finish_reason === "length"
          ? "max_tokens"
          : "end_turn";

    return {
      content,
      stop_reason: stopReason,
      usage: {
        input_tokens: data.usage.prompt_tokens,
        output_tokens: data.usage.completion_tokens,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// DeepSeek API response types (OpenAI-compatible shape)
// ---------------------------------------------------------------------------

interface DeepSeekResponse {
  choices: Array<{
    finish_reason: string;
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}
