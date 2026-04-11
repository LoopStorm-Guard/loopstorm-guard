// SPDX-License-Identifier: MIT
/**
 * Configuration parsing tests.
 */

import { describe, expect, test } from "bun:test";
import { parseConfig } from "../src/config.js";

/**
 * Restore or delete an env var based on its original value.
 * Using `process.env.X = undefined` coerces to the string "undefined" in
 * Node/Bun, so we must `delete` the key when the original was unset.
 */
function restoreEnv(key: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = original;
  }
}

describe("parseConfig", () => {
  test("AC-B3-1: throws on missing LOOPSTORM_API_KEY", () => {
    const original = process.env.LOOPSTORM_API_KEY;
    delete process.env.LOOPSTORM_API_KEY;
    try {
      expect(() => parseConfig()).toThrow("LOOPSTORM_API_KEY");
    } finally {
      restoreEnv("LOOPSTORM_API_KEY", original);
    }
  });

  test("T4: throws when LOOPSTORM_LLM_API_KEY missing and ANTHROPIC_API_KEY missing and not mock mode", () => {
    const origApi = process.env.LOOPSTORM_API_KEY;
    const origLlm = process.env.LOOPSTORM_LLM_API_KEY;
    const origAnth = process.env.ANTHROPIC_API_KEY;
    const origMock = process.env.LOOPSTORM_SUPERVISOR_MOCK;

    process.env.LOOPSTORM_API_KEY = "test-key";
    delete process.env.LOOPSTORM_LLM_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LOOPSTORM_SUPERVISOR_MOCK;
    try {
      // Error message must name the new canonical var, not the deprecated one
      expect(() => parseConfig()).toThrow("LOOPSTORM_LLM_API_KEY");
    } finally {
      restoreEnv("LOOPSTORM_API_KEY", origApi);
      restoreEnv("LOOPSTORM_LLM_API_KEY", origLlm);
      restoreEnv("ANTHROPIC_API_KEY", origAnth);
      restoreEnv("LOOPSTORM_SUPERVISOR_MOCK", origMock);
    }
  });

  test("T4: ANTHROPIC_API_KEY accepted as fallback when LOOPSTORM_LLM_API_KEY is absent", () => {
    const origApi = process.env.LOOPSTORM_API_KEY;
    const origLlm = process.env.LOOPSTORM_LLM_API_KEY;
    const origAnth = process.env.ANTHROPIC_API_KEY;
    const origMock = process.env.LOOPSTORM_SUPERVISOR_MOCK;

    process.env.LOOPSTORM_API_KEY = "test-key";
    delete process.env.LOOPSTORM_LLM_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-deprecated-fallback";
    delete process.env.LOOPSTORM_SUPERVISOR_MOCK;
    try {
      // Should not throw — ANTHROPIC_API_KEY is the fallback
      const config = parseConfig();
      expect(config.llmApiKey).toBe("sk-ant-deprecated-fallback");
    } finally {
      restoreEnv("LOOPSTORM_API_KEY", origApi);
      restoreEnv("LOOPSTORM_LLM_API_KEY", origLlm);
      restoreEnv("ANTHROPIC_API_KEY", origAnth);
      restoreEnv("LOOPSTORM_SUPERVISOR_MOCK", origMock);
    }
  });

  test("T4: LOOPSTORM_LLM_API_KEY takes precedence over ANTHROPIC_API_KEY", () => {
    const origApi = process.env.LOOPSTORM_API_KEY;
    const origLlm = process.env.LOOPSTORM_LLM_API_KEY;
    const origAnth = process.env.ANTHROPIC_API_KEY;
    const origMock = process.env.LOOPSTORM_SUPERVISOR_MOCK;

    process.env.LOOPSTORM_API_KEY = "test-key";
    process.env.LOOPSTORM_LLM_API_KEY = "sk-new-preferred-key";
    process.env.ANTHROPIC_API_KEY = "sk-old-deprecated-key";
    delete process.env.LOOPSTORM_SUPERVISOR_MOCK;
    try {
      const config = parseConfig();
      // Must use the new key, not the deprecated one
      expect(config.llmApiKey).toBe("sk-new-preferred-key");
    } finally {
      restoreEnv("LOOPSTORM_API_KEY", origApi);
      restoreEnv("LOOPSTORM_LLM_API_KEY", origLlm);
      restoreEnv("ANTHROPIC_API_KEY", origAnth);
      restoreEnv("LOOPSTORM_SUPERVISOR_MOCK", origMock);
    }
  });

  test("AC-B3-2: system prompt override from env var", () => {
    const origApi = process.env.LOOPSTORM_API_KEY;
    const origMock = process.env.LOOPSTORM_SUPERVISOR_MOCK;
    const origPrompt = process.env.LOOPSTORM_SUPERVISOR_SYSTEM_PROMPT;

    process.env.LOOPSTORM_API_KEY = "test-key";
    process.env.LOOPSTORM_SUPERVISOR_MOCK = "true";
    process.env.LOOPSTORM_SUPERVISOR_SYSTEM_PROMPT = "Custom prompt";
    try {
      const config = parseConfig();
      expect(config.systemPromptOverride).toBe("Custom prompt");
    } finally {
      restoreEnv("LOOPSTORM_API_KEY", origApi);
      restoreEnv("LOOPSTORM_SUPERVISOR_MOCK", origMock);
      restoreEnv("LOOPSTORM_SUPERVISOR_SYSTEM_PROMPT", origPrompt);
    }
  });

  test("AC-B3-3: config is frozen after parsing", () => {
    const origApi = process.env.LOOPSTORM_API_KEY;
    const origMock = process.env.LOOPSTORM_SUPERVISOR_MOCK;

    process.env.LOOPSTORM_API_KEY = "test-key";
    process.env.LOOPSTORM_SUPERVISOR_MOCK = "true";
    try {
      const config = parseConfig();
      expect(Object.isFrozen(config)).toBe(true);
    } finally {
      restoreEnv("LOOPSTORM_API_KEY", origApi);
      restoreEnv("LOOPSTORM_SUPERVISOR_MOCK", origMock);
    }
  });
});
