// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { argsHash } from "../src/args-hash.js";

interface TestVector {
	id: string;
	description: string;
	input: unknown;
	canonical: string;
	sha256: string;
}

const vectorsPath = resolve(
	__dirname,
	"../../../tests/fixtures/args-hash-vectors.json",
);
const vectors: TestVector[] = JSON.parse(
	readFileSync(vectorsPath, "utf-8"),
) as TestVector[];

describe("argsHash", () => {
	it("hashes null as SHA-256 of 'null'", () => {
		expect(argsHash(null)).toBe(
			"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
		);
	});

	it("hashes undefined as SHA-256 of 'null'", () => {
		expect(argsHash(undefined)).toBe(
			"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
		);
	});

	it("hashes empty object", () => {
		expect(argsHash({})).toBe(
			"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
		);
	});

	describe("cross-language test vectors", () => {
		for (const vector of vectors) {
			it(`vector: ${vector.id} — ${vector.description}`, () => {
				expect(argsHash(vector.input)).toBe(vector.sha256);
			});
		}
	});
});
