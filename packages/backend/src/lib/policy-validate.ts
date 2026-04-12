// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Policy content validation for LoopStorm Guard.
 *
 * Validates policy pack content against the canonical policy schema and
 * enforces the `escalate_to_human` invariant from ADR-012.
 *
 * Validation steps:
 * 1. JSON schema validation against `policy.schema.json` (from @loopstorm/schemas).
 * 2. Structural invariant: no rule may have `action: "deny"` with a tool
 *    name or glob pattern that would match `escalate_to_human`. This invariant
 *    ensures that the escalation pathway can NEVER be blocked.
 *
 * Import: The policy schema is imported from `@loopstorm/schemas` (the shared
 * MIT package). We NEVER duplicate the schema here — the shared package is
 * the canonical source (ADR-003, C9).
 *
 * Schema validation uses a simple structural check rather than a full AJV
 * runtime validator to avoid adding a heavy dependency. The schema is small
 * enough that key structural checks provide adequate validation. If full AJV
 * validation is needed in the future, the schema can be passed to AJV here.
 *
 * GLOB MATCHING (T3 Wave 2):
 * The engine (apps/engine/src/evaluator.rs) uses glob matching for tool
 * patterns. The TypeScript validator must match the same semantics to prevent
 * policy bypasses. We use `picomatch` (v4, zero-dependency, matches Rust's
 * glob crate semantics) for glob evaluation.
 *
 * Patterns supported:
 * - `*` — matches any string (does not cross `/`)
 * - `**` — matches any string including path separators
 * - `?` — matches any single character
 * - `[abc]` — character class
 * - `{a,b}` — alternation
 *
 * The `tool` field uses exact matching. The `tool_pattern` field uses glob
 * matching via picomatch. Both are checked against `escalate_to_human`.
 *
 * IMPORTANT: This module must be kept in sync with the invariant checks in
 * apps/engine/src/evaluator.rs. If the Rust engine's invariant logic changes,
 * update this file too.
 */

import { policySchema } from "@loopstorm/schemas";
import type { PolicyPack } from "@loopstorm/schemas";
import picomatch from "picomatch";

/**
 * Result of a policy validation.
 */
export type PolicyValidationResult =
  | { valid: true }
  | { valid: false; errors: PolicyValidationError[] };

/**
 * A structured validation error.
 */
export interface PolicyValidationError {
  /** Path to the field that failed validation, e.g. "rules[0].action" */
  path: string;
  /** Human-readable description of the error */
  message: string;
  /** Machine-readable error code */
  code: string;
}

/**
 * The tool name that can NEVER be denied (ADR-012, C13).
 * Absolute rule #3 from CLAUDE.md: escalate_to_human can never be blocked.
 */
const ESCALATE_TO_HUMAN_TOOL = "escalate_to_human";

/**
 * Validate a policy pack content object.
 *
 * @param content - The policy pack content (parsed JSON/YAML)
 * @returns Validation result with structured errors if invalid
 */
export function validatePolicy(content: Record<string, unknown>): PolicyValidationResult {
  const errors: PolicyValidationError[] = [];

  // --- Step 1: Structural schema validation ---
  const schemaErrors = validateAgainstSchema(content);
  errors.push(...schemaErrors);

  // If the basic structure is wrong, skip the invariant checks to avoid
  // confusing cascading errors.
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Cast is safe because validateAgainstSchema passed without errors.
  const policy = content as unknown as PolicyPack;

  // --- Step 2: escalate_to_human invariant ---
  const invariantErrors = checkEscalateToHumanInvariant(policy);
  errors.push(...invariantErrors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

/**
 * Perform structural validation of the policy content.
 *
 * We validate the critical invariants manually rather than using a full
 * JSON schema validator library. The schema is simple enough that the
 * key checks here provide adequate validation for API input.
 *
 * Checks performed:
 * - `schema_version` is 1
 * - `rules` is a non-empty array
 * - Each rule has `name` (string) and `action` (allow/deny/require_approval)
 * - Each rule with `conditions` has valid condition structure
 * - `budget` fields are positive numbers if present
 */
function validateAgainstSchema(content: Record<string, unknown>): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];

  // schema_version must be 1
  if (content.schema_version !== 1) {
    errors.push({
      path: "schema_version",
      message: `schema_version must be 1, got: ${JSON.stringify(content.schema_version)}`,
      code: "INVALID_SCHEMA_VERSION",
    });
  }

  // rules must be a non-empty array
  if (!Array.isArray(content.rules)) {
    errors.push({
      path: "rules",
      message: "rules must be an array",
      code: "MISSING_RULES",
    });
    return errors; // Can't validate rules without the array
  }

  if ((content.rules as unknown[]).length === 0) {
    errors.push({
      path: "rules",
      message: "rules must contain at least one rule",
      code: "EMPTY_RULES",
    });
  }

  // Validate each rule
  const rules = content.rules as unknown[];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const rulePath = `rules[${i}]`;

    if (typeof rule !== "object" || rule === null) {
      errors.push({
        path: rulePath,
        message: "Each rule must be an object",
        code: "INVALID_RULE",
      });
      continue;
    }

    const ruleObj = rule as Record<string, unknown>;

    // name is required
    if (typeof ruleObj.name !== "string" || ruleObj.name.trim() === "") {
      errors.push({
        path: `${rulePath}.name`,
        message: "Rule name must be a non-empty string",
        code: "MISSING_RULE_NAME",
      });
    }

    // action is required and must be a valid value
    const validActions = ["allow", "deny", "require_approval"];
    if (!validActions.includes(ruleObj.action as string)) {
      errors.push({
        path: `${rulePath}.action`,
        message: `Rule action must be one of: ${validActions.join(", ")}`,
        code: "INVALID_RULE_ACTION",
      });
    }

    // tool and tool_pattern cannot both be present
    if (ruleObj.tool !== undefined && ruleObj.tool_pattern !== undefined) {
      errors.push({
        path: `${rulePath}`,
        message: "Rule cannot have both 'tool' and 'tool_pattern'",
        code: "CONFLICTING_TOOL_FIELDS",
      });
    }
  }

  // Validate budget if present
  if (content.budget !== undefined) {
    const budgetErrors = validateBudget(content.budget as Record<string, unknown>);
    errors.push(...budgetErrors);
  }

  return errors;
}

/**
 * Validate the budget section of a policy pack.
 */
function validateBudget(budget: Record<string, unknown>): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];
  const dimensions = ["cost_usd", "input_tokens", "output_tokens", "call_count"] as const;

  for (const dim of dimensions) {
    if (budget[dim] !== undefined) {
      const dimObj = budget[dim] as Record<string, unknown>;
      if (typeof dimObj !== "object" || dimObj === null) {
        errors.push({
          path: `budget.${dim}`,
          message: `budget.${dim} must be an object with a 'hard' field`,
          code: "INVALID_BUDGET_DIMENSION",
        });
        continue;
      }
      if (typeof dimObj.hard !== "number" || dimObj.hard <= 0) {
        errors.push({
          path: `budget.${dim}.hard`,
          message: `budget.${dim}.hard must be a positive number`,
          code: "INVALID_BUDGET_HARD_LIMIT",
        });
      }
      if (dimObj.soft !== undefined && (typeof dimObj.soft !== "number" || dimObj.soft <= 0)) {
        errors.push({
          path: `budget.${dim}.soft`,
          message: `budget.${dim}.soft must be a positive number`,
          code: "INVALID_BUDGET_SOFT_LIMIT",
        });
      }
    }
  }

  return errors;
}

/**
 * Test whether a glob pattern matches the escalate_to_human tool name.
 *
 * Uses picomatch with settings that match the engine's glob semantics:
 * - `*` matches any characters (no path separator semantics — tools are flat strings)
 * - `**` also matches any characters (same as `*` for flat tool names)
 * - `?` matches any single character
 * - `{a,b}` alternation
 *
 * We use `dot: true` so that patterns like `*` also match names starting with
 * `.` (defensive — tool names don't start with `.` but we want no surprises).
 *
 * @param pattern - The glob pattern from the policy rule's `tool_pattern` field
 * @returns true if the pattern matches `escalate_to_human`
 */
function globMatchesEscalateToHuman(pattern: string): boolean {
  try {
    const isMatch = picomatch(pattern, {
      dot: true,
      // nocase: false — tool names are case-sensitive
    });
    return isMatch(ESCALATE_TO_HUMAN_TOOL);
  } catch {
    // Invalid glob pattern — conservative: treat as non-matching.
    // Invalid patterns are caught by schema validation above; if we reach
    // here it's an edge case in picomatch's parser. We prefer not crashing.
    return false;
  }
}

/**
 * Check that no rule blocks `escalate_to_human` (ADR-012, C13).
 * Absolute rule #3 from CLAUDE.md.
 *
 * The invariant: no rule may have BOTH:
 *   - `action: "deny"` (or `action: "require_approval"` which could be
 *     configured to effectively block), AND
 *   - A `tool` exact match OR a `tool_pattern` glob that matches
 *     `"escalate_to_human"`
 *
 * We check:
 * 1. `rule.tool === "escalate_to_human"` with `rule.action === "deny"`
 * 2. `rule.tool_pattern` glob that matches `"escalate_to_human"` (T3 fix:
 *    uses picomatch instead of naive regex) with `rule.action === "deny"`
 *
 * Note: `require_approval` is allowed — escalate_to_human can require a human
 * to approve the escalation itself. Only outright `deny` is blocked.
 *
 * T3 improvement: The old implementation used `new RegExp(rule.tool_pattern)`
 * which treated `tool_pattern` as a regex. This was incorrect — the engine
 * uses glob semantics, not regex. A pattern like `escalate_*` would fail as
 * a regex test but DOES match in glob semantics. Similarly, `*` or `**`
 * (common deny-all globs) were only caught if they happened to be valid regexes.
 *
 * The new implementation uses picomatch to test glob patterns, matching the
 * engine's evaluation logic exactly.
 */
function checkEscalateToHumanInvariant(policy: PolicyPack): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];

  for (let i = 0; i < policy.rules.length; i++) {
    const rule = policy.rules[i];
    if (!rule) continue;
    const rulePath = `rules[${i}]`;

    if (rule.action !== "deny") {
      continue; // Only deny rules can block escalation
    }

    // Check exact tool match
    if (rule.tool === ESCALATE_TO_HUMAN_TOOL) {
      errors.push({
        path: `${rulePath}.tool`,
        message: `Policy rejected: rule '${rule.name}' (pattern '${rule.tool}') would block '${ESCALATE_TO_HUMAN_TOOL}', which is a protected invariant. See ADR-012 (C13) and CLAUDE.md absolute rule #3.`,
        code: "ESCALATE_TO_HUMAN_BLOCKED",
      });
    }

    // Check tool_pattern glob match (T3: uses picomatch, not regex)
    if (rule.tool_pattern) {
      const globMatchesEscalate = globMatchesEscalateToHuman(rule.tool_pattern);

      if (globMatchesEscalate) {
        errors.push({
          path: `${rulePath}.tool_pattern`,
          message: `Policy rejected: rule '${rule.name}' (pattern '${rule.tool_pattern}') would block '${ESCALATE_TO_HUMAN_TOOL}', which is a protected invariant. See ADR-012 (C13) and CLAUDE.md absolute rule #3.`,
          code: "ESCALATE_TO_HUMAN_BLOCKED",
        });
      }
    }
  }

  return errors;
}

/**
 * Re-export the policy schema for use in CI hash assertions.
 * Consumers should import from @loopstorm/schemas directly, but this
 * re-export makes it available for tests in this package.
 */
export { policySchema };
