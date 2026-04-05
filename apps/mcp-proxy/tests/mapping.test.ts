// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { argsHash } from "@loopstorm/ipc-client";
import { DecisionResponse } from "@loopstorm/ipc-client";
import {
  LOOPSTORM_APPROVAL_REQUIRED,
  LOOPSTORM_COOLDOWN,
  LOOPSTORM_DENIED,
  LOOPSTORM_KILLED,
} from "../src/errors.js";
import { decisionResponseToMcpError, mcpToolCallToDecisionRequest } from "../src/mapping.js";

const fixturesPath = resolve(__dirname, "../../../tests/fixtures/args-hash-vectors.json");

describe("mcpToolCallToDecisionRequest", () => {
  test("maps MCP fields to DecisionRequest", () => {
    const req = mcpToolCallToDecisionRequest(
      { name: "file.read", arguments: { path: "/tmp/test.txt" } },
      { runId: "run-1", seq: 3, agentName: "agent-1", agentRole: "worker", environment: "prod" }
    );
    expect(req.tool).toBe("file.read");
    expect(req.runId).toBe("run-1");
    expect(req.seq).toBe(3);
    expect(req.agentName).toBe("agent-1");
    expect(req.agentRole).toBe("worker");
    expect(req.environment).toBe("prod");
    expect(req.schemaVersion).toBe(1);
    expect(req.argsHash).toHaveLength(64);
  });

  test("handles null arguments", () => {
    const req = mcpToolCallToDecisionRequest({ name: "tool" }, { runId: "r", seq: 1 });
    // SHA-256 of "null"
    expect(req.argsHash).toBe("74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b");
  });

  test("seq is used as-is", () => {
    const req = mcpToolCallToDecisionRequest({ name: "t" }, { runId: "r", seq: 42 });
    expect(req.seq).toBe(42);
  });
});

describe("decisionResponseToMcpError", () => {
  test("allow returns null", () => {
    const resp = new DecisionResponse({
      schema_version: 1,
      run_id: "r",
      seq: 1,
      decision: "allow",
    });
    expect(decisionResponseToMcpError(resp)).toBeNull();
  });

  test("deny returns LOOPSTORM_DENIED", () => {
    const resp = new DecisionResponse({
      schema_version: 1,
      run_id: "r",
      seq: 1,
      decision: "deny",
      rule_id: "block-ssrf",
      reason: "blocked",
    });
    const err = decisionResponseToMcpError(resp)!;
    expect(err.code).toBe(LOOPSTORM_DENIED);
    expect(err.message).toBe("Tool call denied by policy");
    expect(err.data.loopstorm).toBe(true);
    expect(err.data.rule_id).toBe("block-ssrf");
  });

  test("cooldown returns LOOPSTORM_COOLDOWN", () => {
    const resp = new DecisionResponse({
      schema_version: 1,
      run_id: "r",
      seq: 1,
      decision: "cooldown",
      cooldown_ms: 5000,
      cooldown_message: "try different approach",
    });
    const err = decisionResponseToMcpError(resp)!;
    expect(err.code).toBe(LOOPSTORM_COOLDOWN);
    expect(err.data.cooldown_ms).toBe(5000);
  });

  test("kill returns LOOPSTORM_KILLED", () => {
    const resp = new DecisionResponse({
      schema_version: 1,
      run_id: "r",
      seq: 1,
      decision: "kill",
      reason: "budget exceeded",
    });
    const err = decisionResponseToMcpError(resp)!;
    expect(err.code).toBe(LOOPSTORM_KILLED);
    expect(err.data.reason).toBe("budget exceeded");
  });

  test("require_approval returns LOOPSTORM_APPROVAL_REQUIRED", () => {
    const resp = new DecisionResponse({
      schema_version: 1,
      run_id: "r",
      seq: 1,
      decision: "require_approval",
      approval_id: "appr-1",
      approval_timeout_ms: 30000,
    });
    const err = decisionResponseToMcpError(resp)!;
    expect(err.code).toBe(LOOPSTORM_APPROVAL_REQUIRED);
    expect(err.data.approval_id).toBe("appr-1");
  });

  test("unknown decision returns LOOPSTORM_KILLED", () => {
    const resp = new DecisionResponse({
      schema_version: 1,
      run_id: "r",
      seq: 1,
      decision: "mystery",
    });
    const err = decisionResponseToMcpError(resp)!;
    expect(err.code).toBe(LOOPSTORM_KILLED);
  });
});

describe("args_hash cross-language vectors", () => {
  const vectors = JSON.parse(readFileSync(fixturesPath, "utf-8")) as {
    id: string;
    input: unknown;
    sha256: string;
  }[];

  for (const v of vectors) {
    test(`vector ${v.id}`, () => {
      expect(argsHash(v.input)).toBe(v.sha256);
    });
  }
});
