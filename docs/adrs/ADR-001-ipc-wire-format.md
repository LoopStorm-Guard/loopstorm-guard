<!-- SPDX-License-Identifier: MIT -->
# ADR-001: IPC Wire Format

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

LoopStorm Guard's enforcement core runs as a Rust co-process alongside the agent. The Python shim (and, in v1.1, the TypeScript shim) must communicate with the engine on every intercepted tool call. This communication must be:

1. Fast enough to stay within the P99 < 5ms latency budget for the full IPC round-trip.
2. Language-neutral so that additional shims (TypeScript, Go) can be added without engine changes.
3. Simple enough that the shim remains thin (~300 lines, stdlib only for Python).
4. Debuggable by a human reading the wire with standard tools.

The transport is a Unix Domain Socket (UDS) at file permission 0600, providing OS-level process isolation. On Windows, a named pipe will be used with equivalent access restrictions.

---

## Decision

The IPC wire format is **newline-delimited JSON (NDJSON)**.

Each message is a single JSON object terminated by a newline character (`\n`, U+000A). No length prefix. No framing bytes. No envelope.

Two message types exist on the wire:

1. **DecisionRequest** — sent from the shim to the engine. Published schema: `schemas/ipc/decision-request.schema.json`.
2. **DecisionResponse** — sent from the engine to the shim. Published schema: `schemas/ipc/decision-response.schema.json`.

The protocol is strict request-response: the shim sends one DecisionRequest and blocks until it receives one DecisionResponse. There is no multiplexing, no streaming, and no unsolicited messages from the engine.

The `decision` field in DecisionResponse uses the following enum:

| Value | Meaning |
|---|---|
| `allow` | Call may proceed |
| `deny` | Call is blocked; shim raises PolicyDeniedError |
| `cooldown` | Loop detected; shim pauses for `cooldown_ms` then retries |
| `kill` | Run is terminated; shim raises TerminateRunError |
| `require_approval` | Call is held pending human approval (v1.1) |

The `args_hash` field in DecisionRequest is the SHA-256 hex digest of the RFC 8785 (JCS) canonical JSON serialization of the tool call arguments. This is computed by the shim before sending. The engine uses this for loop detection fingerprinting without needing the raw arguments in cases where redaction has already occurred.

---

## Consequences

**Positive:**
- Any language with a JSON library and a socket library can implement a shim.
- Wire traffic is human-readable with `socat` or `nc`.
- No dependency on protobuf, msgpack, or any serialization framework.
- The shim remains trivially simple.

**Negative:**
- JSON parsing is slower than binary formats. At expected payload sizes (< 4KB), this is not material within the latency budget.
- No built-in schema negotiation or versioning on the wire. Version mismatches between shim and engine must be detected by the engine validating against the published schema and returning an error response.
- Newline characters inside JSON values must be escaped (standard JSON behavior, but a potential source of bugs in naive implementations).

**Risks:**
- If payload sizes grow significantly (e.g., large tool argument sets), JSON serialization overhead may become measurable. Mitigation: the shim sends `args_hash` and redacted args, not raw arguments. The engine controls what it returns.

---

## Migration Path

This is a foundational decision. Changing the wire format is a breaking change that requires coordinated updates to all shims and the engine. If a future version requires a binary format, the engine should support both formats during a transition period, selected by a handshake message at connection establishment.

Schema versioning is tracked in the published JSON Schema files via the `schema_version` field. Shims must send their schema version; the engine must reject requests with unsupported versions and return a descriptive error.
