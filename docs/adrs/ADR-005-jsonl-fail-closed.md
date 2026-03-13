<!-- SPDX-License-Identifier: MIT -->
# ADR-005: JSONL Write Failure Is Fail-Closed

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

The JSONL event log is the ground truth for every guarded run. Events are written synchronously before the engine returns a decision to the shim. If the JSONL write fails (disk full, permission error, I/O error), the engine must decide whether to:

1. Continue the run without logging (fail-open on write).
2. Halt the run because the audit trail is broken (fail-closed on write).

---

## Decision

**If the JSONL file cannot be written, the engine returns a `kill` decision and the run terminates.**

The audit trail is not optional. A run without a complete event log violates the product's core guarantee: every intercepted call is recorded. Continuing a run without logging produces an unauditable gap that undermines the integrity of the entire chain.

The engine emits a system error to stderr indicating the write failure and the reason. The shim receives the `kill` decision and raises `TerminateRunError` with a descriptive message.

This applies to:
- Disk full conditions
- File permission errors
- I/O errors on the JSONL file descriptor
- Any condition where `fsync` (or equivalent) fails after write

This does **not** apply to HTTP batch forwarding failures. The HTTP sink is best-effort and asynchronous. Its failure does not terminate the run because the local JSONL file is the ground truth, not the backend.

---

## Consequences

**Positive:**
- No run can proceed without an audit trail. The chain is either complete or the run is terminated.
- Operators discover disk and permission issues immediately rather than after a run completes with missing events.
- The integrity guarantee is unconditional: if a run completed, its JSONL log is complete.

**Negative:**
- A transient I/O error (e.g., momentary NFS hiccup) terminates the run even if the error would have resolved. This is the correct trade-off for an audit-critical system.
- Operators must ensure adequate disk space and correct file permissions before running agents. This is an operational requirement that must be documented.

---

## Migration Path

If a future version supports redundant write targets (e.g., write to two JSONL files simultaneously), the fail-closed behavior could be relaxed to require at least one successful write. This would require a new configuration option and careful specification of what constitutes "at least one successful write" in the presence of partial failures.
