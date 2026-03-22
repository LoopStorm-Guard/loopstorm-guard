// SPDX-License-Identifier: MIT
/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) — pure TypeScript, no deps.
 *
 * In JavaScript, JSON.stringify already produces numbers per the ECMAScript
 * Number.toString() algorithm (which RFC 8785 S3.2.2.3 requires) and escapes
 * strings per RFC 8259. The only missing piece is deterministic key ordering:
 * RFC 8785 S3.2.3 requires keys sorted by UTF-16 code unit values, which is
 * exactly what JavaScript's default Array.sort() provides.
 */

/**
 * Serialize a value to RFC 8785 canonical JSON.
 */
export function jcsSerialize(value: unknown): string {
  if (value === null || value === undefined) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";

    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`JCS does not support ${value}`);
      }
      // JSON.stringify handles -0→"0", integer-valued floats without
      // decimal point, and shortest round-trip representation.
      return JSON.stringify(value);

    case "string":
      return JSON.stringify(value);

    case "object":
      if (Array.isArray(value)) {
        return `[${value.map(jcsSerialize).join(",")}]`;
      }
      // Sort keys by UTF-16 code unit order (JS default sort)
      return serializeObject(value as Record<string, unknown>);

    default:
      throw new TypeError(`Unsupported type for JCS: ${typeof value}`);
  }
}

function serializeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${jcsSerialize(obj[k])}`);
  return `{${pairs.join(",")}}`;
}
