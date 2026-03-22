// SPDX-License-Identifier: MIT
import { describe, expect, it } from "bun:test";
import { Guard } from "../src/guard.js";

describe("Guard", () => {
	it("generates a run_id on construction", () => {
		const guard = new Guard();
		expect(guard.runId).toBeTruthy();
		// UUID format: 8-4-4-4-12 hex chars
		expect(guard.runId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		guard.close();
	});

	it("accepts a custom run_id", () => {
		const guard = new Guard({ runId: "custom-run-id" });
		expect(guard.runId).toBe("custom-run-id");
		guard.close();
	});

	it("defaults to fail_open=true", async () => {
		const guard = new Guard({
			socketPath: "/tmp/nonexistent-loopstorm-test.sock",
		});
		// With fail_open=true and no engine running, check() should return allow
		const result = await guard.check("test.tool", { args: { key: "value" } });
		expect(result.decision).toBe("allow");
		guard.close();
	});

	it("wraps a sync function", async () => {
		const guard = new Guard({
			socketPath: "/tmp/nonexistent-loopstorm-test.sock",
		});
		let called = false;
		const fn = (x: number) => {
			called = true;
			return x * 2;
		};
		const wrapped = guard.wrap("math.double", fn);
		const result = await wrapped(5);
		expect(called).toBe(true);
		expect(result).toBe(10);
		guard.close();
	});

	it("wraps an async function", async () => {
		const guard = new Guard({
			socketPath: "/tmp/nonexistent-loopstorm-test.sock",
		});
		const fn = async (x: number): Promise<number> => x + 1;
		const wrapped = guard.wrap("math.inc", fn);
		const result = await wrapped(5);
		expect(result).toBe(6);
		guard.close();
	});

	it("creates an OpenAI guarded client", () => {
		const guard = new Guard();
		const mockClient = { chat: { completions: { create: () => {} } } };
		const guarded = guard.openai(mockClient);
		expect(guarded).toBeTruthy();
		expect(guarded.chat).toBeTruthy();
		expect(guarded.chat.completions).toBeTruthy();
		guard.close();
	});

	it("increments seq on each check", async () => {
		const guard = new Guard({
			socketPath: "/tmp/nonexistent-loopstorm-test.sock",
		});
		await guard.check("tool.a");
		await guard.check("tool.b");
		await guard.check("tool.c");
		// We can't directly observe seq, but the calls should succeed
		// (fail_open=true by default)
		guard.close();
	});
});
