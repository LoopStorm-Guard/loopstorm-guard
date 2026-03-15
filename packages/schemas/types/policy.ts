// SPDX-License-Identifier: MIT
/**
 * TypeScript types for policy packs.
 * These must stay in sync with schemas/policy/policy.schema.json.
 */

export type PolicyAction = "allow" | "deny" | "require_approval";
export type ComparisonOperator =
	| "equals"
	| "not_equals"
	| "matches"
	| "not_matches"
	| "in"
	| "not_in";

export interface PolicyCondition {
  field: string;
  operator: ComparisonOperator;
  value?: string | string[];
  pattern?: string;
}

export interface PolicyRule {
  name: string;
  action: PolicyAction;
  tool?: string;
  tool_pattern?: string;
  conditions?: PolicyCondition[];
  timeout?: number;
  timeout_action?: "deny" | "allow" | "kill";
  reason?: string;
  priority?: number;
}

export interface BudgetDimensionFloat {
  hard: number;
  soft?: number;
}

export interface BudgetDimensionInt {
  hard: number;
  soft?: number;
}

export interface BudgetConfig {
  cost_usd?: BudgetDimensionFloat;
  input_tokens?: BudgetDimensionInt;
  output_tokens?: BudgetDimensionInt;
  call_count?: BudgetDimensionInt;
}

export interface LoopDetectionConfig {
  enabled?: boolean;
  identical_call_window_seconds?: number;
  identical_call_threshold?: number;
  identical_error_threshold?: number;
  cooldown_ms?: number;
}

export interface RedactionPattern {
  name: string;
  pattern: string;
  replacement?: string;
}

export interface RedactionConfig {
  enabled?: boolean;
  additional_patterns?: RedactionPattern[];
  key_patterns?: string[];
}

export interface PolicyPack {
  schema_version: 1;
  name?: string;
  description?: string;
  agent_role?: string;
  environment?: string;
  rules: [PolicyRule, ...PolicyRule[]]; // at least one rule required
  budget?: BudgetConfig;
  loop_detection?: LoopDetectionConfig;
  redaction?: RedactionConfig;
}
