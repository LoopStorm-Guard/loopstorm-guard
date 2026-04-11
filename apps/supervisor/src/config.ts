// SPDX-License-Identifier: MIT
/**
 * Configuration for the AI Supervisor process.
 *
 * All configuration is read from environment variables at startup.
 * Missing required variables throw descriptive errors immediately.
 * The config object is frozen after parsing — no mutation allowed.
 *
 * T4 (Wave 2): env var renamed from ANTHROPIC_API_KEY → LOOPSTORM_LLM_API_KEY.
 * ANTHROPIC_API_KEY is still accepted as a backward-compat fallback with a
 * deprecation warning so existing deployments continue to work.
 *
 * Spec reference: specs/task-briefs/v1.1-ai-supervisor.md, Task SUP-B3.
 */

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SupervisorConfig {
  /** API key for backend communication. */
  readonly apiKey: string;
  /** Backend URL. */
  readonly backendUrl: string;
  /**
   * LLM provider API key (null in mock mode).
   *
   * T4: renamed from `anthropicApiKey` to `llmApiKey`. In Mode 3 SaaS this
   * holds a DeepSeek key; in Mode 1 with Anthropic this holds an Anthropic key.
   * Populated from LOOPSTORM_LLM_API_KEY (preferred) or ANTHROPIC_API_KEY
   * (deprecated fallback) at parse time.
   */
  readonly llmApiKey: string | null;
  /** LLM model identifier. */
  readonly model: string;
  /** System prompt override (null = use default). */
  readonly systemPromptOverride: string | null;
  /** Internal auth key for the trigger endpoint. */
  readonly internalKey: string | null;
  /** HTTP port for the supervisor process. */
  readonly port: number;
  /** Whether to use mock LLM (for testing). */
  readonly mockMode: boolean;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate configuration from environment variables.
 *
 * @throws Error with descriptive message if required variables are missing.
 */
export function parseConfig(): SupervisorConfig {
  const apiKey = requireEnv("LOOPSTORM_API_KEY");
  const backendUrl = process.env.LOOPSTORM_BACKEND_URL ?? "http://localhost:3001";
  const model = process.env.LOOPSTORM_SUPERVISOR_MODEL ?? "deepseek-chat";
  const internalKey = process.env.LOOPSTORM_SUPERVISOR_INTERNAL_KEY ?? null;
  const port = Number(process.env.LOOPSTORM_SUPERVISOR_PORT) || 3002;
  const mockMode = process.env.LOOPSTORM_SUPERVISOR_MOCK === "true";

  // T4: read LLM API key from LOOPSTORM_LLM_API_KEY (preferred) with
  // ANTHROPIC_API_KEY as a backward-compat fallback + deprecation warning.
  let llmApiKey: string | null = null;
  if (process.env.LOOPSTORM_LLM_API_KEY) {
    llmApiKey = process.env.LOOPSTORM_LLM_API_KEY;
  } else if (process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "[supervisor] DEPRECATION WARNING: The env var ANTHROPIC_API_KEY is deprecated. " +
        "Rename it to LOOPSTORM_LLM_API_KEY. ANTHROPIC_API_KEY will stop being read in v1.2. " +
        "See ADR-017 Amendment 2026-04-10."
    );
    llmApiKey = process.env.ANTHROPIC_API_KEY;
  }

  // System prompt: env var takes precedence over file path
  let systemPromptOverride: string | null = null;
  if (process.env.LOOPSTORM_SUPERVISOR_SYSTEM_PROMPT) {
    systemPromptOverride = process.env.LOOPSTORM_SUPERVISOR_SYSTEM_PROMPT;
  } else if (process.env.LOOPSTORM_SUPERVISOR_SYSTEM_PROMPT_PATH) {
    try {
      systemPromptOverride = readFileSync(
        process.env.LOOPSTORM_SUPERVISOR_SYSTEM_PROMPT_PATH,
        "utf-8"
      );
    } catch (err) {
      throw new Error(
        `Failed to read system prompt from path "${process.env.LOOPSTORM_SUPERVISOR_SYSTEM_PROMPT_PATH}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Validate: require LLM API key unless mock mode
  if (!mockMode && !llmApiKey) {
    throw new Error(
      "LOOPSTORM_LLM_API_KEY is required when not in mock mode. " +
        "Set LOOPSTORM_SUPERVISOR_MOCK=true for testing, or set LOOPSTORM_LLM_API_KEY to your " +
        "DeepSeek API key (sk-...). The deprecated ANTHROPIC_API_KEY env var is also accepted " +
        "as a fallback but will stop being read in v1.2."
    );
  }

  const config: SupervisorConfig = Object.freeze({
    apiKey,
    backendUrl,
    llmApiKey,
    model,
    systemPromptOverride,
    internalKey,
    port,
    mockMode,
  });

  return config;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}
