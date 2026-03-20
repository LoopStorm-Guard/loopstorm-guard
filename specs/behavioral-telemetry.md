<!-- SPDX-License-Identifier: MIT -->
# Specification: Behavioral Telemetry Fields

**Spec version:** 1
**Date:** 2026-03-20
**Status:** Normative
**Consumers:** Rust engine, Python shim (read-only display), TypeScript shim (read-only display), Backend (event store), CLI (replay display), Frontend (event detail)
**Control philosophy stage:** Stage 2 (Detect) -- data collection for future detection heuristics
**Deployment modes:** Mode 0 through Mode 3 (all fields computed locally by the engine)

---

## 1. Overview

This specification defines four behavioral telemetry fields that the engine
computes and attaches to `policy_decision` events starting in v1.1. The
fields capture behavioral patterns -- call sequencing, timing, consumption
rate, and parameter structure -- without storing raw call history or raw
argument values.

**Purpose.** These fields exist solely to support the v2 behavioral anomaly
detector. The detector itself is out of scope for this specification. Only
the data collection schema is defined here.

**Design constraint.** The v2 detector is not yet designed. The fields
chosen here represent the minimal signal set that enables three detector
families:

| Detector family (v2) | Primary signal | Secondary signal |
|---|---|---|
| Sequence anomaly | `call_seq_fingerprint` | `inter_call_ms` |
| Consumption spike | `token_rate_delta` | `inter_call_ms` |
| Structural drift | `param_shape_hash` | `call_seq_fingerprint` |

The data capture decision is made now (v1.1) so that a corpus of behavioral
data exists by the time the v2 detector ships. Retrofitting data capture
after the fact would leave a gap in the historical record.

**Plane assignment.** All four fields are computed by the engine on the
enforcement plane. They appear in the JSONL audit log. The observation plane
(supervisor, web dashboard) consumes them read-only.

---

## 2. Field Definitions

### 2.1 `call_seq_fingerprint`

| Property | Value |
|---|---|
| **Type** | `string` (lowercase hex, 64 characters) |
| **Pattern** | `^[0-9a-f]{64}$` |
| **Present on** | `policy_decision` events |
| **Computed by** | Engine (per-run state required) |

**Definition.** A SHA-256 hash of the last *N* `(tool, args_hash)` tuples
in the current run, where *N* is the rolling window size. This fingerprint
captures the recent call pattern without storing the raw sequence.

**Rolling window size.** *N* = 5 (the current call plus the 4 most recent
preceding calls). This value is a compile-time constant in the engine. It is
not operator-configurable in v1.1. Rationale: 5 calls provides enough
context to distinguish meaningful behavioral patterns from noise, while
keeping state memory bounded.

**Computation algorithm.**

```
FUNCTION call_seq_fingerprint(window: List[(tool, args_hash)]) -> string:
    // window contains at most N=5 entries, ordered oldest to newest.
    // Each entry is the (tool, args_hash) pair from a policy_decision event.
    //
    // If the run has fewer than N calls so far, the window contains
    // all calls made to date (1 to N-1 entries).

    parts = []
    FOR EACH (tool, args_hash) IN window:
        parts.APPEND(tool + ":" + args_hash)

    // Join with newline delimiter (U+000A, byte 0x0A).
    payload = JOIN(parts, "\n")

    // Hash the UTF-8 encoded payload.
    RETURN hex_lower(SHA-256(UTF-8(payload)))
```

**Edge cases.**

- **First call in run (window size = 1):** The fingerprint is computed over
  a single `tool:args_hash` entry. This is valid -- it establishes the
  baseline.
- **Window not full (calls 2 through 4):** The fingerprint covers all
  calls made so far. Window sizes 1 through 4 all produce valid
  fingerprints. The v2 detector MUST account for short windows when
  comparing fingerprints.
- **args_hash is absent (should not happen):** If `args_hash` is missing
  from a `DecisionRequest`, use the null-args hash
  (`74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b`)
  as specified in `specs/args-hash.md` Section 5.1.

**State requirement.** The engine MUST maintain a per-run ring buffer of
the last *N* `(tool, args_hash)` tuples. This state is already partially
available in the loop detector's `call_history` deque, but the telemetry
module MUST maintain its own independent buffer to avoid coupling the
loop detector's window semantics (time-based) with the telemetry window
semantics (count-based, fixed at *N*=5).

---

### 2.2 `inter_call_ms`

| Property | Value |
|---|---|
| **Type** | `integer` (non-negative) |
| **Minimum** | `0` |
| **Present on** | `policy_decision` events |
| **Computed by** | Engine (per-run state required) |

**Definition.** Milliseconds elapsed between the engine's receipt of the
current `DecisionRequest` and its receipt of the previous `DecisionRequest`
in the same run. Captures timing patterns: rapid-fire bursts, stalls, and
rhythm changes.

**Computation algorithm.**

```
FUNCTION inter_call_ms(run_state: RunState, current_ts: MonotonicTime) -> integer:
    IF run_state.prev_request_ts IS NULL:
        // First call in the run. No previous call to measure against.
        RETURN 0

    delta = current_ts - run_state.prev_request_ts
    RETURN FLOOR(delta.as_milliseconds())

    // After returning, update run_state.prev_request_ts = current_ts
```

**Clock source.** The engine MUST use a monotonic clock (e.g., `Instant` in
Rust, `time.monotonic_ns()` in Python) for inter-call timing. Wall-clock
time (`ts` field in the event) MUST NOT be used because it is subject to
NTP adjustments and clock skew.

**Edge cases.**

- **First call in run:** `inter_call_ms` is `0`. The v2 detector MUST
  treat `inter_call_ms == 0 && seq == 1` as "no prior measurement."
- **Very large gaps:** No upper bound. Values in the millions (hours) are
  valid for runs that are paused or slow. The v2 detector, not the engine,
  decides what constitutes an anomalous gap.
- **Sub-millisecond calls:** Floor to `0`. The field is integer
  milliseconds, not fractional.

**State requirement.** The engine MUST store the monotonic timestamp of the
last `DecisionRequest` receipt per run.

---

### 2.3 `token_rate_delta`

| Property | Value |
|---|---|
| **Type** | `number` (IEEE 754 double, non-negative) |
| **Minimum** | `0.0` |
| **Present on** | `policy_decision` events (only when token counts are provided) |
| **Computed by** | Engine (per-run state required) |

**Definition.** The ratio of the current call's total token consumption to
the run's rolling average token consumption. Values near `1.0` indicate
steady consumption. Values significantly greater than `1.0` indicate a
consumption spike. Values near `0.0` indicate a consumption drop.

**Token consumption for a single call:**

```
call_tokens = input_tokens + output_tokens
```

Both `input_tokens` and `output_tokens` are optional fields on the
`DecisionRequest`. If either is absent, its value is `0` for this
computation.

**Rolling average computation.**

The rolling average is an arithmetic mean of the per-call token
consumption across all preceding calls in the run.

```
FUNCTION token_rate_delta(
    run_state: RunState,
    input_tokens: integer,
    output_tokens: integer
) -> number | null:

    call_tokens = input_tokens + output_tokens

    IF run_state.total_token_sum == 0 AND run_state.token_call_count == 0:
        // First call with token data. No average to compare against.
        // Record this call and return 1.0 (baseline).
        run_state.total_token_sum = call_tokens
        run_state.token_call_count = 1
        RETURN 1.0

    rolling_avg = run_state.total_token_sum / run_state.token_call_count

    IF rolling_avg == 0:
        // All previous calls reported 0 tokens. Avoid division by zero.
        // If current call also has 0 tokens, delta is 1.0 (unchanged).
        // If current call has >0 tokens, delta is infinity -- cap it.
        IF call_tokens == 0:
            delta = 1.0
        ELSE:
            delta = call_tokens  // Treat as raw count (effectively infinite ratio)
        END IF
    ELSE:
        delta = call_tokens / rolling_avg
    END IF

    // Update running totals AFTER computing the delta.
    run_state.total_token_sum = run_state.total_token_sum + call_tokens
    run_state.token_call_count = run_state.token_call_count + 1

    RETURN ROUND(delta, 6)  // 6 decimal places, avoids float noise
```

**Edge cases.**

- **No token data provided:** If neither `input_tokens` nor
  `output_tokens` is present on the `DecisionRequest`, `token_rate_delta`
  MUST be omitted from the event (not set to `0` or `null`). The field is
  only meaningful when token data is available.
- **First call in run:** Returns `1.0` (the call IS the average).
- **All previous calls reported 0 tokens:** If `rolling_avg == 0` and
  `call_tokens > 0`, the ratio is mathematically infinite. The engine
  caps this by returning `call_tokens` as a raw integer-valued float.
  This is a design trade-off: the v2 detector will see a large spike
  value rather than an infinity sentinel.
- **Precision:** Rounded to 6 decimal places using IEEE 754 round-half-
  to-even to minimize serialization noise.

**State requirement.** The engine MUST maintain per-run: `total_token_sum`
(u64) and `token_call_count` (u64). These are cumulative, not windowed.
A rolling window for tokens was considered and rejected because consumption
baselines are per-run (not per-window) and a cumulative average better
represents the run's overall consumption pattern.

---

### 2.4 `param_shape_hash`

| Property | Value |
|---|---|
| **Type** | `string` (lowercase hex, 64 characters) |
| **Pattern** | `^[0-9a-f]{64}$` |
| **Present on** | `policy_decision` events |
| **Computed by** | Engine |

**Definition.** SHA-256 of the sorted top-level keys of the `args` object.
This captures parameter structure changes (keys present, not values)
without revealing sensitive argument values.

**Computation algorithm.**

```
FUNCTION param_shape_hash(args_redacted: JSON | null) -> string:
    // args_redacted is the post-redaction arguments object from the
    // DecisionRequest. The shape hash uses the REDACTED form because:
    // (a) the engine only has access to args_redacted after redaction, and
    // (b) redaction does not change key names, only values.

    IF args_redacted IS NULL OR args_redacted IS NOT an object:
        // Non-object args (null, array, string, number, boolean)
        // have no key structure. Hash the type tag instead.
        IF args_redacted IS NULL:
            tag = "null"
        ELSE IF args_redacted IS an array:
            tag = "array"
        ELSE IF args_redacted IS a string:
            tag = "string"
        ELSE IF args_redacted IS a number:
            tag = "number"
        ELSE IF args_redacted IS a boolean:
            tag = "boolean"
        END IF
        RETURN hex_lower(SHA-256(UTF-8(tag)))

    keys = SORTED_KEYS(args_redacted)
    // Sort: lexicographic by UTF-16 code units (same as JCS, RFC 8785).
    // For ASCII keys (the common case), this is byte-order sort.

    // Join with newline delimiter (U+000A, byte 0x0A).
    payload = JOIN(keys, "\n")

    RETURN hex_lower(SHA-256(UTF-8(payload)))
```

**Important.** `param_shape_hash` operates on top-level keys only. It does
NOT recurse into nested objects. Rationale: the v2 detector needs to
identify when the parameter _structure_ changes (new keys appear, keys
disappear), not when nested values change shape. Top-level keys capture the
tool's interface; nested structure is too granular for anomaly detection at
the call-pattern level.

**Relationship to `args_hash`.** `args_hash` captures the full
canonical content (keys + values) of the pre-redaction arguments.
`param_shape_hash` captures only the key structure of the post-redaction
arguments. They are complementary: `args_hash` detects exact-duplicate
calls (loop detection); `param_shape_hash` detects structural drift
(anomaly detection).

**Edge cases.**

- **Empty object `{}`:** `keys` is an empty list. `payload` is the empty
  string `""`. The hash is SHA-256 of zero bytes:
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- **`args_redacted` is absent:** Treated as `null`. Hash is SHA-256 of
  `"null"`:
  `74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b`.
  (Same as the null-args hash from `specs/args-hash.md`.)
- **`args_redacted` is an array:** Hash is SHA-256 of `"array"`.
- **Keys contain non-ASCII characters:** Sorted by UTF-16 code unit order,
  same as JCS key ordering (Section 3.1 of `specs/args-hash.md`).

**State requirement.** None -- `param_shape_hash` is stateless. It is
computed from the current `DecisionRequest` only.

---

## 3. Placement in Event Schema

### 3.1 Which event types carry these fields?

All four fields are attached to `policy_decision` events only. Rationale:

- `policy_decision` is the event type that corresponds to a tool call being
  evaluated. It already carries `tool`, `args_hash`, `args_redacted`,
  `input_tokens`, and `output_tokens` -- the inputs to these computations.
- Other event types (`run_started`, `budget_update`, `loop_detected`, etc.)
  do not represent tool calls and lack the input data for computation.

### 3.2 Field optionality

All four fields are **optional** on `policy_decision` events:

| Field | Condition for presence |
|---|---|
| `call_seq_fingerprint` | Always present on `policy_decision` events (engine has the data) |
| `inter_call_ms` | Always present on `policy_decision` events |
| `token_rate_delta` | Present only when `input_tokens` or `output_tokens` is provided in the `DecisionRequest` |
| `param_shape_hash` | Always present on `policy_decision` events |

Consumers MUST NOT assume these fields are present. JSONL files from v1.0
engines will not contain them.

### 3.3 Event schema property definitions

The following properties will be added to `schemas/events/event.schema.json`
in a follow-up PR (P5.1). They are defined here for normative reference.

```json
{
  "call_seq_fingerprint": {
    "type": "string",
    "pattern": "^[0-9a-f]{64}$",
    "description": "SHA-256 of the last N (tool, args_hash) tuples in this run. Rolling window N=5. See specs/behavioral-telemetry.md."
  },
  "inter_call_ms": {
    "type": "integer",
    "minimum": 0,
    "description": "Milliseconds since the previous DecisionRequest in this run. 0 for the first call. See specs/behavioral-telemetry.md."
  },
  "token_rate_delta": {
    "type": "number",
    "minimum": 0,
    "description": "Ratio of this call's token consumption to the run's rolling average. 1.0 = baseline. See specs/behavioral-telemetry.md."
  },
  "param_shape_hash": {
    "type": "string",
    "pattern": "^[0-9a-f]{64}$",
    "description": "SHA-256 of the sorted top-level keys of args_redacted. See specs/behavioral-telemetry.md."
  }
}
```

**Note:** The current `event.schema.json` has `"additionalProperties": false`.
Adding these fields requires updating the schema file. That update is a P5.1
follow-up, not part of this specification. Until the schema file is updated,
strict validators will reject events containing these fields. Engines that
emit these fields before the schema update MUST NOT be deployed with strict
schema validation enabled against the v1.0 schema file.

---

## 4. Schema Version Impact

**Decision (OQ-BT-1 resolved):** These fields are added as **optional
properties within schema_version 1**. No schema_version bump to 2 is
required.

**Rationale:**

1. All four fields are optional. No existing field changes meaning or type.
2. Existing consumers ignore unknown optional fields (JSON parsing
   libraries discard unrecognized keys by default).
3. The `schema_version` field's purpose is to signal breaking changes that
   require consumer updates. Additive optional fields are not breaking.
4. A version bump to 2 would force all consumers (engine, shims, backend,
   CLI, frontend) to update their schema_version handling for no functional
   reason.
5. ADR-003 states "schema changes require schema_version bump." This spec
   interprets "schema change" as "a change that breaks existing consumers."
   Additive optional fields do not break consumers and therefore do not
   require a bump. This interpretation is documented here as normative.

**Affected consumers and their required action:**

| Consumer | Required action | Breaking? |
|---|---|---|
| Engine (Rust) | Compute and emit the fields | No -- engine adds fields it controls |
| Python shim | None -- shim sends `DecisionRequest`, does not consume events | No |
| TypeScript shim | None -- same as Python | No |
| Backend (Drizzle) | Add 4 nullable columns to `events` table | No -- additive migration |
| CLI (`verify`) | Ignore unknown fields during chain verification (already does) | No |
| CLI (`replay`) | Optionally display the fields if present | No |
| Frontend | Optionally display the fields if present | No |

---

## 5. Mode 0 Behavior

All four fields are computed locally by the engine. No network access is
required. No hosted tier is involved.

| Requirement | Mode 0 behavior |
|---|---|
| Computation | Engine-local, per-run state in memory |
| Storage | Written to the local JSONL file alongside all other event fields |
| Privacy | No raw values leave the engine. Only hashes and numeric deltas |
| Performance | O(1) per field per call (see Section 7 for details) |
| Configuration | Rolling window size *N*=5 is a compile-time constant |

Mode 0 users who do not need behavioral telemetry data may ignore these
fields. They impose negligible overhead: two SHA-256 computations, one
timestamp subtraction, and one integer division per `policy_decision` event.

---

## 6. Privacy Considerations

The behavioral telemetry fields are designed to be privacy-preserving:

| Field | Data exposed | Data NOT exposed |
|---|---|---|
| `call_seq_fingerprint` | Pattern of tool usage (which tools in which order) via a one-way hash | Raw tool names (hashed with args_hash), exact call arguments |
| `inter_call_ms` | Timing between calls | What the calls were |
| `token_rate_delta` | Relative consumption pattern | Absolute token counts (those are in separate fields) |
| `param_shape_hash` | Key names of arguments via a one-way hash | Argument values |

**Fingerprint reversibility.** Both `call_seq_fingerprint` and
`param_shape_hash` are SHA-256 hashes. They cannot be reversed to recover
the input. However, they are deterministic: the same input always produces
the same hash. An attacker with knowledge of the tool set and argument
schemas could build a rainbow table of fingerprints. This is acceptable
because:

1. Tool names and argument key names are not secrets -- they are defined by
   the agent framework's tool schema.
2. The hashes do not expose argument _values_, which are the sensitive data.
3. The `args_hash` field (already in v1.0) has the same reversibility
   properties and is documented as an accepted risk.

**`inter_call_ms` timing side channel.** Inter-call timing can reveal
information about external service latency. This is the same information
already available from the `ts` and `latency_ms` fields in the event
schema. `inter_call_ms` does not introduce a new information channel.

---

## 7. Cross-Language Implementation Notes

### 7.1 Rust (Engine) -- Primary Implementation

All four fields are engine-computed. The engine is the authoritative source.

**`call_seq_fingerprint`:** Add a `VecDeque<(String, String)>` ring buffer
(capacity 5) to the per-run state. On each `policy_decision`, push `(tool,
args_hash)`, evict the oldest if length exceeds 5, then compute SHA-256
of the joined payload. Use the `sha2` crate (already a dependency).

**`inter_call_ms`:** Add a `prev_request_instant: Option<Instant>` to the
per-run state. On first call, return `0` and set the instant. On subsequent
calls, compute the delta.

**`token_rate_delta`:** Add `total_token_sum: u64` and
`token_call_count: u64` to the per-run state. Compute the ratio using
`f64` arithmetic, round to 6 decimal places with
`(delta * 1_000_000.0).round() / 1_000_000.0`.

**`param_shape_hash`:** Extract keys from the `args_redacted`
`serde_json::Value::Object`, sort them (ASCII byte order is sufficient for
v1.1 -- all known tool argument keys are ASCII), join with `\n`, and hash.

**Performance.** Per-call overhead estimate:

| Field | Operations | Estimated cost |
|---|---|---|
| `call_seq_fingerprint` | 1 deque push + 1 SHA-256 (small payload, < 500 bytes) | < 1 us |
| `inter_call_ms` | 1 `Instant::now()` + 1 subtraction | < 0.1 us |
| `token_rate_delta` | 1 addition + 1 division + 1 rounding | < 0.1 us |
| `param_shape_hash` | Key extraction + sort + join + 1 SHA-256 | < 1 us |

Total: < 3 us per call. This is well within the engine's P99 < 5 ms
latency target.

### 7.2 Python Shim -- No Computation

The Python shim does not compute behavioral telemetry fields. It sends
`DecisionRequest` messages to the engine and receives `DecisionResponse`
messages. The behavioral telemetry fields appear only in the JSONL audit
log, which is written by the engine.

If a future version requires the shim to read behavioral telemetry data
from the event log (e.g., for local display), the shim should parse the
fields as optional and treat their absence as normal.

### 7.3 TypeScript Shim -- No Computation

Same as the Python shim. No computation, read-only consumption if needed.

### 7.4 MCP Proxy -- No Computation

The MCP proxy translates MCP `tools/call` requests into `DecisionRequest`
messages. The engine computes behavioral telemetry for MCP-proxied calls
identically to shim-originated calls. No special handling is required in
the proxy.

---

## 8. Test Vectors

All test vectors use SHA-256 with lowercase hex encoding.

### 8.1 `call_seq_fingerprint` Vectors

#### Vector CSF-1: Single call (window size 1)

**Window:**

| # | tool | args_hash |
|---|---|---|
| 1 | `file.read` | `abacd07d80a52db8cd8d4d149e15a032350e8a15c2c9feb81802c2d535a1f36a` |

**Payload (UTF-8):**
```
file.read:abacd07d80a52db8cd8d4d149e15a032350e8a15c2c9feb81802c2d535a1f36a
```

**SHA-256:** `800285a565cfe1737f89e6af8a6c3aa73b51616e30645230a97b3a99dbb93d55`

#### Vector CSF-2: Full window (5 calls)

**Window:**

| # | tool | args_hash |
|---|---|---|
| 1 | `file.read` | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| 2 | `file.write` | `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` |
| 3 | `http.get` | `cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc` |
| 4 | `db.query` | `dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd` |
| 5 | `file.read` | `eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` |

**Payload (UTF-8):**
```
file.read:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
file.write:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
http.get:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
db.query:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
file.read:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
```

**SHA-256:** `fd6a411aa09d22bc4369a38669f66e8726de95b8e5f355682dd8d910347dac12`

#### Vector CSF-3: Repeated identical calls (loop pattern)

**Window:**

| # | tool | args_hash |
|---|---|---|
| 1 | `http.get` | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| 2 | `http.get` | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| 3 | `http.get` | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |

**Payload (UTF-8):**
```
http.get:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
http.get:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
http.get:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

**SHA-256:** `9ade2fe092e79592862f3a725776e716444cfcd13a6177954ed6aa01df89bc15`

#### Vector CSF-4: Window rollover (6th call evicts 1st)

**Window after 6 calls (only calls 2-6 retained):**

| # | tool | args_hash |
|---|---|---|
| 2 | `tool_b` | `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` |
| 3 | `tool_c` | `cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc` |
| 4 | `tool_d` | `dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd` |
| 5 | `tool_e` | `eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` |
| 6 | `tool_f` | `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` |

**Payload (UTF-8):**
```
tool_b:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
tool_c:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
tool_d:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
tool_e:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
tool_f:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
```

**SHA-256:** `316d12a5e7b007059f9cc0243ce704323f8f68bc898bcb710be2428428bbb2cb`

---

### 8.2 `inter_call_ms` Vectors

These are behavioral, not cryptographic. Test vectors verify the computation
logic, not a hash output.

#### Vector ICM-1: First call in run

**Input:** `prev_request_ts = null`, `current_ts = T`
**Output:** `0`

#### Vector ICM-2: Normal gap

**Input:** `prev_request_ts = T`, `current_ts = T + 1500ms`
**Output:** `1500`

#### Vector ICM-3: Sub-millisecond gap

**Input:** `prev_request_ts = T`, `current_ts = T + 0.7ms`
**Output:** `0` (floor of 0.7)

#### Vector ICM-4: Large gap

**Input:** `prev_request_ts = T`, `current_ts = T + 3600000ms` (1 hour)
**Output:** `3600000`

---

### 8.3 `token_rate_delta` Vectors

#### Vector TRD-1: First call (baseline)

**Run state:** `total_token_sum = 0`, `token_call_count = 0`
**Current call:** `input_tokens = 500`, `output_tokens = 100`
**`call_tokens`:** `600`
**Output:** `1.0`
**Updated state:** `total_token_sum = 600`, `token_call_count = 1`

#### Vector TRD-2: Steady consumption

**Run state:** `total_token_sum = 3000`, `token_call_count = 3`
(rolling_avg = 1000)
**Current call:** `input_tokens = 800`, `output_tokens = 200`
**`call_tokens`:** `1000`
**Output:** `1.0` (1000 / 1000 = 1.0)
**Updated state:** `total_token_sum = 4000`, `token_call_count = 4`

#### Vector TRD-3: Consumption spike

**Run state:** `total_token_sum = 3000`, `token_call_count = 3`
(rolling_avg = 1000)
**Current call:** `input_tokens = 4000`, `output_tokens = 1000`
**`call_tokens`:** `5000`
**Output:** `5.0` (5000 / 1000 = 5.0)
**Updated state:** `total_token_sum = 8000`, `token_call_count = 4`

#### Vector TRD-4: Consumption drop

**Run state:** `total_token_sum = 10000`, `token_call_count = 5`
(rolling_avg = 2000)
**Current call:** `input_tokens = 100`, `output_tokens = 0`
**`call_tokens`:** `100`
**Output:** `0.05` (100 / 2000 = 0.05)
**Updated state:** `total_token_sum = 10100`, `token_call_count = 6`

#### Vector TRD-5: Zero previous average, non-zero current

**Run state:** `total_token_sum = 0`, `token_call_count = 2`
(rolling_avg = 0; two prior calls with 0 tokens each)
**Current call:** `input_tokens = 500`, `output_tokens = 0`
**`call_tokens`:** `500`
**Output:** `500` (capped at call_tokens per algorithm)
**Updated state:** `total_token_sum = 500`, `token_call_count = 3`

#### Vector TRD-6: No token data

**Current call:** `input_tokens` absent, `output_tokens` absent
**Output:** Field is **omitted** from the event (not `0`, not `null`)

---

### 8.4 `param_shape_hash` Vectors

#### Vector PSH-1: Simple flat object

**Input (args_redacted):**
```json
{"url": "https://example.com", "method": "GET"}
```

**Keys (sorted):** `["method", "url"]`
**Payload:** `method\nurl` (bytes: `6d 65 74 68 6f 64 0a 75 72 6c`)
**SHA-256:** `708ffd3968576d9f1cbfa90f8d2665a5400bc1714a73992d2b801b69eaea227d`

#### Vector PSH-2: Empty object

**Input (args_redacted):**
```json
{}
```

**Keys (sorted):** `[]`
**Payload:** `""` (empty string, zero bytes)
**SHA-256:** `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

#### Vector PSH-3: Null args

**Input (args_redacted):** `null`
**Tag:** `"null"`
**SHA-256:** `74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b`

#### Vector PSH-4: Array args

**Input (args_redacted):**
```json
[1, 2, 3]
```

**Tag:** `"array"`
**SHA-256:** `dbe42cc09c16704aa3d60127c60b4e1646fc6da1d4764aa517de053e65a663d7`

#### Vector PSH-5: Many keys (sorted order matters)

**Input (args_redacted):**
```json
{"z_last": 1, "a_first": 2, "m_middle": 3}
```

**Keys (sorted):** `["a_first", "m_middle", "z_last"]`
**Payload:** `a_first\nm_middle\nz_last`
**SHA-256:** `a0d0b27977b9383f9990f55d0f6ff1f41d9ff6f7f1e5f1df01d905c219cabb68`

---

## 9. Migration Path

### 9.1 Coexistence of v1.0 and v1.1 JSONL Files

JSONL files written by v1.0 engines lack behavioral telemetry fields. JSONL
files written by v1.1 engines include them on `policy_decision` events.

Both are valid `schema_version: 1` events. Consumers MUST handle both:

- **Backend ingest:** The 4 columns are nullable. v1.0 events store `NULL`.
  v1.1 events store values.
- **CLI verify:** Hash chain verification does not depend on these fields.
  They are included in the hash payload (they are part of the event),
  so a v1.0 verifier that does not know about them will compute a different
  `hash` value. **This is the one potential compatibility issue.** The chain
  verification algorithm hashes all fields (except `hash` and `hash_prev`).
  A v1.0 verifier will not include these fields in its hash computation,
  producing a mismatch. **Mitigation:** The CLI verifier MUST be updated to
  v1.1 before verifying JSONL files written by a v1.1 engine. This is not a
  schema_version issue -- it is a verifier implementation issue.
- **Frontend:** Displays the fields if present, hides the column if absent.
- **v2 detector:** Expects these fields to be present. Falls back gracefully
  if analyzing historical v1.0 data (treats missing fields as unavailable,
  reduces confidence scores accordingly).

### 9.2 Rollback

If an operator needs to roll back from v1.1 to v1.0:

1. v1.0 engines will stop emitting behavioral telemetry fields.
2. Existing JSONL lines containing the fields remain valid (they are
   ignored by v1.0 consumers that use permissive JSON parsing).
3. The backend's nullable columns continue to accept `NULL` for new events.
4. No data migration is required for rollback.

### 9.3 Future Field Additions

If the v2 detector requires additional telemetry fields, they SHOULD follow
the same pattern: optional properties on `policy_decision` events, engine-
computed, added within `schema_version: 1` if additive and optional. A
`schema_version` bump to 2 is reserved for changes that alter the meaning of
existing fields or make currently-optional fields required.

---

## Appendix A: Open Question Resolutions

| ID | Question | Decision | Rationale |
|---|---|---|---|
| OQ-BT-1 | Schema version bump? | No. Additive optional fields stay within schema_version 1. | See Section 4. Optional fields do not break existing consumers. |
| OQ-BT-2 | Where are fields computed? | All four fields are engine-computed. | The engine has per-run state (call history, timestamps, token sums). The shim sends a single `DecisionRequest` per call and lacks cross-call context. |
| OQ-BT-3 | Rolling window size for `call_seq_fingerprint`? | N=5 (compile-time constant, not configurable in v1.1). | 5 calls balances pattern richness against state memory. Configurable window deferred to v2 if detector tuning requires it. |

---

## Appendix B: Relationship to Existing Fields

This table maps behavioral telemetry fields to the existing event schema
fields they depend on or complement.

| Behavioral field | Depends on | Complements |
|---|---|---|
| `call_seq_fingerprint` | `tool`, `args_hash` | Loop detector's `call_history` (different window semantics) |
| `inter_call_ms` | Engine-internal monotonic clock | `ts` (wall clock), `latency_ms` (engine processing time) |
| `token_rate_delta` | `input_tokens`, `output_tokens` | `budget.input_tokens`, `budget.output_tokens`, `estimated_cost_usd` |
| `param_shape_hash` | `args_redacted` | `args_hash` (full content hash vs. structure-only hash) |

---

## Appendix C: What This Spec Does NOT Define

- The v2 behavioral anomaly detector algorithm
- Threshold values for anomaly classification
- Alert rules based on behavioral telemetry
- Aggregation of behavioral telemetry across runs
- Cross-customer behavioral baselines (v2, Mode 3)
- Configurable window sizes (v2)
- Additional telemetry fields beyond the four defined here
