<!-- SPDX-License-Identifier: MIT -->
# Spec: IPC Wire Format

**Version:** 1.0
**Date:** 2026-03-16
**Status:** Authoritative
**ADR:** ADR-001
**Gate consumers:** Engine (IPC listener), Python shim, TypeScript shim, CLI

---

## 1. Overview

The LoopStorm engine communicates with language shims over a local IPC
channel using newline-delimited JSON (NDJSON). This spec defines the
complete protocol lifecycle: transport, framing, message format, error
handling, connection management, and shutdown behavior.

The protocol is strict request-response. The shim sends one
`DecisionRequest`, blocks, and receives one `DecisionResponse`. There is
no multiplexing, no streaming, and no unsolicited messages from the engine.

---

## 2. Transport

### 2.1 Unix (Linux, macOS)

- Unix Domain Socket (AF_UNIX, SOCK_STREAM)
- Default path: `/tmp/loopstorm-engine.sock`
- Override: `--socket <path>` CLI flag or `LOOPSTORM_SOCKET` environment variable
- File permissions: `0600` (owner read/write only)
- The engine MUST refuse to start if the socket file already exists,
  unless `--force` is passed (which removes the stale socket first).
  This prevents socket hijacking.

### 2.2 Windows

- Named pipe: `\\.\pipe\loopstorm-engine` (or configurable via `--socket`)
- Access control: creator-owner only (equivalent to 0600)
- The named pipe is created by the engine; the shim connects as a client.

### 2.3 Path Resolution Order

1. `--socket <path>` CLI argument (highest priority)
2. `LOOPSTORM_SOCKET` environment variable
3. Platform default (see above)

---

## 3. Framing

Each message is a single JSON object serialized on one line, terminated
by a newline character (`\n`, U+000A). No length prefix. No framing
bytes. No envelope.

```
{"schema_version":1,"run_id":"...","seq":1,"tool":"...","args_hash":"...","ts":"..."}\n
```

### 3.1 Maximum Message Size

- **64 KiB** (65,536 bytes) per message, including the trailing newline.
- Messages exceeding this limit are rejected. The engine sends a kill
  response and closes the connection.
- Rationale: `DecisionRequest` payloads should be under 4 KiB in normal
  operation. 64 KiB provides generous headroom while preventing memory
  exhaustion from malicious or buggy clients.

### 3.2 Read Strategy

The engine reads bytes from the connection into a buffered reader until
it encounters `\n`. If 64 KiB of data is read without encountering `\n`,
the message is rejected.

### 3.3 Encoding

- UTF-8 only. Non-UTF-8 bytes cause a parse error.
- Newline characters within JSON string values MUST be escaped as `\n`
  (standard JSON escaping). The framing newline is the only literal
  U+000A byte on the wire.

---

## 4. Message Types

Exactly two message types exist on the wire:

| Direction | Message | Schema |
|---|---|---|
| Shim -> Engine | `DecisionRequest` | `schemas/ipc/decision-request.schema.json` |
| Engine -> Shim | `DecisionResponse` | `schemas/ipc/decision-response.schema.json` |

See the referenced JSON Schema files for field definitions.

### 4.1 Protocol Flow

```
[Shim]                                [Engine]
  |                                      |
  |--- DecisionRequest (NDJSON) -------->|
  |                                      |-- enforce() pipeline
  |<--- DecisionResponse (NDJSON) -------|
  |                                      |
  |--- DecisionRequest (NDJSON) -------->|
  |<--- DecisionResponse (NDJSON) -------|
  |                                      |
  |--- [close connection] -------------->|
```

### 4.2 Invariants

- Every `DecisionRequest` receives exactly one `DecisionResponse`.
- The shim MUST NOT send a second request before receiving the response
  to the first.
- The engine MUST NOT send unsolicited messages.
- The `run_id` and `seq` in the response MUST match the request.

---

## 5. Connection Model

- The engine accepts **multiple concurrent connections** (one per shim /
  agent process).
- Each connection is independent. No shared state is visible to the shim
  across connections.
- Internally, the engine shares `EnforcementContext` across connections
  (budget state and loop detection state are keyed by `run_id`).
- There is no handshake. The first bytes on the wire are the first
  `DecisionRequest`.
- There is no keepalive. The shim may hold the connection open for the
  duration of the agent run, or reconnect per call. The engine handles
  both patterns.

---

## 6. Error Responses

When the engine cannot process a request normally, it sends a
`DecisionResponse` with `decision: "kill"` and closes the connection.
This is fail-closed behavior per ADR-002.

| Error | `rule_id` | Behavior |
|---|---|---|
| Malformed JSON (parse error) | `__builtin_ipc_parse_error` | Kill + close |
| Message exceeds 64 KiB | `__builtin_ipc_message_too_large` | Kill + close |
| Unsupported `schema_version` | `__builtin_schema_version_unsupported` | Kill + close |
| Non-UTF-8 bytes | `__builtin_ipc_encoding_error` | Kill + close |
| Engine internal error | `__builtin_engine_error` | Kill + close |

The `reason` field contains a human-readable description of the error.

### 6.1 Error Response Format

Error responses use the standard `DecisionResponse` schema. The `run_id`
and `seq` fields are echoed from the request if available; otherwise,
`run_id` is set to `"unknown"` and `seq` to `0`.

---

## 7. Timeouts

- **Engine-side read timeout**: 30 seconds. If the engine does not
  receive a complete NDJSON line within 30 seconds of the last message
  (or connection establishment), it closes the connection. No kill
  response is sent (the shim is assumed to be gone).
- **Shim-side read timeout**: Recommended 10 seconds. If the shim does
  not receive a response within 10 seconds, it should treat the call as
  denied (fail-closed) and optionally attempt reconnection.
- These are defaults. They are not configurable in v1.

---

## 8. Shutdown Protocol

### 8.1 Graceful Shutdown (SIGTERM / SIGINT)

1. Engine stops accepting new connections.
2. Engine waits up to 5 seconds for in-flight requests to complete.
3. Engine flushes and closes the audit writer.
4. Engine removes the socket file (Unix) or closes the named pipe (Windows).
5. Engine writes a `system_event` to the audit log with
   `run_status: "engine_stopped"` before closing the audit writer.
6. Engine exits with code 0.

### 8.2 Forced Shutdown

If in-flight requests do not complete within 5 seconds, the engine sends
kill responses to all pending connections and proceeds with shutdown.

### 8.3 Engine Startup

On startup, the engine writes a `system_event` to the audit log with
`run_status: "engine_started"` as the first event in the log.

---

## 9. Security Considerations

- The UDS file permission (0600) ensures only the owning user can
  connect. This is the primary access control mechanism in Mode 0.
- The engine does not authenticate connecting clients. Any process
  running as the same user can connect. This is acceptable in Mode 0
  where the engine and agent run in the same user context.
- In Mode 1/2, additional authentication may be layered on top. This is
  not a v1 requirement.
- The engine never makes outbound network calls (Mode 0 invariant).
  Event forwarding to a hosted backend is the responsibility of a
  separate forwarder process or the shim.

---

## 10. Performance Targets

- **P99 round-trip latency**: < 5 ms (IPC overhead, excluding policy
  evaluation time)
- **Throughput**: 10,000+ decisions/second on a single engine instance
  (budget and loop detection state permitting)
- These targets are for local UDS communication. Named pipe performance
  on Windows may differ.

---

## 11. Compatibility

- The `schema_version` field in both request and response enables
  forward compatibility.
- The engine MUST reject requests with an unsupported `schema_version`
  (currently only version 1 is supported).
- Future schema versions may add optional fields to the existing
  messages. Removing or renaming fields is a breaking change requiring a
  new schema version.
- The engine MUST ignore unknown fields in `DecisionRequest` (forward
  compatibility for older engines receiving messages from newer shims).
  This requires `serde(deny_unknown_fields)` to NOT be set on
  `DecisionRequest`. (Current implementation: `additionalProperties:
  false` in the JSON Schema is for documentation; the Rust serde
  deserializer ignores unknown fields by default, which is the correct
  behavior for wire compatibility.)

---

## 12. Reference

- ADR-001: IPC Wire Format (foundational decision)
- ADR-002: Fail-Closed Default
- ADR-004: run_id Client-Generated
- ADR-005: JSONL Fail-Closed
- `schemas/ipc/decision-request.schema.json`
- `schemas/ipc/decision-response.schema.json`
- `specs/args-hash.md` (args_hash computation)
