// SPDX-License-Identifier: MIT
/**
 * Configuration for the AI Supervisor process.
 *
 * All configuration is read from environment variables at startup.
 * Missing required variables throw descriptive errors immediately.
 * The config object is frozen after parsing — no mutation allowed.
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
  /** Anthropic API key (null in mock mode). */
  readonly anthropicApiKey: string | null;
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
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? null;
  const model = process.env.LOOPSTORM_SUPERVISOR_MODEL ?? "claude-3-5-haiku-latest";
  const internalKey = process.env.LOOPSTORM_SUPERVISOR_INTERNAL_KEY ?? null;
  const port = Number(process.env.LOOPSTORM_SUPERVISOR_PORT) || 3002;
  const mockMode = process.env.LOOPSTORM_SUPERVISOR_MOCK === "true";

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

  // Validate: require ANTHROPIC_API_KEY unless mock mode
  if (!mockMode && !anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required when not in mock mode. Set LOOPSTORM_SUPERVISOR_MOCK=true for testing."
    );
  }

  const config: SupervisorConfig = Object.freeze({
    apiKey,
    backendUrl,
    anthropicApiKey,
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
