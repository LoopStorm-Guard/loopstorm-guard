// SPDX-License-Identifier: MIT
import { describe, expect, it } from "bun:test";
import { OpenAIGuardedClient } from "../src/openai.js";

describe("OpenAIGuardedClient", () => {
	it("proxies chat.completions.create and checks tool calls", async () => {
		const checkedCalls: { tool: string; args: Record<string, unknown> }[] = [];

		const mockGuard = {
			async check(
				toolName: string,
				options?: { args?: Record<string, unknown> },
			) {
				checkedCalls.push({
					tool: toolName,
					args: options?.args ?? {},
				});
				return { decision: "allow" };
			},
		};

		const mockResponse = {
			choices: [
				{
					message: {
						tool_calls: [
							{
								function: {
									name: "get_weather",
									arguments: JSON.stringify({ city: "London" }),
								},
							},
						],
					},
				},
			],
		};

		const mockClient = {
			chat: {
				completions: {
					create: async () => mockResponse,
				},
			},
		};

		const guarded = new OpenAIGuardedClient(mockClient, mockGuard);
		const result = await guarded.chat.completions.create({
			model: "gpt-4o",
		});

		expect(result).toBe(mockResponse);
		expect(checkedCalls).toHaveLength(1);
		expect(checkedCalls[0]!.tool).toBe("get_weather");
		expect(checkedCalls[0]!.args).toEqual({ city: "London" });
	});

	it("checks multiple tool calls in a single response", async () => {
		const checkedCalls: string[] = [];

		const mockGuard = {
			async check(toolName: string) {
				checkedCalls.push(toolName);
				return { decision: "allow" };
			},
		};

		const mockClient = {
			chat: {
				completions: {
					create: async () => ({
						choices: [
							{
								message: {
									tool_calls: [
										{
											function: {
												name: "read_file",
												arguments: '{"path":"/etc/passwd"}',
											},
										},
										{
											function: {
												name: "write_file",
												arguments: '{"path":"/tmp/out","data":"hi"}',
											},
										},
									],
								},
							},
						],
					}),
				},
			},
		};

		const guarded = new OpenAIGuardedClient(mockClient, mockGuard);
		await guarded.chat.completions.create({});

		expect(checkedCalls).toEqual(["read_file", "write_file"]);
	});

	it("passes through responses without tool calls", async () => {
		const mockGuard = {
			async check() {
				return { decision: "allow" };
			},
		};

		const mockResponse = {
			choices: [
				{
					message: { content: "Hello!", tool_calls: undefined },
				},
			],
		};

		const mockClient = {
			chat: {
				completions: {
					create: async () => mockResponse,
				},
			},
		};

		const guarded = new OpenAIGuardedClient(mockClient, mockGuard);
		const result = await guarded.chat.completions.create({});
		expect(result).toBe(mockResponse);
	});
});
