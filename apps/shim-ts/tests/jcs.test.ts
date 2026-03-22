// SPDX-License-Identifier: MIT
import { describe, expect, it } from "bun:test";
import { jcsSerialize } from "../src/jcs.js";

describe("jcsSerialize", () => {
	it("serializes null", () => {
		expect(jcsSerialize(null)).toBe("null");
	});

	it("serializes undefined as null", () => {
		expect(jcsSerialize(undefined)).toBe("null");
	});

	it("serializes booleans", () => {
		expect(jcsSerialize(true)).toBe("true");
		expect(jcsSerialize(false)).toBe("false");
	});

	it("serializes integers", () => {
		expect(jcsSerialize(0)).toBe("0");
		expect(jcsSerialize(42)).toBe("42");
		expect(jcsSerialize(-1)).toBe("-1");
	});

	it("serializes integer-valued floats without decimal", () => {
		expect(jcsSerialize(1.0)).toBe("1");
		expect(jcsSerialize(100.0)).toBe("100");
	});

	it("serializes -0 as 0", () => {
		expect(jcsSerialize(-0)).toBe("0");
	});

	it("serializes floats", () => {
		expect(jcsSerialize(0.1)).toBe("0.1");
		expect(jcsSerialize(3.14)).toBe("3.14");
	});

	it("serializes scientific notation numbers", () => {
		expect(jcsSerialize(1e2)).toBe("100");
	});

	it("rejects NaN", () => {
		expect(() => jcsSerialize(NaN)).toThrow("JCS does not support");
	});

	it("rejects Infinity", () => {
		expect(() => jcsSerialize(Infinity)).toThrow("JCS does not support");
		expect(() => jcsSerialize(-Infinity)).toThrow("JCS does not support");
	});

	it("serializes simple strings", () => {
		expect(jcsSerialize("hello")).toBe('"hello"');
	});

	it("escapes control characters", () => {
		expect(jcsSerialize("hello\nworld")).toBe('"hello\\nworld"');
		expect(jcsSerialize("tab\there")).toBe('"tab\\there"');
	});

	it("escapes backslash and quotes", () => {
		expect(jcsSerialize('C:\\Users\\test')).toBe('"C:\\\\Users\\\\test"');
		expect(jcsSerialize('said "hi"')).toBe('"said \\"hi\\""');
	});

	it("preserves unicode as literal UTF-8", () => {
		expect(jcsSerialize("José")).toBe('"José"');
		expect(jcsSerialize("🔥")).toBe('"🔥"');
	});

	it("serializes empty array", () => {
		expect(jcsSerialize([])).toBe("[]");
	});

	it("serializes array with mixed types", () => {
		expect(jcsSerialize([1, "two", null, true])).toBe('[1,"two",null,true]');
	});

	it("serializes empty object", () => {
		expect(jcsSerialize({})).toBe("{}");
	});

	it("sorts object keys alphabetically", () => {
		expect(jcsSerialize({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
	});

	it("sorts nested object keys recursively", () => {
		expect(
			jcsSerialize({ config: { retry: true, timeout: 30 }, action: "fetch" }),
		).toBe('{"action":"fetch","config":{"retry":true,"timeout":30}}');
	});

	it("handles deeply nested objects", () => {
		expect(jcsSerialize({ a: { b: { c: { d: "deep" } } } })).toBe(
			'{"a":{"b":{"c":{"d":"deep"}}}}',
		);
	});
});
