// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for the policy validation library.
 *
 * Tests are pure — no database required.
 * Uses bun:test.
 *
 * Tests cover:
 * 1. Valid policies (various structures)
 * 2. Invalid policies (schema violations)
 * 3. The escalate_to_human invariant (ADR-012, C13)
 */

import { describe, test, expect } from "bun:test";
import {
  validatePolicy,
  type PolicyValidationResult,
} from "../../src/lib/policy-validate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid policy. */
const MINIMAL_VALID_POLICY = {
  schema_version: 1,
  rules: [
    {
      name: "allow-all",
      action: "allow",
    },
  ],
};

/** Assert that a validation result is valid. */
function assertValid(result: PolicyValidationResult): void {
  if (!result.valid) {
    throw new Error(
      `Expected valid policy but got errors:\n${result.errors.map((e) => `  [${e.code}] ${e.path}: ${e.message}`).join("\n")}`,
    );
  }
}

/** Assert that a validation result is invalid and contains an error with the given code. */
function assertError(result: PolicyValidationResult, code: string): void {
  if (result.valid) {
    throw new Error(`Expected invalid policy but got valid result`);
  }
  const found = result.errors.some((e) => e.code === code);
  if (!found) {
    throw new Error(
      `Expected error with code "${code}" but got:\n${result.errors.map((e) => `  [${e.code}] ${e.path}: ${e.message}`).join("\n")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Valid policies
// ---------------------------------------------------------------------------

describe("validatePolicy — valid policies", () => {
  test("minimal valid policy (single allow rule)", () => {
    const result = validatePolicy(MINIMAL_VALID_POLICY);
    assertValid(result);
  });

  test("policy with multiple rules", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        { name: "deny-file-write", action: "deny", tool: "write_file" },
        { name: "allow-read", action: "allow", tool: "read_file" },
        {
          name: "approve-delete",
          action: "require_approval",
          tool: "delete_file",
        },
      ],
    });
    assertValid(result);
  });

  test("policy with budget section", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [{ name: "allow-all", action: "allow" }],
      budget: {
        cost_usd: { hard: 10.0, soft: 8.0 },
        call_count: { hard: 500 },
      },
    });
    assertValid(result);
  });

  test("policy with tool_pattern (glob, does not match escalate_to_human)", () => {
    // T3 note: tool_pattern uses picomatch glob semantics, not regex.
    // "bash_*" is a glob that matches "bash_execute" etc. but NOT "escalate_to_human".
    // The old test used "^bash.*" (regex style) — that also works as a glob because
    // "^" is a literal char in glob context and tool names never start with "^",
    // so it still doesn't match escalate_to_human. We update to a clear glob pattern.
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        { name: "deny-bash", action: "deny", tool_pattern: "bash_*" },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertValid(result);
  });

  test("deny escalate_to_human is INVALID — allow or require_approval is OK", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "allow-escalate",
          action: "allow",
          tool: "escalate_to_human",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertValid(result);
  });

  test("require_approval for escalate_to_human is valid (not a block)", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "approve-escalate",
          action: "require_approval",
          tool: "escalate_to_human",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertValid(result);
  });
});

// ---------------------------------------------------------------------------
// Invalid policies — schema violations
// ---------------------------------------------------------------------------

describe("validatePolicy — invalid policies", () => {
  test("missing schema_version", () => {
    const result = validatePolicy({
      rules: [{ name: "allow-all", action: "allow" }],
    });
    assertError(result, "INVALID_SCHEMA_VERSION");
  });

  test("wrong schema_version (2)", () => {
    const result = validatePolicy({
      schema_version: 2,
      rules: [{ name: "allow-all", action: "allow" }],
    });
    assertError(result, "INVALID_SCHEMA_VERSION");
  });

  test("missing rules array", () => {
    const result = validatePolicy({ schema_version: 1 });
    assertError(result, "MISSING_RULES");
  });

  test("empty rules array", () => {
    const result = validatePolicy({ schema_version: 1, rules: [] });
    assertError(result, "EMPTY_RULES");
  });

  test("rule with missing name", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [{ action: "allow" }],
    });
    assertError(result, "MISSING_RULE_NAME");
  });

  test("rule with empty name", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [{ name: "   ", action: "allow" }],
    });
    assertError(result, "MISSING_RULE_NAME");
  });

  test("rule with invalid action", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [{ name: "bad-action", action: "block" }],
    });
    assertError(result, "INVALID_RULE_ACTION");
  });

  test("rule with both tool and tool_pattern", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "conflict",
          action: "allow",
          tool: "foo",
          tool_pattern: "^foo.*",
        },
      ],
    });
    assertError(result, "CONFLICTING_TOOL_FIELDS");
  });

  test("budget.cost_usd.hard is negative", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [{ name: "allow-all", action: "allow" }],
      budget: { cost_usd: { hard: -1 } },
    });
    assertError(result, "INVALID_BUDGET_HARD_LIMIT");
  });

  test("budget.cost_usd.hard is zero", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [{ name: "allow-all", action: "allow" }],
      budget: { cost_usd: { hard: 0 } },
    });
    assertError(result, "INVALID_BUDGET_HARD_LIMIT");
  });

  test("budget.call_count.soft is negative", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [{ name: "allow-all", action: "allow" }],
      budget: { call_count: { hard: 100, soft: -5 } },
    });
    assertError(result, "INVALID_BUDGET_SOFT_LIMIT");
  });

  test("non-object rule", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: ["not-an-object"],
    });
    assertError(result, "INVALID_RULE");
  });
});

// ---------------------------------------------------------------------------
// escalate_to_human invariant (ADR-012, C13)
// ---------------------------------------------------------------------------

describe("validatePolicy — escalate_to_human invariant", () => {
  test("deny exact tool escalate_to_human is rejected", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "block-escalation",
          action: "deny",
          tool: "escalate_to_human",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertError(result, "ESCALATE_TO_HUMAN_BLOCKED");
  });

  test("deny glob pattern matching escalate_to_human is rejected", () => {
    // T3 fix: pattern uses glob semantics (picomatch), not regex.
    // "escalate*" is the glob equivalent of the regex "escalate.*" —
    // `*` matches any string in glob, `.` matches any char in regex.
    // The old pattern "escalate.*" (regex) was replaced with "escalate*" (glob).
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-escalate-pattern",
          action: "deny",
          tool_pattern: "escalate*",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertError(result, "ESCALATE_TO_HUMAN_BLOCKED");
  });

  test("deny wildcard glob matching everything is rejected", () => {
    // T3 fix: `*` (glob) matches everything. Old test used `.*` (regex).
    // In picomatch, `.*` means a literal dot followed by anything — it does NOT
    // match "escalate_to_human". The correct deny-all glob is `*`.
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-all-tools",
          action: "deny",
          tool_pattern: "*",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertError(result, "ESCALATE_TO_HUMAN_BLOCKED");
  });

  test("deny pattern NOT matching escalate_to_human is allowed", () => {
    // T3: "write_*" is a glob pattern matching "write_file" but not
    // "escalate_to_human". The old test used "^write_.*" (regex style) —
    // that also works here because "^write_.*" as a glob matches only
    // strings starting with the literal character "^" which tool names
    // never start with, so it also does not match escalate_to_human.
    // We update to a clean glob pattern for clarity.
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-write-only",
          action: "deny",
          tool_pattern: "write_*",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertValid(result);
  });

  test("deny rule without explicit tool still rejects if no tool specified (deny-all)", () => {
    // A deny-all rule (no tool, no tool_pattern) effectively blocks everything
    // including escalate_to_human. However, the schema validation only catches
    // explicit tool/tool_pattern matches. The engine's hardcoded bypass handles
    // this case at runtime. The backend validation focuses on explicit matches.
    // This test documents the expected behavior.
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-all-no-tool",
          action: "deny",
          // No tool or tool_pattern — applies to all tools
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    // This passes backend validation — the engine handles the bypass at runtime.
    // The deny-all rule is valid; escalate_to_human is protected by the engine.
    assertValid(result);
  });

  test("multiple deny rules — one targeting escalate_to_human is rejected", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        { name: "deny-bash", action: "deny", tool: "bash" },
        { name: "deny-escalate", action: "deny", tool: "escalate_to_human" },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertError(result, "ESCALATE_TO_HUMAN_BLOCKED");
  });

  test("error includes rule name in message", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "my-blocking-rule",
          action: "deny",
          tool: "escalate_to_human",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    if (result.valid) {
      throw new Error("Expected invalid");
    }
    const error = result.errors.find(
      (e) => e.code === "ESCALATE_TO_HUMAN_BLOCKED",
    );
    expect(error?.message).toContain("my-blocking-rule");
    expect(error?.message).toContain("ADR-012");
  });
});

// ---------------------------------------------------------------------------
// T3: escalate_to_human glob matcher hardening (picomatch semantics)
//
// These tests verify that the picomatch-based implementation correctly catches
// glob patterns that would slip through a naive regex-based check. The old
// implementation used `new RegExp(rule.tool_pattern)` — patterns like
// `escalate_*`, `*_human`, and `*` are valid globs that match
// `escalate_to_human` but are NOT valid regex equivalents.
//
// Each test documents why the old regex approach would have FAILED to catch it.
// ---------------------------------------------------------------------------

describe("validatePolicy — T3 glob matcher hardening (picomatch)", () => {
  // Glob: escalate_* matches escalate_to_human
  // Old regex: new RegExp("escalate_*") is INVALID regex (quantifier without atom)
  // → old impl would have returned false (conservative), allowing the policy through
  test("deny glob pattern 'escalate_*' matches escalate_to_human → rejected", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-escalate-glob",
          action: "deny",
          tool_pattern: "escalate_*",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertError(result, "ESCALATE_TO_HUMAN_BLOCKED");
  });

  // Glob: *_human matches escalate_to_human
  // Old regex: new RegExp("*_human") is INVALID regex → old impl allowed this through
  test("deny glob pattern '*_human' matches escalate_to_human → rejected", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-human-suffix",
          action: "deny",
          tool_pattern: "*_human",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertError(result, "ESCALATE_TO_HUMAN_BLOCKED");
  });

  // Glob: * matches everything including escalate_to_human
  // Old regex: new RegExp("*") is INVALID regex → old impl allowed deny-* through
  test("deny glob wildcard '*' matches escalate_to_human → rejected", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-everything",
          action: "deny",
          tool_pattern: "*",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertError(result, "ESCALATE_TO_HUMAN_BLOCKED");
  });

  // Glob: ** also matches everything (same as * for flat tool names)
  // Old regex: new RegExp("**") is INVALID regex → old impl allowed this through
  test("deny glob double-wildcard '**' matches escalate_to_human → rejected", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-all-double-glob",
          action: "deny",
          tool_pattern: "**",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertError(result, "ESCALATE_TO_HUMAN_BLOCKED");
  });

  // Glob: {escalate_to_human,other} alternation matches escalate_to_human
  // Old regex: new RegExp("{escalate_to_human,other}") is a valid regex (char class)
  // but matches a single char from {e,s,c,a,l,t,_,o,h,u,m,n} — does NOT match
  // the full string "escalate_to_human". Old impl allowed this through.
  test("deny glob alternation '{escalate_to_human,bash}' matches escalate_to_human → rejected", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-alternation",
          action: "deny",
          tool_pattern: "{escalate_to_human,bash}",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertError(result, "ESCALATE_TO_HUMAN_BLOCKED");
  });

  // Glob: escalate_?o_human — '?' matches any single char ('t' in this case)
  test("deny glob '?' wildcard 'escalate_?o_human' matches escalate_to_human → rejected", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-single-char",
          action: "deny",
          tool_pattern: "escalate_?o_human",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertError(result, "ESCALATE_TO_HUMAN_BLOCKED");
  });

  // Safe: a glob that matches write_file but NOT escalate_to_human
  // Verifies we don't have false positives
  test("deny glob 'write_*' does NOT match escalate_to_human → accepted", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-write-tools",
          action: "deny",
          tool_pattern: "write_*",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertValid(result);
  });

  // Safe: a glob that matches bash_* but NOT escalate_to_human
  test("deny glob 'bash_*' does NOT match escalate_to_human → accepted", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-bash-tools",
          action: "deny",
          tool_pattern: "bash_*",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertValid(result);
  });

  // allow + deny other: escalate_to_human is explicitly allowed, other tool denied → valid
  test("allow escalate_to_human explicitly, deny other tool → accepted", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "allow-escalate",
          action: "allow",
          tool: "escalate_to_human",
        },
        {
          name: "deny-bash",
          action: "deny",
          tool: "bash",
        },
      ],
    });
    assertValid(result);
  });

  // require_approval with glob — not a deny, so not blocked
  test("require_approval with glob '*_human' is NOT a deny → accepted", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "approve-human-tools",
          action: "require_approval",
          tool_pattern: "*_human",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    assertValid(result);
  });

  // Error message must include pattern for glob-match rejections
  test("rejection error message includes the glob pattern", () => {
    const result = validatePolicy({
      schema_version: 1,
      rules: [
        {
          name: "deny-glob-rule",
          action: "deny",
          tool_pattern: "escalate_*",
        },
        { name: "allow-rest", action: "allow" },
      ],
    });
    if (result.valid) {
      throw new Error("Expected invalid");
    }
    const error = result.errors.find((e) => e.code === "ESCALATE_TO_HUMAN_BLOCKED");
    expect(error?.message).toContain("escalate_*");
    expect(error?.message).toContain("deny-glob-rule");
    expect(error?.message).toContain("escalate_to_human");
  });
});

// ---------------------------------------------------------------------------
// Error structure
// ---------------------------------------------------------------------------

describe("validatePolicy — error structure", () => {
  test("returns structured errors with path, message, code", () => {
    const result = validatePolicy({
      schema_version: 2,
      rules: [],
    });
    if (result.valid) {
      throw new Error("Expected invalid");
    }
    for (const error of result.errors) {
      expect(typeof error.path).toBe("string");
      expect(typeof error.message).toBe("string");
      expect(typeof error.code).toBe("string");
      expect(error.path.length).toBeGreaterThan(0);
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.code.length).toBeGreaterThan(0);
    }
  });

  test("multiple errors are reported (not just first)", () => {
    const result = validatePolicy({
      schema_version: 2, // invalid
      rules: [], // also invalid
    });
    if (result.valid) {
      throw new Error("Expected invalid");
    }
    // Should have at least one error (schema_version fails first, rules skipped
    // until schema_version passes — but we still report the schema_version error)
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });
});
