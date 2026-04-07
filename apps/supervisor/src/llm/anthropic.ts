// SPDX-License-Identifier: MIT
/**
 * Anthropic LLM provider implementation.
 *
 * Wraps the @anthropic-ai/sdk to implement the LLMProvider interface.
 * Maps between our ChatParams/LLMResponse types and the Anthropic API shape.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ChatParams, ContentBlock, LLMProvider, LLMResponse } from "./provider.js";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(params: ChatParams): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: params.model,
      system: params.system,
      // biome-ignore lint/suspicious/noExplicitAny: Anthropic SDK message type mapping
      messages: params.messages as any,
      // biome-ignore lint/suspicious/noExplicitAny: Anthropic SDK tool type mapping
      tools: params.tools as any,
      max_tokens: params.max_tokens,
    });

    // Map Anthropic response to our LLMResponse
    const content: ContentBlock[] = response.content.map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text };
      }
      if (block.type === "tool_use") {
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
      // Fallback for unknown block types
      return { type: "text" as const, text: JSON.stringify(block) };
    });

    const stopReason =
      response.stop_reason === "tool_use"
        ? "tool_use"
        : response.stop_reason === "max_tokens"
          ? "max_tokens"
          : "end_turn";

    return {
      content,
      stop_reason: stopReason,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}
