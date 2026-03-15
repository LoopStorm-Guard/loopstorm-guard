// SPDX-License-Identifier: MIT
/**
 * @loopstorm/schemas — re-exports TypeScript types generated from JSON schemas.
 *
 * JSON schema files are the canonical source (ADR-003). TypeScript types are
 * derived from them and kept in sync via CI.
 */

// Raw schema exports for runtime validation
export { default as policySchema } from "./policy/policy.schema.json" assert { type: "json" };
export { default as decisionRequestSchema } from "./ipc/decision-request.schema.json" assert {
  type: "json",
};
export { default as decisionResponseSchema } from "./ipc/decision-response.schema.json" assert {
  type: "json",
};
export { default as eventSchema } from "./events/event.schema.json" assert { type: "json" };

// TypeScript type definitions (handwritten to match schemas exactly)
export type { DecisionRequest, DecisionResponse, Decision } from "./types/ipc.js";
export type { LoopStormEvent, EventType } from "./types/events.js";
export type { PolicyPack, PolicyRule, BudgetConfig } from "./types/policy.js";
