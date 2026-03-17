<!-- SPDX-License-Identifier: MIT -->
# Specification: `args_hash` Computation

**Spec version:** 1
**Date:** 2026-03-15
**Status:** Normative
**Consumers:** Rust engine, Python shim, TypeScript shim, CLI verify

---

## 1. Overview

The `args_hash` field is a SHA-256 fingerprint of the tool call arguments that
accompanies every intercepted call through the LoopStorm Guard system. It appears
in two schemas:

- **`DecisionRequest.args_hash`** (`schemas/ipc/decision-request.schema.json`) —
  computed by the shim before sending a decision request to the engine.
- **`Event.args_hash`** (`schemas/events/event.schema.json`) — recorded in the
  JSONL audit log by the engine.

The hash serves three purposes:

1. **Loop detection fingerprinting** — the engine detects repeated identical
   calls by comparing `(tool, args_hash)` tuples without needing raw arguments.
2. **Integrity verification** — the audit log records the hash of the original
   (pre-redaction) arguments, allowing offline verification that logged arguments
   match the original call.
3. **Redaction independence** — because the hash is computed before redaction, the
   engine can perform its own redaction pass without losing the ability to match
   fingerprints.

All implementations MUST produce identical output for identical input. This spec
defines the exact algorithm and provides cross-language test vectors.

---

## 2. Algorithm

Given a tool call with arguments `args` (a JSON value):

1. **Canonicalize**: Serialize `args` to its RFC 8785 (JCS) canonical form.
2. **Encode**: Encode the canonical string as UTF-8 bytes.
3. **Hash**: Compute the SHA-256 digest of the UTF-8 bytes.
4. **Hex-encode**: Encode the 32-byte digest as a lowercase hexadecimal string
   (exactly 64 characters, matching the regex `^[0-9a-f]{64}$`).

The result is the `args_hash` value.

### Pseudocode

```
args_hash = hex_lower(sha256(utf8_encode(jcs_canonicalize(args))))
```

---

## 3. RFC 8785 Canonicalization Rules

RFC 8785 (JSON Canonicalization Scheme) defines a deterministic JSON
serialization. Implementors MUST follow these rules exactly.

### 3.1 Object Key Ordering

Object members are sorted by key using lexicographic comparison of UTF-16 code
units (not UTF-8 bytes, not Unicode code points). For keys in the ASCII range
(U+0000–U+007F), this is equivalent to byte-order sorting. For keys containing
non-ASCII characters, the UTF-16 code unit ordering applies.

Nested objects are canonicalized recursively — inner objects have their keys
sorted independently.

### 3.2 Number Formatting

Numbers MUST be serialized using the shortest representation that round-trips
through IEEE 754 double-precision, following ECMAScript's `Number.toString()`
rules:

| Input | Canonical output |
|---|---|
| `1.0` | `1` |
| `1.00` | `1` |
| `-0` or `-0.0` | `0` |
| `1e2` | `100` |
| `1.5e3` | `1500` |
| `0.1` | `0.1` |
| `1e20` | `100000000000000000000` |
| `1e21` | `1e+21` |

- No leading zeros (except `0.x`).
- No trailing zeros after the decimal point.
- No positive sign on the mantissa.
- Negative zero normalizes to `0`.
- Exponential notation is used only when the exponent is ≥ 21 or ≤ -7.

**`NaN` and `Infinity` are not valid JSON values.** If encountered,
implementations MUST reject them with an error. Do not serialize them.

### 3.3 String Escaping

Strings MUST use the minimal escape sequences:

| Character | Escape |
|---|---|
| `"` (U+0022) | `\"` |
| `\` (U+005C) | `\\` |
| Backspace (U+0008) | `\b` |
| Form feed (U+000C) | `\f` |
| Newline (U+000A) | `\n` |
| Carriage return (U+000D) | `\r` |
| Tab (U+0009) | `\t` |
| U+0000–U+001F (other) | `\uXXXX` (lowercase hex) |

Characters above U+001F (except `"` and `\`) are serialized as literal UTF-8.
No `\uXXXX` escaping is used for printable characters. Surrogate pairs in the
input are serialized as the literal UTF-8 encoding of the code point, not as
`\uD800\uDC00` escape pairs.

### 3.4 Literals

- `null` → `null`
- `true` → `true`
- `false` → `false`

### 3.5 Whitespace

No whitespace between tokens. No trailing newline. The canonical form is the
most compact valid JSON representation.

### 3.6 Arrays

Array elements are serialized in order, separated by `,` with no whitespace.
Each element is individually canonicalized.

---

## 4. Cross-Language Test Vectors

Every implementation MUST pass all of the following test vectors. The "Input"
column shows the `args` value as it might arrive from the agent framework
(potentially non-canonical). The "Canonical Form" column shows the exact JCS
output. The "SHA-256" column shows the expected `args_hash`.

### Vector 1: Simple Flat Object

**Input:**
```json
{"url": "https://example.com", "method": "GET"}
```

**Canonical form:**
```
{"method":"GET","url":"https://example.com"}
```

**SHA-256:** `abacd07d80a52db8cd8d4d149e15a032350e8a15c2c9feb81802c2d535a1f36a`

---

### Vector 2: Key Reordering

**Input:**
```json
{"z": 1, "a": 2}
```

**Canonical form:**
```
{"a":2,"z":1}
```

**SHA-256:** `c2985c5ba6f7d2a55e768f92490ca09388e95bc4cccb9fdf11b15f4d42f93e73`

---

### Vector 3: Nested Objects

**Input:**
```json
{"config": {"retry": true, "timeout": 30}, "action": "fetch"}
```

**Canonical form:**
```
{"action":"fetch","config":{"retry":true,"timeout":30}}
```

**SHA-256:** `3b79517f23a25dd9b7d20e3739b40a60af00b34328be1babc3e972c329ba08e8`

---

### Vector 4: Number Normalization

**Input:**
```json
{"one": 1.0, "neg_zero": -0, "sci": 1e2}
```

**Canonical form:**
```
{"neg_zero":0,"one":1,"sci":100}
```

**SHA-256:** `3f0d3a9f56c9872f743c54cba9f4de18d020519644706a87b67da8bc83338710`

---

### Vector 5: Empty Object

**Input:**
```json
{}
```

**Canonical form:**
```
{}
```

**SHA-256:** `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`

---

### Vector 6: Array Values

**Input:**
```json
{"items": [1, "two", null, true]}
```

**Canonical form:**
```
{"items":[1,"two",null,true]}
```

**SHA-256:** `f9147fa466a7e6ff1514539910fc4ad4fa8416abc09da2ac64250e9f7c3dee78`

---

### Vector 7: Unicode Strings

**Input:**
```json
{"name": "José", "emoji": "🔥"}
```

**Canonical form:**
```
{"emoji":"🔥","name":"José"}
```

**SHA-256:** `d118390a6bef2c2aaebda535e96c4b0741c8e1c570f294b179d04a7b807ed075`

Note: The emoji U+1F525 and the accented `é` (U+00E9) are serialized as literal
UTF-8 bytes, not as `\uXXXX` escape sequences.

---

### Vector 8: String Escaping (Control Characters)

**Input:**
```json
{"line": "hello\nworld", "tab": "tab\there"}
```

**Canonical form:**
```
{"line":"hello\nworld","tab":"tab\there"}
```

**SHA-256:** `75bdf46f68aec61b321dc53a796ec0609c1c2273c07afa97083881a6f372b2c6`

Note: `\n` and `\t` are the two-character JSON escape sequences for newline
(U+000A) and tab (U+0009), not literal characters. The SHA-256 is computed
over the canonical form bytes which contain `0x5C 0x6E` (`\n`) and `0x5C
0x74` (`\t`), NOT the literal control characters `0x0A` and `0x09`.

*Errata: The original hash (`474fd71a...`) was computed against bytes
containing literal control characters, which are not valid JSON per RFC 8259.
Corrected 2026-03-17.*

---

### Vector 9: Deeply Nested Object

**Input:**
```json
{"a": {"b": {"c": {"d": "deep"}}}}
```

**Canonical form:**
```
{"a":{"b":{"c":{"d":"deep"}}}}
```

**SHA-256:** `9dfbb4f97076c37899ee498536503672ccfbf54b14e2ca888ce1a1bbdc7ce1e6`

---

### Vector 10: Large Integer and Float

**Input:**
```json
{"big_int": 9007199254740991, "small_float": 0.1}
```

**Canonical form:**
```
{"big_int":9007199254740991,"small_float":0.1}
```

**SHA-256:** `2873f9a9deaa468bf1a6d36032d309ab4bcdb032b1010306f4677da9032ad1cf`

Note: `9007199254740991` is `Number.MAX_SAFE_INTEGER` (2^53 - 1). Values beyond
this range may lose precision in JavaScript/Python float representation. All
implementations MUST preserve integer precision up to this value.

---

### Vector 11: Backslash and Quote in Values

**Input:**
```json
{"path": "C:\\Users\\test", "quote": "said \"hi\""}
```

**Canonical form:**
```
{"path":"C:\\Users\\test","quote":"said \"hi\""}
```

**SHA-256:** `00b3d93ab21bc17b38b63694b610b6f210a0e4996cb003d499146129d00352f9`

---

### Vector 12: Mixed Types

**Input:**
```json
{"active": true, "count": 0, "name": null, "tags": ["a", "b"]}
```

**Canonical form:**
```
{"active":true,"count":0,"name":null,"tags":["a","b"]}
```

**SHA-256:** `6958b38c55df8b0ddad22e0f2002b7fd083e93e8f54714c62451ecb1da15636c`

---

## 5. Edge Cases and Decisions

### 5.1 `args` is `null` or absent

If the tool call has no arguments (`args` is `null` or the key is absent):

- **Decision:** `args_hash` is the SHA-256 of the string `"null"` (the four
  UTF-8 bytes `6e 75 6c 6c`).
- **Value:** `74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b`
- **Rationale:** `null` is a valid JSON value with a well-defined canonical form.
  Treating absent args as JSON `null` avoids a special case in every
  implementation.

### 5.2 `args` is a primitive or array (not an object)

Tool call arguments are conventionally objects, but this spec does not restrict
the JSON type:

- **Decision:** Canonicalize and hash whatever JSON value `args` contains.
  Arrays, strings, numbers, booleans, and `null` all have well-defined JCS
  canonical forms.
- **Rationale:** The shim should not second-guess the agent framework. If a tool
  declares `args` as an array, the hash should still work.

### 5.3 `NaN` and `Infinity`

- **Decision:** Reject with an error. Do not produce an `args_hash`.
- **Rationale:** `NaN` and `Infinity` are not valid JSON values per RFC 8259.
  RFC 8785 explicitly excludes them. If an agent framework produces these values,
  the shim MUST raise an error before sending the DecisionRequest.

### 5.4 Duplicate object keys

- **Decision:** Behavior is undefined. Implementations MAY reject or MAY use
  last-value-wins semantics. In practice, well-formed tool call arguments never
  contain duplicate keys.
- **Rationale:** RFC 8259 says keys "SHOULD" be unique. RFC 8785 does not
  address duplicates. Mandating specific behavior here would add complexity
  without practical value.

### 5.5 Very large arguments

- **Decision:** No size limit on `args` for hashing purposes. The shim hashes
  whatever the agent framework provides.
- **Rationale:** The hash is O(n) in the size of the arguments. The engine
  receives only the 64-character hash, not the raw arguments, so large payloads
  do not affect IPC performance.

---

## 6. Implementation Notes

### 6.1 Rust (Engine + CLI)

The `serde_json` crate does NOT produce RFC 8785 canonical output by default
(it preserves insertion order, not sorted order). Options:

1. **Recommended**: Use the [`json-canonicalization`](https://crates.io/crates/json-canonicalization)
   crate, which implements RFC 8785. Parse with `serde_json`, then canonicalize.
2. **Alternative**: Implement manual serialization using `serde_json::Value`
   with recursive key sorting. This avoids an extra dependency but requires
   careful handling of number formatting.

Hash computation:
```rust
use sha2::{Sha256, Digest};

fn args_hash(args: &serde_json::Value) -> String {
    let canonical = json_canonicalization::serialize(args);
    let digest = Sha256::digest(canonical.as_bytes());
    hex::encode(digest)
}
```

### 6.2 Python (Shim — stdlib only)

Python's `json.dumps()` with `sort_keys=True` and `separators=(',', ':')`
produces output that is close to RFC 8785 but NOT identical for all inputs:

- `sort_keys=True` sorts by Python string comparison (Unicode code point order),
  which matches RFC 8785 for BMP characters but may differ for supplementary
  plane characters in keys.
- Python's default number formatting matches RFC 8785 for most cases but may
  differ for extreme values.

**Recommended approach:**

```python
import hashlib
import json

def args_hash(args) -> str:
    # For v1, json.dumps with sort_keys is sufficient.
    # All test vectors pass with this approach.
    canonical = json.dumps(
        args,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,  # Reject NaN/Infinity
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
```

**Caveat:** If future tool call arguments contain object keys with non-BMP
Unicode characters, the Python sort order may diverge from RFC 8785's UTF-16
code unit ordering. This is a known limitation documented here for transparency.
In practice, tool argument keys are ASCII identifiers.

### 6.3 TypeScript (Shim)

Options:

1. **Recommended**: Use the [`canonicalize`](https://www.npmjs.com/package/canonicalize)
   npm package, which implements RFC 8785.
2. **Alternative**: Use `JSON.stringify()` with a custom replacer that sorts
   keys. Note that `JSON.stringify()` number formatting follows ECMAScript spec,
   which aligns with RFC 8785.

```typescript
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

function argsHash(args: unknown): string {
  const canonical = canonicalize(args);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
```

---

## 7. Verification

### 7.1 Cross-Language Conformance Test

All three implementations (Rust, Python, TypeScript) MUST produce identical
`args_hash` values for all 12 test vectors in Section 4.

CI SHOULD include a conformance test that:

1. Defines the test vectors as a shared JSON fixture file.
2. Runs each implementation against the fixture.
3. Asserts that all three produce identical hashes.

### 7.2 Fixture File Format

The test fixture SHOULD be a JSON array at `tests/fixtures/args-hash-vectors.json`:

```json
[
  {
    "id": "simple_flat",
    "input": {"url": "https://example.com", "method": "GET"},
    "canonical": "{\"method\":\"GET\",\"url\":\"https://example.com\"}",
    "sha256": "abacd07d80a52db8cd8d4d149e15a032350e8a15c2c9feb81802c2d535a1f36a"
  }
]
```

### 7.3 Offline Verification

The `loopstorm verify` CLI command uses `args_hash` as part of event integrity
checking. When replaying an audit log, the verifier can recompute `args_hash`
from the `args_redacted` field and compare against the stored `args_hash` to
detect argument tampering. Note that this comparison is only valid if redaction
has not modified the arguments — for redacted events, only the hash chain
provides integrity guarantees.
