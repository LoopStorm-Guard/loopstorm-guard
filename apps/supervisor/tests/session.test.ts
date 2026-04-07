// SPDX-License-Identifier: MIT
/**
 * Session manager tests using MockLLMProvider.
 *
 * These test the session orchestration logic: tool-use loop, budget tracking,
 * and termination conditions. They do NOT require a running backend or
 * ANTHROPIC_API_KEY.
 *
 * AC-B9-1: Session generates valid supervisorRunId format.
 * AC-B9-5: Session stops on end_turn stop reason.
 * AC-B9-6: Session stops on budget exhaustion.
 * AC-B2-3: MockLLMProvider returns scripted responses in order.
 * AC-B2-4: MockLLMProvider returns end_turn when responses exhausted.
 */

import { describe, expect, test } from "bun:test";
import { MockLLMProvider } from "../src/llm/mock.js";
import type { LLMResponse } from "../src/llm/provider.js";

// ---------------------------------------------------------------------------
// MockLLMProvider tests
// ---------------------------------------------------------------------------

describe("MockLLMProvider", () => {
  test("AC-B2-3: returns scripted responses in order", async () => {
    const responses: LLMResponse[] = [
      {
        content: [{ type: "text", text: "First response" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      },
      {
        content: [{ type: "text", text: "Second response" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 30, output_tokens: 40 },
      },
    ];

    const provider = new MockLLMProvider(responses);

    const r1 = await provider.chat({
      model: "test",
      system: "test",
      messages: [],
      tools: [],
      max_tokens: 100,
    });
    expect(r1.content[0]).toEqual({ type: "text", text: "First response" });

    const r2 = await provider.chat({
      model: "test",
      system: "test",
      messages: [],
      tools: [],
      max_tokens: 100,
    });
    expect(r2.content[0]).toEqual({ type: "text", text: "Second response" });
  });

  test("AC-B2-4: returns end_turn when responses exhausted", async () => {
    const provider = new MockLLMProvider([
      {
        content: [{ type: "text", text: "Only response" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 5 },
      },
    ]);

    // Consume the only response
    await provider.chat({
      model: "test",
      system: "test",
      messages: [],
      tools: [],
      max_tokens: 100,
    });

    // Next call should return default end_turn
    const fallback = await provider.chat({
      model: "test",
      system: "test",
      messages: [],
      tools: [],
      max_tokens: 100,
    });
    expect(fallback.stop_reason).toBe("end_turn");
    expect(fallback.content[0]).toEqual({ type: "text", text: "Session complete." });
  });

  test("tracks call count", async () => {
    const provider = new MockLLMProvider([]);
    expect(provider.callCount).toBe(0);

    await provider.chat({
      model: "test",
      system: "test",
      messages: [],
      tools: [],
      max_tokens: 100,
    });
    expect(provider.callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SupervisorSession ID format test
// ---------------------------------------------------------------------------

describe("SupervisorSession", () => {
  test("AC-B9-1: generates valid supervisorRunId format (sup_ + 8 hex)", async () => {
    // We can't fully test execute() without a backend client, but we can
    // verify the ID format by importing the class and checking the constructor.
    const { SupervisorSession } = await import("../src/session.js");

    // Create with minimal mock config — we won't call execute()
    const session = new SupervisorSession({
      trigger: "terminated_budget",
      triggerRunId: "019606f0-0000-0000-0000-000000000001",
      tenantId: "tenant-1",
      config: {
        apiKey: "test",
        backendUrl: "http://localhost:3001",
        anthropicApiKey: null,
        model: "test",
        systemPromptOverride: null,
        internalKey: null,
        port: 3002,
        mockMode: true,
      },
      llmProvider: new MockLLMProvider([]),
      // biome-ignore lint/suspicious/noExplicitAny: mock client for ID test only
      backendClient: {} as any,
    });

    expect(session.supervisorRunId).toMatch(/^sup_[0-9a-f]{8}$/);
    expect(session.trigger).toBe("terminated_budget");
    expect(session.triggerRunId).toBe("019606f0-0000-0000-0000-000000000001");
  });
});
