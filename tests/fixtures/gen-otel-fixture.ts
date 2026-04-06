// SPDX-License-Identifier: MIT
// Generator for otel-sample-run.jsonl
// Run: bun tests/fixtures/gen-otel-fixture.ts

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const RUN_ID = "01960e07-d0e9-7ad0-8621-5614ec0dbd54";

// sha256 of bytes
function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

// Build a JSONL line for an event:
// 1. Construct the event object (without hash, hash_prev)
// 2. hash = sha256(JSON.stringify(event_without_hash_and_hash_prev))
// 3. hash_prev = sha256(previous_line_bytes) or null for first event
// 4. Serialize full event as JSON line
function buildLine(
  // biome-ignore lint/suspicious/noExplicitAny: fixture generator - loose typing intentional
  eventData: Record<string, any>,
  prevLineBytes: string | null,
): string {
  // Remove hash and hash_prev to compute payload hash
  const payload = { ...eventData };
  delete payload.hash;
  delete payload.hash_prev;

  const payloadJson = JSON.stringify(payload);
  const hash = sha256(payloadJson);

  // Full event with hash fields
  const fullEvent: Record<string, unknown> = {
    ...payload,
    hash,
    hash_prev: prevLineBytes !== null ? sha256(prevLineBytes) : null,
  };

  return JSON.stringify(fullEvent);
}

// Events in the fixture
const RUN_TS_BASE = "2026-04-05T10:00:00.000Z";

function ts(offsetMs: number): string {
  return new Date(new Date(RUN_TS_BASE).getTime() + offsetMs).toISOString();
}

const eventDefs: Record<string, unknown>[] = [
  // seq=1: run_started
  {
    schema_version: 1,
    event_type: "run_started",
    run_id: RUN_ID,
    seq: 1,
    ts: ts(0),
    agent_name: "test-agent",
    agent_role: "primary",
    run_status: "started",
    policy_pack_id: "pp_test",
    environment: "test",
  },
  // seq=2: policy_decision (allow) with BT fields
  {
    schema_version: 1,
    event_type: "policy_decision",
    run_id: RUN_ID,
    seq: 2,
    ts: ts(100),
    tool: "file_read",
    args_hash: "a".repeat(64),
    args_redacted: { path: "<REDACTED>" },
    decision: "allow",
    rule_id: "rule_allow_file_read",
    reason: "allowed by policy",
    model: "claude-3-5-sonnet-20241022",
    input_tokens: 1000,
    output_tokens: 200,
    estimated_cost_usd: 0.005,
    latency_ms: 42.5,
    call_seq_fingerprint: "b".repeat(64),
    inter_call_ms: 100,
    token_rate_delta: 1.0,
    param_shape_hash: "c".repeat(64),
  },
  // seq=3: policy_decision (deny) with BT fields
  {
    schema_version: 1,
    event_type: "policy_decision",
    run_id: RUN_ID,
    seq: 3,
    ts: ts(250),
    tool: "execute_code",
    args_hash: "d".repeat(64),
    args_redacted: { code: "<REDACTED>" },
    decision: "deny",
    rule_id: "rule_deny_exec",
    reason: "code execution is denied by policy",
    model: "claude-3-5-sonnet-20241022",
    input_tokens: 1500,
    output_tokens: 300,
    estimated_cost_usd: 0.008,
    latency_ms: 15.0,
    call_seq_fingerprint: "e".repeat(64),
    inter_call_ms: 150,
    token_rate_delta: 1.2,
    param_shape_hash: "f".repeat(64),
  },
  // seq=4: policy_decision (cooldown)
  {
    schema_version: 1,
    event_type: "policy_decision",
    run_id: RUN_ID,
    seq: 4,
    ts: ts(400),
    tool: "file_read",
    args_hash: "0".repeat(64),
    args_redacted: { path: "<REDACTED>" },
    decision: "cooldown",
    rule_id: "rule_rate_limit",
    reason: "rate limit cooldown",
    model: "claude-3-5-sonnet-20241022",
    input_tokens: 800,
    output_tokens: 150,
    estimated_cost_usd: 0.003,
    latency_ms: 8.0,
    call_seq_fingerprint: "1".repeat(64),
    inter_call_ms: 150,
    token_rate_delta: 0.8,
    param_shape_hash: "2".repeat(64),
  },
  // seq=5: budget_soft_cap_warning
  {
    schema_version: 1,
    event_type: "budget_soft_cap_warning",
    run_id: RUN_ID,
    seq: 5,
    ts: ts(500),
    dimension: "cost_usd",
    budget: {
      cost_usd: { current: 0.016, soft: 0.015, hard: 0.05 },
      input_tokens: { current: 3300, soft: 5000, hard: 10000 },
      output_tokens: { current: 650, soft: 2000, hard: 5000 },
      call_count: { current: 3, soft: 10, hard: 20 },
    },
  },
  // seq=6: loop_detected
  {
    schema_version: 1,
    event_type: "loop_detected",
    run_id: RUN_ID,
    seq: 6,
    ts: ts(600),
    loop_rule: "repeated_tool_call",
    loop_action: "cooldown",
    cooldown_ms: 5000,
  },
  // seq=7: budget_update
  {
    schema_version: 1,
    event_type: "budget_update",
    run_id: RUN_ID,
    seq: 7,
    ts: ts(700),
    budget: {
      cost_usd: { current: 0.016, soft: 0.015, hard: 0.05 },
      input_tokens: { current: 3300, soft: 5000, hard: 10000 },
      output_tokens: { current: 650, soft: 2000, hard: 5000 },
      call_count: { current: 3, soft: 10, hard: 20 },
    },
  },
  // seq=8: run_ended
  {
    schema_version: 1,
    event_type: "run_ended",
    run_id: RUN_ID,
    seq: 8,
    ts: ts(1000),
    run_status: "completed",
  },
];

// Build the JSONL lines
const lines: string[] = [];
let prevLine: string | null = null;

for (const eventDef of eventDefs) {
  const line = buildLine(eventDef as Record<string, unknown>, prevLine);
  lines.push(line);
  prevLine = line;
}

const content = lines.join("\n") + "\n";

const outPath = join(import.meta.dir, "otel-sample-run.jsonl");
writeFileSync(outPath, content, "utf8");

console.log(`Written ${lines.length} events to ${outPath}`);

// Verify the chain
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]!;
  const event = JSON.parse(line) as Record<string, unknown>;

  // Verify hash: remove hash and hash_prev, serialize, sha256
  const payload = { ...event };
  delete payload.hash;
  delete payload.hash_prev;
  const expectedHash = sha256(JSON.stringify(payload));
  if (event.hash !== expectedHash) {
    console.error(`Hash mismatch at line ${i + 1}!`);
    console.error(`  expected: ${expectedHash}`);
    console.error(`  got:      ${event.hash}`);
    process.exit(1);
  }

  // Verify hash_prev
  if (i === 0) {
    if (event.hash_prev !== null) {
      console.error(`Line 1: hash_prev should be null, got ${event.hash_prev}`);
      process.exit(1);
    }
  } else {
    const prevLineStr = lines[i - 1]!;
    const expectedHashPrev = sha256(prevLineStr);
    if (event.hash_prev !== expectedHashPrev) {
      console.error(`hash_prev mismatch at line ${i + 1}!`);
      console.error(`  expected: ${expectedHashPrev}`);
      console.error(`  got:      ${event.hash_prev}`);
      process.exit(1);
    }
  }
}

console.log("Hash chain verified successfully.");
