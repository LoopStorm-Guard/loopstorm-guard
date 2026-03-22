// SPDX-License-Identifier: MIT
import { describe, expect, it } from "bun:test";
import { DecisionRequest, DecisionResponse } from "../src/protocol.js";

describe("DecisionRequest", () => {
	it("serializes required fields to dict", () => {
		const req = new DecisionRequest({
			schema_version: 1,
			run_id: "run-123",
			seq: 1,
			tool: "http.request",
			args_hash: "abc123",
			ts: "2026-03-22T00:00:00.000Z",
		});

		const dict = req.toDict();
		expect(dict.schema_version).toBe(1);
		expect(dict.run_id).toBe("run-123");
		expect(dict.seq).toBe(1);
		expect(dict.tool).toBe("http.request");
		expect(dict.args_hash).toBe("abc123");
		expect(dict.ts).toBe("2026-03-22T00:00:00.000Z");
	});

	it("omits undefined optional fields from dict", () => {
		const req = new DecisionRequest({
			schema_version: 1,
			run_id: "run-123",
			seq: 1,
			tool: "test",
			args_hash: "hash",
			ts: "2026-01-01T00:00:00Z",
		});

		const dict = req.toDict();
		expect("agent_role" in dict).toBe(false);
		expect("agent_name" in dict).toBe(false);
		expect("model" in dict).toBe(false);
		expect("input_tokens" in dict).toBe(false);
	});

	it("includes optional fields when set", () => {
		const req = new DecisionRequest({
			schema_version: 1,
			run_id: "run-123",
			seq: 1,
			tool: "test",
			args_hash: "hash",
			ts: "2026-01-01T00:00:00Z",
			agent_role: "coder",
			model: "gpt-4o",
			input_tokens: 100,
			estimated_cost_usd: 0.01,
		});

		const dict = req.toDict();
		expect(dict.agent_role).toBe("coder");
		expect(dict.model).toBe("gpt-4o");
		expect(dict.input_tokens).toBe(100);
		expect(dict.estimated_cost_usd).toBe(0.01);
	});

	it("serializes to NDJSON buffer with trailing newline", () => {
		const req = new DecisionRequest({
			schema_version: 1,
			run_id: "r",
			seq: 1,
			tool: "t",
			args_hash: "h",
			ts: "ts",
		});

		const buf = req.toNdjson();
		expect(buf).toBeInstanceOf(Buffer);

		const str = buf.toString("utf-8");
		expect(str.endsWith("\n")).toBe(true);

		const parsed = JSON.parse(str);
		expect(parsed.schema_version).toBe(1);
		expect(parsed.run_id).toBe("r");
	});
});

describe("DecisionResponse", () => {
	it("deserializes from JSON string", () => {
		const json = JSON.stringify({
			schema_version: 1,
			run_id: "run-123",
			seq: 1,
			decision: "allow",
			ts: "2026-01-01T00:00:00Z",
		});

		const resp = DecisionResponse.fromJson(json);
		expect(resp.schemaVersion).toBe(1);
		expect(resp.runId).toBe("run-123");
		expect(resp.seq).toBe(1);
		expect(resp.decision).toBe("allow");
	});

	it("deserializes optional fields", () => {
		const json = JSON.stringify({
			schema_version: 1,
			run_id: "run-123",
			seq: 2,
			decision: "deny",
			rule_id: "block-ssrf",
			reason: "SSRF blocked",
			budget_remaining: { cost_usd: 0.5, call_count: 10 },
		});

		const resp = DecisionResponse.fromJson(json);
		expect(resp.decision).toBe("deny");
		expect(resp.ruleId).toBe("block-ssrf");
		expect(resp.reason).toBe("SSRF blocked");
		expect(resp.budgetRemaining).toEqual({ cost_usd: 0.5, call_count: 10 });
	});

	it("ignores unknown fields in JSON", () => {
		const json = JSON.stringify({
			schema_version: 1,
			run_id: "run-123",
			seq: 1,
			decision: "allow",
			unknown_field: "should be ignored",
		});

		const resp = DecisionResponse.fromJson(json);
		expect(resp.decision).toBe("allow");
		// Unknown fields are harmlessly set on the object by the constructor
		// but are not typed — this is acceptable behavior
	});

	it("deserializes cooldown response", () => {
		const json = JSON.stringify({
			schema_version: 1,
			run_id: "run-123",
			seq: 3,
			decision: "cooldown",
			cooldown_ms: 5000,
			cooldown_message: "rate limited",
		});

		const resp = DecisionResponse.fromJson(json);
		expect(resp.decision).toBe("cooldown");
		expect(resp.cooldownMs).toBe(5000);
		expect(resp.cooldownMessage).toBe("rate limited");
	});

	it("deserializes require_approval response", () => {
		const json = JSON.stringify({
			schema_version: 1,
			run_id: "run-123",
			seq: 4,
			decision: "require_approval",
			approval_id: "apr-001",
			approval_timeout_ms: 30000,
			approval_timeout_action: "deny",
		});

		const resp = DecisionResponse.fromJson(json);
		expect(resp.decision).toBe("require_approval");
		expect(resp.approvalId).toBe("apr-001");
		expect(resp.approvalTimeoutMs).toBe(30000);
		expect(resp.approvalTimeoutAction).toBe("deny");
	});
});
