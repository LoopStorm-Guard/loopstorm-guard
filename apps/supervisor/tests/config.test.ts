// SPDX-License-Identifier: MIT
/**
 * Configuration parsing tests.
 */

import { describe, expect, test } from "bun:test";
import { parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  test("AC-B3-1: throws on missing LOOPSTORM_API_KEY", () => {
    const original = process.env.LOOPSTORM_API_KEY;
    process.env.LOOPSTORM_API_KEY = undefined;
    try {
      expect(() => parseConfig()).toThrow("LOOPSTORM_API_KEY");
    } finally {
      if (original) process.env.LOOPSTORM_API_KEY = original;
    }
  });

  test("AC-B3-1: throws when ANTHROPIC_API_KEY missing and not mock mode", () => {
    const origApi = process.env.LOOPSTORM_API_KEY;
    const origAnth = process.env.ANTHROPIC_API_KEY;
    const origMock = process.env.LOOPSTORM_SUPERVISOR_MOCK;

    process.env.LOOPSTORM_API_KEY = "test-key";
    process.env.ANTHROPIC_API_KEY = undefined;
    process.env.LOOPSTORM_SUPERVISOR_MOCK = undefined;
    try {
      expect(() => parseConfig()).toThrow("ANTHROPIC_API_KEY");
    } finally {
      if (origApi) process.env.LOOPSTORM_API_KEY = origApi;
      else process.env.LOOPSTORM_API_KEY = undefined;
      if (origAnth) process.env.ANTHROPIC_API_KEY = origAnth;
      if (origMock) process.env.LOOPSTORM_SUPERVISOR_MOCK = origMock;
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
      if (origApi) process.env.LOOPSTORM_API_KEY = origApi;
      else process.env.LOOPSTORM_API_KEY = undefined;
      if (origMock) process.env.LOOPSTORM_SUPERVISOR_MOCK = origMock;
      else process.env.LOOPSTORM_SUPERVISOR_MOCK = undefined;
      if (origPrompt) process.env.LOOPSTORM_SUPERVISOR_SYSTEM_PROMPT = origPrompt;
      else process.env.LOOPSTORM_SUPERVISOR_SYSTEM_PROMPT = undefined;
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
      if (origApi) process.env.LOOPSTORM_API_KEY = origApi;
      else process.env.LOOPSTORM_API_KEY = undefined;
      if (origMock) process.env.LOOPSTORM_SUPERVISOR_MOCK = origMock;
      else process.env.LOOPSTORM_SUPERVISOR_MOCK = undefined;
    }
  });
});
