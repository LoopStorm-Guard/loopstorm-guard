// SPDX-License-Identifier: MIT
/**
 * Guard class — the primary entry point for wrapping agent tool calls.
 */

import type { GuardOptions } from "./types.js";

export class Guard {
  private readonly options: GuardOptions;

  constructor(options: GuardOptions = {}) {
    this.options = options;
    // TODO(shim-ts): resolve socket path from env / default
    // TODO(shim-ts): establish UDS connection, verify engine is alive
  }

  /**
   * Wraps a function with LoopStorm enforcement.
   *
   * @param toolName - The tool name for policy matching (e.g., "http.request")
   * @param fn - The function to wrap
   * @returns A wrapped function that enforces policy before each call
   */
  wrap<Args extends unknown[], Return>(
    toolName: string,
    fn: (...args: Args) => Return | Promise<Return>
  ): (...args: Args) => Promise<Return> {
    return async (...args: Args): Promise<Return> => {
      // TODO(shim-ts): serialize args, compute JCS hash (ADR-001)
      // TODO(shim-ts): build DecisionRequest, send over UDS
      // TODO(shim-ts): await DecisionResponse
      // TODO(shim-ts): if deny/kill, throw EnforcementError
      // TODO(shim-ts): if cooldown, sleep cooldown_ms then retry
      void toolName; // suppress unused warning until implemented
      return fn(...args);
    };
  }
}
