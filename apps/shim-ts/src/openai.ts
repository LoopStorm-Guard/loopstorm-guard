// SPDX-License-Identifier: MIT
/**
 * OpenAI client adapter — gates tool calls without importing openai.
 *
 * Duck-types the OpenAI client interface. No openai package required.
 * Synchronous create() only in v1 — async/streaming out of scope.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Minimal interface for the guard's check method (avoids circular import). */
interface GuardLike {
  check(
    toolName: string,
    options?: { args?: Record<string, unknown> }
  ): Promise<{ decision: string }>;
}

/** Proxy for client.chat.completions that gates tool calls. */
class OpenAIGuardedCompletions {
  private readonly completions: any;
  private readonly guard: GuardLike;

  constructor(completions: any, guard: GuardLike) {
    this.completions = completions;
    this.guard = guard;
  }

  /** Call the underlying create() and gate any tool calls in the response. */
  async create(...args: any[]): Promise<any> {
    const response = await this.completions.create(...args);
    await this.checkToolCalls(response);
    return response;
  }

  private async checkToolCalls(response: any): Promise<void> {
    for (const choice of response.choices) {
      const msg = choice?.message;
      if (!msg) continue;
      const toolCalls = msg.tool_calls;
      if (!toolCalls) continue;
      for (const tc of toolCalls) {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        await this.guard.check(tc.function.name as string, { args });
      }
    }
  }
}

/** Proxy for client.chat that provides guarded completions. */
class OpenAIGuardedChat {
  private readonly chat: any;
  private readonly guard: GuardLike;

  constructor(chat: any, guard: GuardLike) {
    this.chat = chat;
    this.guard = guard;
  }

  get completions(): OpenAIGuardedCompletions {
    return new OpenAIGuardedCompletions(this.chat.completions, this.guard);
  }
}

/**
 * Proxy wrapping an OpenAI client to gate tool calls via LoopStorm Guard.
 *
 * @example
 * ```ts
 * const guarded = guard.openai(client);
 * const response = await guarded.chat.completions.create({ model: "gpt-4o", ... });
 * ```
 *
 * Only `chat.completions.create()` is intercepted.
 * All other attributes pass through to the underlying client.
 */
export class OpenAIGuardedClient {
  private readonly client: any;
  private readonly guard: GuardLike;

  constructor(client: any, guard: GuardLike) {
    this.client = client;
    this.guard = guard;
  }

  get chat(): OpenAIGuardedChat {
    return new OpenAIGuardedChat(this.client.chat, this.guard);
  }

  /** Proxy all other properties to the underlying client. */
  get models(): any {
    return this.client.models;
  }

  get completions(): any {
    return this.client.completions;
  }

  get embeddings(): any {
    return this.client.embeddings;
  }
}
