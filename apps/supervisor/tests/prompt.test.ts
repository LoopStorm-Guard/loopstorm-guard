// SPDX-License-Identifier: MIT
/**
 * System prompt tests.
 *
 * AC-B8-1: Default prompt matches spec.
 * AC-B8-2: Override from config takes precedence.
 */

import { describe, expect, test } from "bun:test";
import type { SupervisorConfig } from "../src/config.js";
import { DEFAULT_SYSTEM_PROMPT, getSystemPrompt } from "../src/prompt.js";

function makeConfig(overrides: Partial<SupervisorConfig> = {}): SupervisorConfig {
  return {
    apiKey: "test",
    backendUrl: "http://localhost:3001",
    llmApiKey: null,
    model: "test",
    systemPromptOverride: null,
    internalKey: null,
    port: 3002,
    mockMode: true,
    ...overrides,
  };
}

describe("getSystemPrompt", () => {
  test("AC-B8-1: default prompt contains required sections", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("PLANE SEPARATION");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("CONSTRAINTS");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("BEHAVIORAL GUIDELINES");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("escalate_to_human");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("compute_risk_score");
  });

  test("T5: default prompt includes prompt injection defense section", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("untrusted_data");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("DATA ONLY");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("prompt injection attack");
  });

  test("AC-B8-1: returns default when no override", () => {
    const config = makeConfig();
    expect(getSystemPrompt(config)).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  test("AC-B8-2: override takes precedence", () => {
    const config = makeConfig({ systemPromptOverride: "Custom override prompt" });
    expect(getSystemPrompt(config)).toBe("Custom override prompt");
  });
});
