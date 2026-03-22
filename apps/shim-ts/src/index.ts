// SPDX-License-Identifier: MIT
/**
 * LoopStorm Guard TypeScript shim.
 *
 * Wraps agent tool calls and forwards them to the loopstorm-engine binary
 * over IPC (Unix Domain Socket or named pipe) for enforcement.
 *
 * Mode 0 (air-gapped): the engine binary is bundled; no network calls are made.
 *
 * @example
 * ```ts
 * import { Guard } from "@loopstorm/shim-ts";
 *
 * const guard = new Guard({ socketPath: "/tmp/loopstorm-engine.sock" });
 *
 * const safeFetch = guard.wrap("http.request", fetch);
 * const response = await safeFetch("https://example.com");
 *
 * guard.close();
 * ```
 */

// Core
export { Guard } from "./guard.js";
export { OpenAIGuardedClient } from "./openai.js";

// Utilities
export { argsHash } from "./args-hash.js";
export { jcsSerialize } from "./jcs.js";

// Types
export type {
  GuardOptions,
  DecisionResult,
  BudgetRemaining,
  EnforcementDecision,
} from "./types.js";

// Errors
export {
  LoopStormError,
  EngineUnavailableError,
  PolicyDeniedError,
  CooldownError,
  RunTerminatedError,
  ApprovalRequiredError,
  ConnectionClosedError,
  MessageTooLargeError,
} from "./errors.js";
