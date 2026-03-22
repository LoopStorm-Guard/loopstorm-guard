// SPDX-License-Identifier: MIT
import { describe, expect, it } from "bun:test";
import {
	ApprovalRequiredError,
	ConnectionClosedError,
	CooldownError,
	EngineUnavailableError,
	LoopStormError,
	MessageTooLargeError,
	PolicyDeniedError,
	RunTerminatedError,
} from "../src/errors.js";

describe("LoopStormError", () => {
	it("is an instance of Error", () => {
		const err = new LoopStormError("test");
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(LoopStormError);
		expect(err.name).toBe("LoopStormError");
	});
});

describe("EngineUnavailableError", () => {
	it("has a default message", () => {
		const err = new EngineUnavailableError();
		expect(err.message).toContain("Engine is not running");
	});

	it("accepts a custom message", () => {
		const err = new EngineUnavailableError("connection refused");
		expect(err.message).toBe("connection refused");
	});

	it("extends LoopStormError", () => {
		expect(new EngineUnavailableError()).toBeInstanceOf(LoopStormError);
	});
});

describe("PolicyDeniedError", () => {
	it("includes rule_id and reason in message", () => {
		const err = new PolicyDeniedError("block-ssrf", "SSRF blocked");
		expect(err.message).toContain("policy denied");
		expect(err.message).toContain("rule=block-ssrf");
		expect(err.message).toContain("SSRF blocked");
		expect(err.ruleId).toBe("block-ssrf");
		expect(err.reason).toBe("SSRF blocked");
	});

	it("works without rule_id or reason", () => {
		const err = new PolicyDeniedError();
		expect(err.message).toBe("policy denied");
	});
});

describe("CooldownError", () => {
	it("includes cooldown_ms in message", () => {
		const err = new CooldownError(5000, "rate limited");
		expect(err.message).toContain("cooldown 5000ms");
		expect(err.message).toContain("rate limited");
		expect(err.cooldownMs).toBe(5000);
		expect(err.cooldownMessage).toBe("rate limited");
	});
});

describe("RunTerminatedError", () => {
	it("includes rule_id and reason", () => {
		const err = new RunTerminatedError("budget-exceeded", "cost limit");
		expect(err.message).toContain("run terminated");
		expect(err.message).toContain("rule=budget-exceeded");
		expect(err.ruleId).toBe("budget-exceeded");
	});
});

describe("ApprovalRequiredError", () => {
	it("includes approval details", () => {
		const err = new ApprovalRequiredError("apr-001", 30000, "deny");
		expect(err.message).toContain("id=apr-001");
		expect(err.message).toContain("timeout=30000ms");
		expect(err.message).toContain("action=deny");
		expect(err.approvalId).toBe("apr-001");
		expect(err.timeoutMs).toBe(30000);
		expect(err.timeoutAction).toBe("deny");
	});
});

describe("ConnectionClosedError", () => {
	it("has the expected message", () => {
		const err = new ConnectionClosedError();
		expect(err.message).toContain("closed the connection");
	});
});

describe("MessageTooLargeError", () => {
	it("includes the message size", () => {
		const err = new MessageTooLargeError(70000);
		expect(err.message).toContain("70000");
		expect(err.message).toContain("65536");
		expect(err.size).toBe(70000);
	});
});
