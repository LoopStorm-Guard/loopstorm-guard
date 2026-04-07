// SPDX-License-Identifier: MIT
/**
 * Deterministic mock LLM provider for testing.
 *
 * Returns pre-scripted LLMResponse objects in order. When responses are
 * exhausted, returns an end_turn response with "Session complete." text.
 *
 * This allows full supervisor session testing without real LLM API calls.
 * No ANTHROPIC_API_KEY is required.
 *
 * Spec reference: specs/task-briefs/v1.1-ai-supervisor.md, MD-3.
 */

import type { ChatParams, LLMProvider, LLMResponse } from "./provider.js";

export class MockLLMProvider implements LLMProvider {
  private responses: LLMResponse[];
  private callIndex = 0;

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
  }

  async chat(_params: ChatParams): Promise<LLMResponse> {
    const response = this.responses[this.callIndex];
    this.callIndex++;
    if (!response) {
      return {
        content: [{ type: "text", text: "Session complete." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    }
    return response;
  }

  /** Number of chat() calls made so far. */
  get callCount(): number {
    return this.callIndex;
  }
}
