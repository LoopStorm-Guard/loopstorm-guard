// SPDX-License-Identifier: MIT
/**
 * LoopStorm Guard TypeScript shim.
 *
 * Wraps agent tool calls and forwards them to the loopstorm-engine binary
 * over a Unix Domain Socket for enforcement.
 *
 * Mode 0 (air-gapped): the engine binary is bundled; no network calls are made.
 *
 * @example
 * ```ts
 * import { Guard } from "@loopstorm/shim-ts";
 *
 * const guard = new Guard({ policy: "./policy.yaml" });
 *
 * const safeFetch = guard.wrap("http.request", fetch);
 * ```
 */

export { Guard } from "./guard.js";
export type { GuardOptions, ToolCall, EnforcementDecision } from "./types.js";
