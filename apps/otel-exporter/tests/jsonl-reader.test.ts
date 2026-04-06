// SPDX-License-Identifier: MIT

import { describe, test, expect } from "bun:test";
import { JsonlReader } from "../src/jsonl-reader.js";
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RUN_ID = "01960e07-d0e9-7ad0-8621-5614ec0dbd54";

function makeEventLine(seq: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    event_type: "policy_decision",
    run_id: RUN_ID,
    seq,
    hash: "a".repeat(64),
    hash_prev: seq === 1 ? null : "b".repeat(64),
    ts: "2026-04-05T10:00:00.000Z",
    ...extra,
  });
}

function tmpFile(suffix = ".jsonl"): string {
  const dir = join(tmpdir(), `otel-reader-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, `test${suffix}`);
}

describe("JsonlReader - processOnce", () => {
  test("reads all existing lines on startup", async () => {
    const path = tmpFile();
    const line1 = makeEventLine(1);
    const line2 = makeEventLine(2);
    writeFileSync(path, line1 + "\n" + line2 + "\n", "utf8");

    const events: unknown[] = [];
    const reader = new JsonlReader(path, (event) => events.push(event));
    await reader.processOnce();

    expect(events).toHaveLength(2);
    const cursorPath = `${path}.otel-cursor`;
    expect(existsSync(cursorPath)).toBe(true);

    // Cleanup
    unlinkSync(path);
    unlinkSync(cursorPath);
  });

  test("handles file with no trailing newline", async () => {
    const path = tmpFile();
    const line1 = makeEventLine(1);
    writeFileSync(path, line1, "utf8"); // no trailing newline

    const events: unknown[] = [];
    const reader = new JsonlReader(path, (event) => events.push(event));
    await reader.processOnce();

    // Partial line (no terminating \n) not emitted
    expect(events).toHaveLength(0);

    unlinkSync(path);
    const cursorPath = `${path}.otel-cursor`;
    if (existsSync(cursorPath)) unlinkSync(cursorPath);
  });

  test("skips malformed JSON lines with a warning", async () => {
    const path = tmpFile();
    const good = makeEventLine(1);
    const bad = "not valid json {{{";
    const good2 = makeEventLine(2);
    writeFileSync(path, good + "\n" + bad + "\n" + good2 + "\n", "utf8");

    const events: unknown[] = [];
    const reader = new JsonlReader(path, (event) => events.push(event));

    // Suppress console output in test
    const originalWarn = console.warn;
    console.warn = () => {};
    await reader.processOnce();
    console.warn = originalWarn;

    expect(events).toHaveLength(2);

    unlinkSync(path);
    const cursorPath = `${path}.otel-cursor`;
    if (existsSync(cursorPath)) unlinkSync(cursorPath);
  });

  test("skips lines missing required fields", async () => {
    const path = tmpFile();
    const good = makeEventLine(1);
    const missingRunId = JSON.stringify({
      schema_version: 1,
      event_type: "run_started",
      seq: 2,
      hash: "a".repeat(64),
      hash_prev: null,
      ts: "2026-04-05T10:00:00.000Z",
      // run_id missing
    });
    writeFileSync(path, good + "\n" + missingRunId + "\n", "utf8");

    const events: unknown[] = [];
    const reader = new JsonlReader(path, (event) => events.push(event));

    const originalWarn = console.warn;
    console.warn = () => {};
    await reader.processOnce();
    console.warn = originalWarn;

    expect(events).toHaveLength(1);

    unlinkSync(path);
    const cursorPath = `${path}.otel-cursor`;
    if (existsSync(cursorPath)) unlinkSync(cursorPath);
  });
});

describe("JsonlReader - cursor persistence", () => {
  test("cursor file created after processOnce", async () => {
    const path = tmpFile();
    const line1 = makeEventLine(1);
    writeFileSync(path, line1 + "\n", "utf8");

    const reader = new JsonlReader(path, () => {});
    await reader.processOnce();

    const cursorPath = `${path}.otel-cursor`;
    expect(existsSync(cursorPath)).toBe(true);

    const cursorValue = await readFile(cursorPath, "utf8");
    expect(parseInt(cursorValue.trim(), 10)).toBeGreaterThan(0);

    unlinkSync(path);
    unlinkSync(cursorPath);
  });

  test("resumes from cursor on second run (no duplicate events)", async () => {
    const path = tmpFile();
    const line1 = makeEventLine(1);
    writeFileSync(path, line1 + "\n", "utf8");

    const events1: unknown[] = [];
    const reader1 = new JsonlReader(path, (e) => events1.push(e));
    await reader1.processOnce();
    expect(events1).toHaveLength(1);

    // Append another line
    const line2 = makeEventLine(2);
    writeFileSync(path, line1 + "\n" + line2 + "\n", "utf8");

    // Second reader: should only see line2 (line1 cursor already advanced)
    const events2: unknown[] = [];
    const reader2 = new JsonlReader(path, (e) => events2.push(e));
    await reader2.processOnce();
    expect(events2).toHaveLength(1);

    const cursorPath = `${path}.otel-cursor`;
    unlinkSync(path);
    unlinkSync(cursorPath);
  });
});

describe("JsonlReader - file rotation detection", () => {
  test("detects file rotation (size < cursor) and resets", async () => {
    const path = tmpFile();
    // Write a large file first
    const lines = Array.from({ length: 10 }, (_, i) =>
      makeEventLine(i + 1),
    ).join("\n") + "\n";
    writeFileSync(path, lines, "utf8");

    const events1: unknown[] = [];
    const reader1 = new JsonlReader(path, (e) => events1.push(e));
    await reader1.processOnce();
    expect(events1.length).toBeGreaterThan(0);

    // Simulate rotation: write a much smaller file
    const singleLine = makeEventLine(1);
    writeFileSync(path, singleLine + "\n", "utf8");

    const events2: unknown[] = [];
    const reader2 = new JsonlReader(path, (e) => events2.push(e));

    const originalInfo = console.info;
    console.info = () => {};
    await reader2.processOnce();
    console.info = originalInfo;

    // After rotation reset, should read from byte 0 again
    expect(events2).toHaveLength(1);

    const cursorPath = `${path}.otel-cursor`;
    unlinkSync(path);
    if (existsSync(cursorPath)) unlinkSync(cursorPath);
  });
});

describe("JsonlReader - nonexistent file handling", () => {
  test("warns and does not throw when file does not exist", async () => {
    const path = "/tmp/nonexistent-otel-test-12345.jsonl";
    const reader = new JsonlReader(path, () => {});

    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };

    await reader.processOnce();
    console.warn = originalWarn;

    expect(warned).toBe(true);
  });
});

describe("JsonlReader - processOnce mode (AC-8-8)", () => {
  test("processOnce reads file and returns (no polling)", async () => {
    const path = tmpFile();
    writeFileSync(
      path,
      makeEventLine(1) + "\n" + makeEventLine(2) + "\n",
      "utf8",
    );

    const events: unknown[] = [];
    const reader = new JsonlReader(path, (e) => events.push(e));

    let resolved = false;
    const promise = reader.processOnce().then(() => { resolved = true; });
    await promise;

    expect(resolved).toBe(true);
    expect(events).toHaveLength(2);

    const cursorPath = `${path}.otel-cursor`;
    unlinkSync(path);
    if (existsSync(cursorPath)) unlinkSync(cursorPath);
  });
});
