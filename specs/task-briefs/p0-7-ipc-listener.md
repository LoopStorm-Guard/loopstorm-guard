<!-- SPDX-License-Identifier: MIT -->
# Task Brief: P0-7 -- UDS/Named Pipe IPC Listener

**Priority:** P0 (blocking all downstream work)
**Assignee:** Engine implementation agent
**Branch:** `feat/p0-7-ipc-listener` (from `main` at `26a2914`)
**Gate:** IPC Wire Format Spec (`specs/ipc-wire-format.md`) -- RESOLVED
**Blocked by:** Nothing (all dependencies are merged)
**Blocks:** P1 (Python shim), P2 (CLI), all E2E tests

---

## Objective

Make the `loopstorm-engine` binary functional: accept connections over a
Unix Domain Socket (or named pipe on Windows), read NDJSON
`DecisionRequest` messages, call the existing `enforce()` pipeline, and
write NDJSON `DecisionResponse` messages back.

After this PR, a user can:
1. Start the engine: `loopstorm-engine --policy policy.yaml`
2. Connect to the UDS from any process
3. Send a JSON `DecisionRequest` followed by `\n`
4. Receive a JSON `DecisionResponse` followed by `\n`

---

## Scope -- EXACTLY This, Nothing More

### In Scope

1. **`src/server.rs`** -- new module: async UDS/named pipe listener
   - Tokio-based async accept loop
   - Per-connection task via `tokio::spawn`
   - Buffered NDJSON read (64 KiB max message size)
   - Deserialize `DecisionRequest`, call `enforce()`, serialize `DecisionResponse`
   - Error handling per `specs/ipc-wire-format.md` section 6
   - Read timeout (30 seconds)
   - Graceful shutdown on SIGTERM/SIGINT

2. **`src/main.rs`** -- replace stub with real entry point
   - CLI argument parsing (use `clap` -- add to workspace dependencies)
   - Arguments: `--policy`, `--socket`, `--audit-log`, `--log-level`, `--version`, `--validate-policy`
   - Initialize tracing subscriber
   - Create `EnforcementContext`
   - Start server
   - Handle shutdown signals

3. **`src/lib.rs`** -- add `pub mod server;`

4. **Tests**
   - Unit test: NDJSON parse + serialize round-trip
   - Unit test: oversized message rejection
   - Unit test: malformed JSON returns kill response
   - Unit test: unsupported schema_version returns kill response
   - Integration test: start engine, connect via UDS, send request, verify response
   - Integration test: graceful shutdown (SIGTERM, verify audit log has engine_stopped event)
   - Integration test: multiple concurrent connections

5. **Cargo.toml changes**
   - Add `clap = { version = "4", features = ["derive"] }` to workspace dependencies
   - Add `clap` dependency to engine package

### Out of Scope -- Do NOT Implement

- Windows named pipe support (stub with `cfg(windows)` compile error or todo!() for now)
- Runtime JSON Schema validation (serde is the validation layer)
- Any changes to the enforcement pipeline (`enforce()`, `evaluate()`, etc.)
- Any network calls
- Any changes to JSON schema files
- MCP proxy mode
- Event forwarding
- Approval polling/subscription

---

## Architecture Decisions

### Concurrency

```rust
// Shared enforcement context
let ctx = Arc::new(Mutex::new(EnforcementContext::new(policy_path, audit_path)?));

// Accept loop
loop {
    let (stream, _) = listener.accept().await?;
    let ctx = Arc::clone(&ctx);
    tokio::spawn(async move {
        handle_connection(stream, ctx).await;
    });
}
```

The `Mutex` is `tokio::sync::Mutex` (not `std::sync::Mutex`) because
`enforce()` performs I/O (audit writes). The critical section is small:
one `enforce()` call per request.

**IMPORTANT**: Use `tokio::sync::Mutex`, not `std::sync::Mutex`. The
enforce function does file I/O (audit writes), and holding a std Mutex
across an await point would be unsound.

### Connection Handler Pseudocode

```
fn handle_connection(stream, ctx):
    reader = BufReader::new(stream)
    loop:
        line = read_line_with_timeout(reader, 30s, 64KiB)
        if line is EOF: break  // client disconnected
        if line is timeout: break  // idle timeout
        if line is too large: send kill response, break

        match serde_json::from_str::<DecisionRequest>(&line):
            Ok(request):
                if request.schema_version != 1:
                    send kill response (unsupported version), break
                let mut ctx = ctx.lock().await
                let response = enforce(&request, &mut *ctx)
                drop(ctx)  // release lock before writing
                send response as NDJSON
            Err(e):
                send kill response (parse error), break
```

### Socket Lifecycle

1. Check if socket file exists. If yes, refuse to start (print error).
2. Bind the UDS listener.
3. Set file permissions to 0600.
4. Write `engine_started` system event to audit log.
5. Enter accept loop.
6. On SIGTERM/SIGINT: set shutdown flag, stop accepting, drain, write
   `engine_stopped`, remove socket file, exit.

### CLI Arguments (clap derive)

```rust
#[derive(Parser)]
#[command(name = "loopstorm-engine")]
#[command(about = "LoopStorm Guard enforcement engine")]
struct Cli {
    /// Path to policy YAML file
    #[arg(long, required_unless_present = "version")]
    policy: Option<PathBuf>,

    /// UDS socket path
    #[arg(long, env = "LOOPSTORM_SOCKET",
          default_value = "/tmp/loopstorm-engine.sock")]
    socket: PathBuf,

    /// JSONL audit log path
    #[arg(long, default_value = "./loopstorm-audit.jsonl")]
    audit_log: PathBuf,

    /// Log level (trace, debug, info, warn, error)
    #[arg(long, default_value = "info")]
    log_level: String,

    /// Print version and exit
    #[arg(long)]
    version: bool,

    /// Validate policy file and exit
    #[arg(long)]
    validate_policy: bool,
}
```

---

## Invariants to Verify

These invariants MUST be tested. They are non-negotiable.

1. **Fail-closed on parse error**: Malformed JSON -> kill response -> connection closed
2. **Fail-closed on internal error**: Any panic or error in enforce() -> kill response
3. **Audit write failure = kill**: Already enforced in `enforce()`, but verify the kill propagates through the IPC response
4. **escalate_to_human always allowed**: Send a request with `tool: "escalate_to_human"` through the IPC path and verify `allow`
5. **Socket permissions**: Verify 0600 on the socket file after creation
6. **Graceful shutdown**: SIGTERM -> engine_stopped event in audit log -> socket file removed
7. **No stale socket**: Engine refuses to start if socket exists

---

## Files to Create/Modify

| File | Action | Description |
|---|---|---|
| `apps/engine/src/server.rs` | CREATE | Async UDS listener, connection handler |
| `apps/engine/src/main.rs` | REWRITE | Replace stub with clap + server startup |
| `apps/engine/src/lib.rs` | MODIFY | Add `pub mod server;` |
| `apps/engine/Cargo.toml` | MODIFY | Add `clap` dependency |
| `Cargo.toml` (workspace) | MODIFY | Add `clap` to workspace dependencies |
| `apps/engine/tests/ipc_integration.rs` | CREATE | Integration tests |

---

## Test Plan

### Unit Tests (in server.rs)

1. `test_ndjson_round_trip` -- serialize DecisionResponse, verify valid NDJSON
2. `test_oversized_message_rejected` -- 65 KiB of data, verify kill response
3. `test_malformed_json_kill` -- invalid JSON string, verify kill response
4. `test_unsupported_schema_version` -- schema_version: 99, verify kill response

### Integration Tests (in tests/ipc_integration.rs)

5. `test_basic_allow_deny` -- start engine with a policy, send allowed and denied tool calls, verify responses
6. `test_escalate_to_human_via_ipc` -- send escalate_to_human, verify always allowed
7. `test_concurrent_connections` -- 3 concurrent connections, all get correct responses
8. `test_graceful_shutdown` -- start engine, send SIGTERM, verify audit log and socket cleanup
9. `test_validate_policy_flag` -- run with --validate-policy, verify exit code 0 for valid, non-zero for invalid
10. `test_stale_socket_refused` -- create a file at the socket path, verify engine refuses to start

### Benchmark Update

11. Update `benches/enforcement_pipeline.rs` to benchmark the full IPC round-trip (optional, P2 priority)

---

## Acceptance Criteria

- [ ] `loopstorm-engine --policy examples/basic-policy.yaml` starts and listens on UDS
- [ ] A client can connect, send NDJSON requests, and receive NDJSON responses
- [ ] All error cases produce kill responses (fail-closed)
- [ ] Graceful shutdown works (SIGTERM)
- [ ] `--validate-policy` validates and exits
- [ ] `--version` prints version + policy schema hash and exits
- [ ] All existing 49 tests still pass
- [ ] New tests pass (target: 10+ new tests)
- [ ] CI green (engine cross-compile, test-engine, mode0-smoke)
- [ ] No changes to JSON schema files, no changes to VERIFY.md

---

## Example Policy for Testing

Create `examples/basic-policy.yaml` if it does not exist:

```yaml
schema_version: 1
name: "test-policy"
rules:
  - name: "allow-reads"
    action: allow
    tool_pattern: "*_read"
  - name: "deny-writes-prod"
    action: deny
    tool_pattern: "*_write"
    conditions:
      - field: "environment"
        operator: equals
        value: "production"
    reason: "writes blocked in production"
  - name: "allow-writes"
    action: allow
    tool_pattern: "*_write"
  - name: "deny-all"
    action: deny
    reason: "default deny"
budget:
  hard:
    cost_usd: 10.0
    call_count: 1000
  soft:
    cost_usd: 8.0
loop_detection:
  enabled: true
  fingerprint_window: 10
  max_repeats: 3
  error_streak_threshold: 5
  cooldown_ms: 5000
```

---

## Dependencies

- `clap = { version = "4", features = ["derive"] }` -- CLI argument parsing
- `tokio` (already in workspace with `features = ["full"]`) -- async runtime, UDS, signals
- All other deps already present

---

## What NOT to Touch

- `evaluator.rs` -- no changes
- `policy.rs` -- no changes
- `budget.rs` -- no changes
- `loop_detector.rs` -- no changes
- `audit.rs` -- no changes (may need minor visibility change if `write_system_event` is added)
- `redaction.rs` -- no changes
- `decision.rs` -- no changes
- `schemas/` -- no changes
- `packages/schemas/` -- no changes
- `VERIFY.md` -- no changes
