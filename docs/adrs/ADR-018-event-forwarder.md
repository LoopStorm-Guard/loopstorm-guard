<!-- SPDX-License-Identifier: MIT -->
# ADR-018: HTTP Event Forwarder (Mode 2 Architecture)

**Status:** Accepted
**Date:** 2026-04-09
**Author:** Lead Architect

---

## Context

The v1.1 production readiness audit (`docs/v1.1-production-readiness-audit-2026-04-07.md`, Section 9B) identified a fundamental architectural gap: **there is no code path that moves events from a customer's local engine to the hosted backend.**

The engine writes tamper-evident JSONL audit records to a local file. The hosted backend exposes an `events.ingest` tRPC procedure that accepts batches of raw JSONL lines and re-verifies the hash chain server-side. Between these two endpoints, **nothing connects them.** The intended Mode 2 data flow is:

```
Agent -> Shim -> Engine (UDS) -> JSONL file on disk
                                       |
                                       v  (???)
                                  Backend events.ingest
                                       |
                                       v
                                  PostgreSQL + Dashboard
```

The `???` arrow does not exist in the code. Without it, **Mode 2 is not a product.** Customers who install the engine and subscribe to the hosted dashboard have no way to see their events in the dashboard. This is the load-bearing architectural gap of the entire commercial offering.

### Invariants That Any Solution Must Preserve

1. **Mode 0 must remain fully functional and strictly local.** A customer with no network access, no account, and no API key must be able to run the engine exactly as they can today. The forwarder is strictly additive.
2. **The enforcement plane must never make outbound HTTP calls.** ADR-012 established the enforcement/observation plane separation as inviolable. The engine enforces policy on the hot path; adding an outbound HTTP call to the enforcement path blurs this boundary and introduces a network dependency into policy evaluation. **This is forbidden.**
3. **Local JSONL writes must never be dropped or lost.** The local JSONL file is the authoritative audit record under ADR-005 (fail-closed JSONL). The forwarder consumes the file after it is written; nothing the forwarder does can affect whether an event is persisted locally.
4. **Hash-chain continuity must be verifiable end-to-end.** The backend already re-verifies the chain server-side. A partial batch (first 500 of 1000 events) must be verifiable against the last committed state, and the next batch must resume from there without breaking the chain.
5. **Fail-closed applies to the local engine, not to the forwarder.** If the forwarder fails (network down, backend down, auth error), the engine is unaffected. If the engine fails, the forwarder has nothing to forward — the customer experiences a local enforcement failure, not a forwarding failure.
6. **Licensing boundary.** The forwarder consumes hosted-backend APIs (AGPL-backed) but must not import AGPL code. It lives in the MIT licensing tier. Per ADR-013, `apps/cli` and `apps/engine` are MIT.

### The Four Options Considered

**Option 1: CLI subcommand (one-shot batch upload).**
A new `loopstorm upload audit.jsonl --api-key lsg_xxx --url https://api.loop-storm.com` command reads the file once, POSTs it in batches, exits.

- Pros: Simplest possible design. Runs on demand. No state, no daemon, no restart semantics.
- Cons: Not continuous — customer must schedule or invoke manually. No tail-following. Uploading a 1GB JSONL file re-reads the entire file even if only the last 10MB is new. Cron scheduling is the customer's problem.

**Option 2: CLI daemon subcommand (tail-follow with state).**
A new `loopstorm forward --file audit.jsonl --api-key lsg_xxx --url https://api.loop-storm.com` command tails the file (similar to `tail -F`), batches events, POSTs to the backend, persists the last-acknowledged offset in a sidecar state file for safe restarts.

- Pros: Continuous upload with near-real-time latency. Survives restarts cleanly via state file. No cron scheduling needed. Handles file rotation (via `tail -F` semantics). Runs as a long-lived process (systemd, Docker, supervisor, etc.).
- Cons: Long-lived process to manage. Sidecar state file must be protected from corruption. Must handle concurrent writers (the engine is writing while the forwarder is reading).

**Option 3: Engine-native HTTP sink (Rust, in the enforcement path).**
Modify the Rust engine to emit events to both the JSONL file AND an HTTP endpoint. Configure via policy YAML or env var.

- Pros: No separate process. Simpler operator experience — "just configure the endpoint in your policy."
- Cons: **Violates invariant #2.** The enforcement plane must not make outbound HTTP calls. Adding an HTTP sink to the engine's write path introduces a network dependency into the hot path and blurs the enforcement/observation boundary. Even with "best-effort" semantics and a background channel, the engine's audit writer now depends on the network's behavior. This creates security and reliability failure modes that the engine has carefully avoided. **Rejected.**

**Option 4: Shim-side HTTP sink (Python/TS shims POST directly to backend after each IPC round-trip).**
The shim, which already handles the IPC call to the engine, additionally POSTs each event to the backend.

- Pros: Runs in the customer's agent process; no separate forwarder to manage.
- Cons: The shim's decision path is synchronous — the agent waits for the shim to return. Adding a network POST to every tool call doubles the latency and adds a second failure mode to the hot path. If the backend is slow, the agent is slow. If the backend is down, the shim must either fail-open (not great) or fail-closed (breaks the agent). Each shim implementation (Python, TS, future Go, Rust, etc.) must re-implement the forwarder logic. Hash chains are harder to maintain because the shim doesn't have access to the full JSONL record that the engine wrote — the shim only sees the IPC decision, not the final audit line. **Rejected.**

---

## Decision

**Adopt Option 2: A new `loopstorm forward` CLI subcommand implemented in `apps/cli` (MIT, Rust). It tails a JSONL audit file, batches events up to 1000 records or 5 MB per batch, POSTs each batch to `{backend_url}/api/events/ingest` with `Authorization: Bearer lsg_xxx`, and persists the last-acknowledged offset in a sidecar `.loopstorm-forward-state` file beside the audit file.**

The engine and the enforcement plane are untouched. The forwarder is strictly observation plane. Mode 0 is unaffected. ADR-012's separation is preserved.

### Implementation Contract

#### 1. CLI surface

```
loopstorm forward \
  --file /var/log/loopstorm/audit.jsonl \
  --url https://api.loop-storm.com \
  --api-key lsg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  [--state-file /var/log/loopstorm/audit.jsonl.loopstorm-forward-state] \
  [--batch-size 1000] \
  [--batch-bytes 5242880] \
  [--flush-interval 2s] \
  [--max-retries 10] \
  [--verbose]
```

- `--file` (required): Path to the JSONL audit file to follow.
- `--url` (required): Base URL of the LoopStorm backend. The forwarder posts to `{url}/api/events/ingest`.
- `--api-key` (required): API key (`lsg_` + 32 hex). Sent as `Authorization: Bearer <key>`. The key must have the `ingest` scope (enforced server-side per ADR-020 acceptance work).
- `--state-file` (default: `{file}.loopstorm-forward-state`): Path to the state file. Sidecar file next to the JSONL file by default.
- `--batch-size` (default: 1000): Maximum events per POST. Server-side limit is 1000 (matches `events.ingest`).
- `--batch-bytes` (default: 5 MiB = 5242880 bytes): Maximum bytes per POST. Server-side limit is 10 MiB; the forwarder targets half of that for safety.
- `--flush-interval` (default: 2s): Maximum time to wait before flushing a partial batch (so events don't sit indefinitely during low-traffic periods).
- `--max-retries` (default: 10): Maximum retry attempts per batch before surfacing a non-recoverable error.
- `--verbose`: Enable debug logging.

Environment-variable equivalents for every flag (`LOOPSTORM_FORWARD_FILE`, `LOOPSTORM_FORWARD_URL`, `LOOPSTORM_FORWARD_API_KEY`, etc.) are supported for container deployments.

#### 2. Protocol

Each batch POST:

```
POST {url}/api/events/ingest HTTP/1.1
Host: api.loop-storm.com
Authorization: Bearer lsg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/x-ndjson
Content-Length: <batch_size>
X-Loopstorm-Forwarder-Version: 1.0
X-Loopstorm-Batch-First-Seq: <first seq in batch>
X-Loopstorm-Batch-Last-Seq: <last seq in batch>

<ndjson line 1>
<ndjson line 2>
...
<ndjson line N>
```

- Body format: newline-delimited JSON (NDJSON), one audit event per line, exactly as read from the JSONL file. The backend's `events.ingest` already accepts raw JSONL lines and re-verifies the hash chain per ADR-P3 design.
- Response: `200 OK` with a JSON body `{"accepted": N, "last_seq": "...", "last_hash": "..."}`. The forwarder verifies that `accepted == batch length` and that `last_seq` matches what it sent. If they disagree, treat as a fatal error and log loudly.
- Errors:
  - `401 Unauthorized`: API key invalid or revoked. Fatal — exit with error code 2.
  - `403 Forbidden`: API key does not have `ingest` scope. Fatal — exit with error code 2.
  - `402 Payment Required`: Tenant is over plan quota (reserved for ADR-019 billing). **Back off, do NOT drop events**, surface a warning, retry with exponential backoff up to `--max-retries`, then pause indefinitely with a clear log message until the operator intervenes or the quota resets. Never truncate the state file on 402.
  - `413 Payload Too Large`: Batch exceeded server limits. Halve the batch size for this specific batch and retry. If already at minimum batch size (1 event), fatal.
  - `429 Too Many Requests`: Rate limited. Back off per the `Retry-After` header or exponential backoff if absent.
  - `5xx`: Transient backend error. Exponential backoff, retry up to `--max-retries`.

#### 3. State file format

The sidecar `.loopstorm-forward-state` file is JSON:

```json
{
  "schema_version": 1,
  "file_path": "/var/log/loopstorm/audit.jsonl",
  "file_inode": 123456,
  "last_committed_offset": 1048576,
  "last_committed_seq": "42",
  "last_committed_hash": "a1b2c3...",
  "last_updated": "2026-04-09T15:30:00.000Z"
}
```

- `schema_version`: Always 1 in v1.1. Bumped on breaking format changes.
- `file_path`: Full path to the audit file, for validation against the `--file` argument.
- `file_inode`: The inode of the audit file at the time of last commit. If the inode changes (log rotation), the forwarder detects rotation and handles it.
- `last_committed_offset`: Byte offset of the first byte **after** the last successfully POSTed line. Next read starts from this byte.
- `last_committed_seq`: Sequence number of the last event successfully committed (for cross-verification against the backend's response).
- `last_committed_hash`: Hash of the last committed line (for cross-verification against the backend's response).
- `last_updated`: ISO 8601 timestamp.

**Write semantics:** The state file is updated **only after** a batch POST succeeds with `200 OK` and the response confirms the sequence/hash. Writes use the standard atomic-rename pattern: write to `.loopstorm-forward-state.tmp`, fsync, rename to `.loopstorm-forward-state`. This guarantees the state file is never partially written, even under power loss.

**Read semantics:** On startup, the forwarder reads the state file. If it exists and the inode matches the current file, the forwarder seeks to `last_committed_offset` and resumes. If the state file is missing, the forwarder starts from byte 0. If the state file exists but the inode does not match (log rotation happened), the forwarder starts from byte 0 of the new file. If the state file is corrupt (JSON parse fails), the forwarder refuses to start and requires operator intervention — losing state is a data integrity issue that should not be silently recovered.

#### 4. Tail-follow semantics

The forwarder uses an internal reader that mimics `tail -F`:

- Open the file in read mode.
- Seek to `last_committed_offset` (or 0 if no state).
- Read lines in a loop.
- If EOF is reached with a complete line ending in `\n`, process it.
- If EOF is reached mid-line (no trailing `\n`), the line is incomplete — the engine is still writing it. Back off 50ms and retry the read.
- Periodically (every 500ms) `stat` the file. If the inode has changed, the file has been rotated. Log the rotation, close the current file, open the new file, reset offset to 0, and continue. Write a new state file with the new inode.
- Use `inotify` (Linux), `kqueue` (macOS), or polling (Windows, any other Unix) for efficient change notification. Polling at 100ms is acceptable in v1.1 to keep the implementation portable.

**Concurrent-writer safety:** The engine is writing to the same file the forwarder is reading. The engine writes complete lines with a trailing `\n` (enforced by the audit writer's `writeln!` pattern). The forwarder guarantees that it never reads a partial line by only committing lines that end in `\n`. On EOF mid-line, the forwarder waits for more bytes.

#### 5. Batching algorithm

```
loop:
  events = []
  bytes = 0
  batch_start_time = now()
  
  while len(events) < batch_size
    and bytes < batch_bytes
    and (now() - batch_start_time) < flush_interval:
      line = read_next_line(blocking with 50ms poll)
      if line is None:
          break  # EOF or mid-line, flush what we have
      events.append(line)
      bytes += len(line)
  
  if len(events) == 0:
      sleep(100ms)
      continue
  
  success = post_batch(events)
  if success:
      write_state_file(new_offset, last_seq, last_hash)
  else:
      (retry logic in post_batch handles this)
```

The forwarder never drops events on the success path. On fatal errors, it exits with a non-zero code and the state file is untouched — the next run resumes from the last committed offset.

#### 6. Backpressure behavior

If the backend is unreachable or returning errors:

1. The forwarder retries with exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, capped at 60s between retries.
2. Up to `--max-retries` (default 10) attempts per batch.
3. On exhaustion, the forwarder logs `ERROR: batch upload failed after N retries, pausing` and enters a **pause loop**: continues tailing the file into an in-memory queue (capped at 10,000 events), waits 60s, retries.
4. If the in-memory queue exceeds its cap, the forwarder logs `WARNING: forwarder queue full, waiting for backend` and blocks file reading. The engine continues writing to disk; the file grows unbounded; the forwarder will resume as soon as the backend is reachable.
5. **Under no circumstance does the forwarder delete or truncate the audit file.** The audit file is the customer's authoritative record. The forwarder only reads it.
6. **Under no circumstance does the forwarder return an error to the engine.** The engine and the forwarder are fully decoupled.

This preserves invariant #3 (local JSONL never dropped) and invariant #2 (engine never depends on network).

#### 7. Hash-chain continuity verification

The backend's `events.ingest` already re-verifies the hash chain on every batch per the P3 design. It knows the last committed hash per run_id and rejects any batch whose first event's `hash_prev` does not match. This ADR does not change that logic — it explicitly relies on it.

The forwarder plays a supporting role:
- Each batch is read from the file in exact byte order (no reordering, no deduplication).
- The response from the backend includes `last_seq` and `last_hash`. The forwarder cross-checks these against the last line of the batch. Any mismatch is a fatal error (log loudly, exit).
- On partial batches (server accepts first 500 of 1000), the forwarder treats this as a successful advance — updates state to the last accepted offset, logs a warning, re-reads the remaining 500 on the next iteration. (In practice, the server accepts all or none per ADR-P3; partial accepts are a defensive design.)

#### 8. Mode 0 behavior

The forwarder is **strictly opt-in**. Mode 0 customers never start it. The engine and JSONL file work identically with or without the forwarder. There is no "mode switch" — Mode 2 is simply "Mode 0 plus a running forwarder process."

The forwarder is not bundled into the engine binary. It is a separate subcommand of the CLI binary (`loopstorm`). A Mode 0 customer who has `loopstorm` installed but never runs `loopstorm forward` has Mode 0 behavior. A Mode 2 customer runs `loopstorm forward` as a systemd service, Docker container, or background process alongside their engine.

#### 9. Interaction with ADR-019 (billing and plan enforcement)

ADR-019 specifies that the backend returns `402 Payment Required` when a tenant is over plan quota. The forwarder's behavior on 402 is:

1. **Never drop events.** The audit file is still valid; the state file is untouched.
2. **Back off and retry with exponential backoff** up to `--max-retries`.
3. **On retry exhaustion, enter a pause loop.** Log `ERROR: tenant over quota (402), pausing uploads` and continue tailing the file into the in-memory queue.
4. **Emit a structured error message** to stderr suitable for monitoring systems: `{"level":"error","event":"forwarder_paused_quota","tenant":"...","timestamp":"..."}`.
5. **Never truncate the audit file or the state file.**
6. **Resume automatically** when the backend returns 200 on a retry (new billing period, quota increased, etc.).

This guarantees that a customer who falls behind on billing does NOT lose audit data. Their local engine continues to work, their audit file continues to grow, and the forwarder catches up when billing is resolved. This preserves the "OSS first, SaaS additive" invariant: **losing your hosted subscription never costs you your audit records.**

### Rationale

- **Preserves enforcement/observation plane separation (ADR-012).** The engine and the enforcement path are untouched. The forwarder is pure observation-plane code. The engine never makes outbound HTTP calls.
- **Preserves Mode 0.** Mode 0 works without the forwarder. The forwarder is additive.
- **Preserves fail-closed (ADR-002, ADR-005).** Local JSONL is the source of truth. The forwarder consumes it; failures do not affect local enforcement.
- **MIT licensing boundary preserved (ADR-013).** The forwarder lives in `apps/cli` (MIT). It consumes the backend's HTTP API but imports no backend code.
- **Single binary for customers.** The `loopstorm` CLI is already distributed as part of the release pipeline. Adding a subcommand does not introduce a new binary, package, or installation step.
- **Decouples engine release cycle from forwarder release cycle.** The forwarder can ship fixes and new features without touching the engine. The engine's hot path is protected from changes.
- **Testable end-to-end.** The forwarder can be tested in isolation against a mock HTTP server, and end-to-end with a live engine writing to a test JSONL file and a local backend.
- **Operator-friendly.** The forwarder runs as a conventional long-lived process. systemd, Docker, Kubernetes, supervisord, etc., all handle it identically to any other daemon.
- **Log-rotation-aware.** Customers who use logrotate or similar tools for the JSONL file are handled via inode tracking.
- **Portable across OSes.** Polling-based change detection works everywhere Rust compiles. Native inotify/kqueue is an optimization, not a requirement.
- **Billing-compliant.** Plan enforcement (ADR-019) interacts cleanly via HTTP status codes. The forwarder never drops events due to billing state; it pauses and resumes.

---

## Consequences

### Positive

1. **Mode 2 becomes a real product.** The load-bearing architectural gap is closed.
2. **Mode 0 is unchanged.** Zero impact on the free tier's enforcement, audit, or verification paths.
3. **Enforcement plane is untouched.** The engine remains a pure enforcement component with no network dependency.
4. **Customer's audit records are durable.** Even during billing disputes, backend outages, or multi-day disconnections, the local JSONL file is complete and the forwarder catches up when connectivity returns.
5. **One binary, one install.** The `loopstorm forward` subcommand ships with the existing `loopstorm` CLI. No new package, no new install step.
6. **Testable in isolation.** Unit tests cover the batching algorithm, state file I/O, retry logic, and protocol. Integration tests cover end-to-end with a real engine and a mock backend.
7. **Backwards compatible with existing shims.** Python and TypeScript shims require no changes. The forwarder consumes the same JSONL that the shims cause the engine to write.
8. **License audit passes.** The forwarder is MIT and imports no AGPL code.

### Negative

1. **Customers must run a separate process.** Mode 2 requires the customer to start and maintain a long-running forwarder process alongside their agent. Documentation must be clear on systemd, Docker, and Windows service patterns. Some customers will find this operationally complex compared to a magic "just works" single binary.
2. **State file management.** The sidecar `.loopstorm-forward-state` file introduces a new artifact. If the customer deletes it, the forwarder re-uploads from the beginning of the current audit file (creating duplicate events — though the backend's hash chain re-verification will detect these). Documentation must warn against deleting the state file.
3. **Polling overhead.** The fallback polling loop (100ms) uses minimal CPU but is non-zero. On deployment platforms that bill by CPU time, this is a small ongoing cost. Native inotify/kqueue eliminates this but is a follow-up optimization.
4. **Backpressure can cause unbounded audit file growth.** If the backend is unreachable for a very long time, the customer's audit file grows unbounded. This is by design (fail-closed), but customers must monitor disk space. Documentation must recommend log rotation and retention policies.
5. **Network delivery is best-effort, not guaranteed.** If the customer's machine dies before the forwarder uploads its in-memory queue, those events are still on disk (the engine wrote them before the forwarder got to them), so they're not lost — but they're not uploaded either until the forwarder resumes. This is acceptable because the audit file is the source of truth.
6. **No end-to-end encryption beyond TLS.** The audit events are sent over HTTPS but not additionally encrypted or signed in v1.1. The existing hash chain provides tamper detection, not confidentiality. This matches the v1.0 threat model.
7. **Exposes a new attack surface.** A stolen API key can be used to upload forged events. Mitigation: API keys are scoped (ADR-020 work), revocable, and backend-side chain verification rejects any event that does not match the tenant's existing chain. The threat model is documented in `docs/guides/threat-model.md`.

### Neutral

1. **The forwarder is not the only way to get data into the backend.** A future CLI subcommand `loopstorm upload file.jsonl` (Option 1 from above) can be added in v1.2 for one-shot bulk imports or migration scenarios. It is not needed in v1.1.
2. **The forwarder does not encrypt events at rest.** It only reads and forwards. Local encryption is a separate concern, out of scope.
3. **The forwarder does not transform events.** It does not filter, redact, sample, or modify events in any way. Whatever the engine wrote is what the backend receives. This is intentional — modification would break the hash chain.

---

## Migration Path

### From no-forwarder to v1.1-forwarder

1. **Implement `loopstorm forward` subcommand** in `apps/cli/src/commands/forward.rs`. Reuse the existing `reqwest` or `ureq` HTTP client dependency in the CLI crate. Keep it in Rust (MIT).
2. **Implement the state file I/O** with atomic rename, JSON serialization, inode tracking.
3. **Implement tail-follow reader** with polling fallback and (optionally) inotify/kqueue for Linux/macOS.
4. **Implement batching, retry, and backpressure logic.**
5. **Add unit tests** covering:
   - State file atomic write
   - State file corruption handling
   - Tail-follow on a growing file
   - Log rotation detection via inode change
   - Batch size and byte limits
   - Retry with exponential backoff
   - 402 backpressure pause-and-resume
   - Fatal error handling (401, 403)
6. **Add integration tests** covering:
   - End-to-end: engine writes JSONL → forwarder reads → forwarder POSTs to a mock backend → backend verifies chain → forwarder persists state
   - Restart safety: kill the forwarder mid-batch, restart, verify no duplicate uploads and no missed events
   - Backend outage: mock backend returns 503, forwarder backs off, backend recovers, forwarder catches up
6.1 **Add the test vectors to `specs/event-forwarder.md`** so other consumers can verify the protocol.
7. **Write `specs/event-forwarder.md`** with the full CLI surface, protocol, state file format, and error codes.
8. **Update `docs/guides/`** with Mode 2 setup instructions using the forwarder.
9. **Update the release pipeline** to ensure the `loopstorm forward` subcommand is included in all 5 cross-compiled binary targets (it is, automatically, because it's part of the single CLI binary).
10. **Update `docs/secrets-inventory.md`** to document the forwarder's API key requirements.

### Future work (v1.2+)

- **Inotify/kqueue integration** for sub-100ms latency on Linux/macOS.
- **Option 1 bulk-upload subcommand** (`loopstorm upload file.jsonl`) for migrations and one-shot imports.
- **Compression** — if bandwidth becomes a concern, add optional gzip on the POST body. The backend already accepts gzip per HTTP standard.
- **mTLS** — for enterprise customers who require mutual TLS, add client-certificate support.
- **Metrics endpoint** — expose Prometheus metrics (lag, throughput, error rate) on a configurable port.
- **Health check endpoint** — expose `/health` for orchestrators.

---

## Acceptance Criteria

- **AC-18-1:** `loopstorm forward` subcommand exists in `apps/cli` and is available in all 5 cross-compiled release binaries.
- **AC-18-2:** The forwarder reads from a JSONL file via tail-follow and handles log rotation via inode tracking.
- **AC-18-3:** The forwarder batches events up to 1000 records or 5 MB per POST (whichever comes first), respecting the backend's ingest limits.
- **AC-18-4:** The forwarder persists a sidecar state file `{file}.loopstorm-forward-state` with atomic-rename semantics.
- **AC-18-5:** On restart, the forwarder resumes from the last committed offset with no duplicate uploads and no missed events.
- **AC-18-6:** On log rotation (inode change), the forwarder transitions cleanly to the new file.
- **AC-18-7:** On `401` or `403` response, the forwarder exits with a non-zero code and does not truncate the state file.
- **AC-18-8:** On `402` response, the forwarder backs off, pauses, and resumes without dropping events. The state file is never truncated.
- **AC-18-9:** On `5xx` response, the forwarder retries with exponential backoff up to `--max-retries`.
- **AC-18-10:** Local JSONL writes are NEVER affected by forwarder behavior. The engine is fully decoupled.
- **AC-18-11:** The forwarder imports no AGPL code and lives entirely in MIT-licensed packages.
- **AC-18-12:** The engine imports no forwarder code and makes no outbound HTTP calls. ADR-012's plane separation is preserved.
- **AC-18-13:** Integration tests exercise end-to-end: engine → JSONL → forwarder → mock backend → state file.
- **AC-18-14:** Integration tests exercise restart safety: kill mid-batch, restart, verify exactly-once semantics.
- **AC-18-15:** Integration tests exercise backend outage: mock backend down, forwarder backs off, backend recovers, forwarder catches up.
- **AC-18-16:** `specs/event-forwarder.md` documents the CLI surface, protocol, state file format, and error codes.
- **AC-18-17:** `docs/guides/` includes a Mode 2 setup guide using the forwarder.
- **AC-18-18:** Mode 0 smoke test (CI) continues to pass unchanged. Mode 0 customers require no forwarder.
- **AC-18-19:** The forwarder's batch POST body is byte-for-byte what the backend's `events.ingest` expects (raw NDJSON, one audit line per line).
- **AC-18-20:** The backend's chain verification passes for every batch uploaded by the forwarder under normal conditions.

---

## References

- ADR-002 — Fail-closed default
- ADR-005 — JSONL fail-closed
- ADR-006 — Queue backpressure (pattern informs this ADR's backpressure design)
- ADR-012 — AI Supervisor architecture (enforcement/observation plane separation)
- ADR-013 — Open-core licensing (MIT boundary for `apps/cli`)
- ADR-019 — Billing and plan enforcement (to be written; this ADR anticipates the 402 contract)
- ADR-020 — RLS transaction scoping (informs the ingest endpoint's behavior under load)
- `docs/v1.1-production-readiness-audit-2026-04-07.md` — Section 9B (the load-bearing gap)
- `docs/oss-saas-business-model.md` — Mode 2 architectural requirements
- `apps/cli/` — existing CLI crate where the new subcommand lives
- `packages/backend/src/routers/events.ts` — existing `events.ingest` procedure (the forwarder's consumer)
- `docs/guides/event-schema.md` — event format the forwarder transports
