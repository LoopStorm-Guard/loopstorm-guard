// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";

/**
 * Derive an OTel trace_id from a LoopStorm run_id (UUID).
 * Direct byte mapping: strip hyphens, lowercase.
 * Spec: otel-span-mapping.md Section 3.1
 */
export function traceId(runId: string): string {
  return runId.replace(/-/g, "").toLowerCase();
}

/**
 * Derive an OTel span_id from a (run_id, seq) pair.
 * SHA-256(run_id_bytes || seq_be_bytes), take first 8 bytes.
 * Spec: otel-span-mapping.md Section 3.2
 *
 * For the root span (run_started), use seq=0 (synthetic).
 * For all other events, use the event's actual seq value.
 */
export function spanId(runId: string, seq: number): string {
  const runIdHex = runId.replace(/-/g, "").toLowerCase();
  const runIdBytes = Buffer.from(runIdHex, "hex");
  const seqBytes = Buffer.alloc(8);
  seqBytes.writeBigUInt64BE(BigInt(seq));
  const payload = Buffer.concat([runIdBytes, seqBytes]);
  const hash = createHash("sha256").update(payload).digest();
  const result = Buffer.from(hash.subarray(0, 8));

  // Non-zero guarantee (spec Section 3.2)
  if (result.every((b) => b === 0)) {
    result[7] = 1;
  }

  return result.toString("hex");
}
