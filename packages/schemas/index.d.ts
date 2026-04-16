// SPDX-License-Identifier: MIT
// Type declarations for @loopstorm/schemas — mirrors the runtime exports in
// index.js. TypeScript consumers resolve this file via the "types" exports
// condition; Bun consumers resolve index.ts directly via the "bun" condition.

export declare const policySchema: Record<string, unknown>;
export declare const decisionRequestSchema: Record<string, unknown>;
export declare const decisionResponseSchema: Record<string, unknown>;
export declare const eventSchema: Record<string, unknown>;

export type { DecisionRequest, DecisionResponse, Decision } from "./types/ipc.js";
export type { LoopStormEvent, EventType } from "./types/events.js";
export type { PolicyPack, PolicyRule, BudgetConfig } from "./types/policy.js";
