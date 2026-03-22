// SPDX-License-Identifier: MIT
/**
 * Compute args_hash: SHA-256 of RFC 8785 (JCS) canonical JSON.
 */

import { createHash } from "node:crypto";
import { jcsSerialize } from "./jcs.js";

/**
 * Compute the args_hash for a tool call's arguments.
 *
 * Returns the lowercase hex SHA-256 digest of the JCS canonical form.
 * If args is null/undefined, hashes the string "null".
 */
export function argsHash(args: unknown): string {
  const canonical = jcsSerialize(args ?? null);
  return createHash("sha256").update(canonical, "utf-8").digest("hex");
}
