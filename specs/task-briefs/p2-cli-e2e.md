<!-- SPDX-License-Identifier: MIT -->
# Task Brief: P2 -- CLI Commands + E2E Case Study Tests

**Priority:** P2
**Assignee:** Implementation agent (Rust)
**Branch:** `feat/p2-cli-e2e` (from `main` at `eee8069`)
**Gate:** P2 CLI Architecture -- RESOLVED by this document
**Blocked by:** P0-7 IPC Listener (merged), P1 Python Shim (merged or in progress)
**Blocks:** OSS release checklist items 6.1--6.3, 7.1--7.4
**Date:** 2026-03-17

---

## 1. Objective

Deliver the `loopstorm` CLI binary with three subcommands (`validate`,
`verify`, `replay`) and four mandatory end-to-end case study tests that
satisfy the OSS release checklist (Sections 6 and 7).

After this PR:

```bash
# Validate a policy file
loopstorm validate policy.yaml       # exits 0 on success, 1 on error

# Verify hash chain integrity of a JSONL audit log
loopstorm verify audit.jsonl         # exits 0 if chain valid, 1 if broken

# Replay and display audit log events (human-readable)
loopstorm replay audit.jsonl         # verifies chain + prints events
```

The four E2E case studies prove the full enforcement pipeline works
end-to-end: engine + IPC + shim + policy + audit.

---

## 2. Constraints

| # | Constraint | Source |
|---|---|---|
| C1 | **MIT license** -- every `.rs` file gets `// SPDX-License-Identifier: MIT` | ADR-013 |
| C2 | **Mode 0 first** -- all commands work fully offline, no network | Product doc |
| C3 | **Fail-closed** -- any ambiguity in verify/replay = report failure | ADR-002 |
| C4 | **Existing scaffold** -- the CLI crate already exists at `apps/cli/` with Cargo.toml and basic clap structure | Codebase |
| C5 | **Engine crate dependency** -- CLI depends on `loopstorm-engine` as a library; reuse policy loading, audit types, and hashing | Cargo.toml |
| C6 | **Deterministic exit codes** -- documented per command | This spec |
| C7 | **E2E tests are Rust integration tests** -- they live in `apps/cli/tests/` and test the full pipeline | This spec |

---

## 3. Architectural Decisions

### 3.1 CLI depends on engine crate as a library (not subprocess)

The CLI crate already has `loopstorm-engine = { path = "../engine" }` in
its Cargo.toml. This gives direct access to:

- `Policy::from_yaml()` and `Policy::from_yaml_str()` for validation
- `AuditEvent` (deserialization of JSONL lines)
- SHA-256 hashing functions (via `sha2` workspace dep)
- `POLICY_SCHEMA_HASH` for version output

The CLI does NOT invoke the engine binary as a subprocess. It links the
engine library directly.

### 3.2 `verify` is the primary chain verification command

The OSS release checklist describes two commands with overlapping scope:

- `loopstorm replay <file>` -- "verifies hash chain and exits 0 (valid) or 1 (broken)"
- `loopstorm verify <file>` -- "reports chain break position on failure"

**Resolution**: Both commands verify the hash chain. They differ in output:

| Command | Chain verification | Output on success | Output on failure |
|---|---|---|---|
| `verify` | Yes | `OK: N events, chain valid` | `FAIL: chain break at line L` + details |
| `replay` | Yes | Pretty-prints all events | Pretty-prints events up to break point + error |

`verify` is the quiet, scriptable command (exit code only + summary).
`replay` is the verbose, human-readable command (full event display).

### 3.3 E2E tests use in-process engine (same pattern as ipc_integration.rs)

The E2E case study tests follow the established pattern from
`apps/engine/tests/ipc_integration.rs`:

1. Build an `EnforcementContext` from a policy YAML string
2. Wrap it in `Arc<Mutex<...>>`
3. Start the server in a tokio task with `run_server_with_shutdown()`
4. Connect via `UnixStream` and send NDJSON `DecisionRequest` messages
5. Assert on `DecisionResponse` messages and audit log contents
6. Trigger graceful shutdown via a oneshot channel

The Python shim is NOT used in the E2E tests. The tests simulate the
shim side by sending raw NDJSON over UDS. This keeps the tests
self-contained within the Rust workspace and avoids cross-language
test dependencies.

**Rationale**: The Python shim has its own unit tests for IPC
correctness. The E2E tests verify the engine's enforcement pipeline
behavior, not the shim's implementation. Using raw NDJSON means the
tests can run on any platform with UDS support (Linux, macOS) without
requiring Python to be installed.

### 3.4 `validate` reuses engine's policy loading

The `validate` command calls `Policy::from_yaml()` directly. It also
prints:

- The policy name and description
- Number of rules
- Budget configuration summary
- Loop detection configuration summary
- The embedded policy schema hash (so the user can verify compatibility)

### 3.5 `filter` and `import` are deferred to P5

The OSS release checklist mentions `loopstorm filter` and
`loopstorm import`. These are not required for the four case studies
and are lower priority. They will be implemented in P5. The CLI enum
should NOT include stub variants for these commands yet -- add them
when they are implemented.

### 3.6 `replay` verifies chain then replays

The `replay` command is NOT about re-executing IPC sessions against a
running engine. It is a post-hoc audit tool that:

1. Reads a JSONL audit log file
2. Verifies the hash chain integrity (same algorithm as `verify`)
3. Pretty-prints each event in a human-readable format
4. If the chain is broken, prints events up to the break point, then
   reports the break with details

---

## 4. CLI Command Specifications

### 4.1 `loopstorm validate <policy>`

**Purpose**: Validate a policy YAML file against the engine's embedded
schema and rule compilation.

**Arguments**:

| Arg/Flag | Required | Description |
|---|---|---|
| `<policy>` | Yes | Path to policy YAML file |
| `--quiet`, `-q` | No | Suppress detailed output, just exit code |
| `--json` | No | Output validation result as JSON |

**Exit codes**:

| Code | Meaning |
|---|---|
| 0 | Policy is valid |
| 1 | Policy is invalid (parse error, schema error, or compilation error) |
| 2 | File not found or I/O error |

**Output (success, default)**:
```
OK: policy.yaml
  name:           "my-policy"
  rules:          5
  budget:         cost_usd: soft=5.00 hard=10.00, call_count: hard=1000
  loop_detection: enabled (threshold=3, window=120s, cooldown=5000ms)
  schema_hash:    10725f37ecb7e82d...
```

**Output (failure, default)**:
```
FAIL: policy.yaml
  error: unsupported schema_version 99 (expected 1)
```

**Output (--json, success)**:
```json
{"valid":true,"name":"my-policy","rules":5,"schema_hash":"10725f37ecb7e82d..."}
```

**Output (--json, failure)**:
```json
{"valid":false,"error":"unsupported schema_version 99 (expected 1)"}
```

### 4.2 `loopstorm verify <audit_log>`

**Purpose**: Verify the hash chain integrity of a JSONL audit log.

**Arguments**:

| Arg/Flag | Required | Description |
|---|---|---|
| `<audit_log>` | Yes | Path to JSONL audit log file |
| `--quiet`, `-q` | No | Suppress detailed output, just exit code |
| `--json` | No | Output verification result as JSON |

**Exit codes**:

| Code | Meaning |
|---|---|
| 0 | Chain is valid |
| 1 | Chain is broken (mismatch detected) |
| 2 | File not found, I/O error, or malformed JSONL |

**Verification algorithm**:

```
For each line L[i] (0-indexed) in the JSONL file:
  1. Parse L[i] as JSON. If parse fails: FAIL (line i, "malformed JSON").
  2. Extract `hash` and `hash_prev` fields.
  3. If i == 0: assert `hash_prev` is null or absent.
  4. If i > 0:
     a. Compute SHA-256 of L[i-1]'s raw line bytes (UTF-8, no trailing newline).
     b. Assert `hash_prev` of L[i] equals the computed hash.
     If mismatch: FAIL (line i, expected vs actual hash_prev).
  5. Verify `hash` field:
     a. Temporarily remove `hash` and `hash_prev` from the parsed JSON.
     b. Serialize the remaining object to compact JSON (serde_json default).
     c. Compute SHA-256 of the serialized bytes.
     d. Assert it matches the `hash` field.
     If mismatch: FAIL (line i, "event hash mismatch").
Report total events and "chain valid" on success.
```

**IMPORTANT**: Step 5 (event hash verification) must replicate the exact
serialization behavior used by `AuditWriter::write_event()` in the engine.
Looking at the engine code:

1. `hash` and `hash_prev` are set to `None` (via `take()`)
2. `serde_json::to_string(&event)` serializes the event struct
3. SHA-256 of those bytes = `hash`
4. `hash_prev` and `hash` are restored
5. The complete event is serialized as the JSONL line
6. SHA-256 of the complete JSONL line bytes = next event's `hash_prev`

For verification, the CLI must:
- Parse each line into an `AuditEvent` struct
- Null out `hash` and `hash_prev`
- Re-serialize with `serde_json::to_string`
- Compare the SHA-256 against the recorded `hash`

Since the CLI links `loopstorm-engine` directly, it has access to the
`AuditEvent` struct with the same `#[serde(skip_serializing_if = "Option::is_none")]`
attributes. This ensures serialization compatibility.

**Output (success, default)**:
```
OK: 47 events, chain valid
```

**Output (failure, default)**:
```
FAIL: chain break at line 23
  expected hash_prev: a1b2c3d4e5f6...
  actual hash_prev:   f6e5d4c3b2a1...
  (previous line hash does not match)
```

**Output (--json, success)**:
```json
{"valid":true,"events":47}
```

**Output (--json, failure)**:
```json
{"valid":false,"break_at_line":23,"expected":"a1b2c3d4e5f6...","actual":"f6e5d4c3b2a1...","error":"hash_prev mismatch"}
```

### 4.3 `loopstorm replay <audit_log>`

**Purpose**: Pretty-print audit log events with chain verification.

**Arguments**:

| Arg/Flag | Required | Description |
|---|---|---|
| `<audit_log>` | Yes | Path to JSONL audit log file |
| `--no-verify` | No | Skip hash chain verification (just display events) |
| `--json` | No | Output events as JSON array instead of pretty-print |

**Exit codes**:

| Code | Meaning |
|---|---|
| 0 | All events displayed (and chain valid, unless --no-verify) |
| 1 | Chain is broken (displays events up to break point) |
| 2 | File not found, I/O error, or malformed JSONL |

**Pretty-print format** (one event per block):
```
[1] 2026-03-15T00:00:00Z  run_started    run=abc123
    status: started

[2] 2026-03-15T00:00:01Z  policy_decision  run=abc123
    tool: file_read  decision: allow  rule: allow-reads  (1.2ms)

[3] 2026-03-15T00:00:02Z  policy_decision  run=abc123
    tool: http_get   decision: deny   rule: deny-ssrf
    reason: "cloud metadata access blocked"

[4] 2026-03-15T00:00:03Z  budget_exceeded  run=abc123
    dimension: cost_usd  current: 10.50  cap: 10.00

--- Chain: OK (4 events verified) ---
```

If chain is broken:
```
[1] ...
[2] ...
[3] ...
--- CHAIN BREAK at line 4 ---
    expected hash_prev: a1b2c3d4...
    actual hash_prev:   deadbeef...
    (1 remaining event not displayed)
```

---

## 5. E2E Case Study Test Architecture

### 5.1 Test Harness Design

All E2E tests live in `apps/cli/tests/e2e_case_studies.rs` (a single
integration test file). They use the same harness pattern established
by `apps/engine/tests/ipc_integration.rs`:

```rust
// Pseudocode — NOT implementation
#[tokio::test]
async fn case_study_ssrf_block() {
    // 1. Create EnforcementContext with SSRF-blocking policy
    let (ctx, dir) = make_context(SSRF_POLICY, "cs1");
    let socket_path = test_socket_path("cs1");
    let audit_path = dir.join("audit.jsonl");

    // 2. Start engine server with shutdown channel
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let ctx = Arc::new(Mutex::new(ctx));
    let server_handle = tokio::spawn(run_server_with_shutdown(...));

    // 3. Wait for socket, connect, send requests
    wait_for_socket(&socket_path).await;
    // ... send NDJSON requests ...

    // 4. Assert on DecisionResponse messages
    // 5. Shutdown engine
    shutdown_tx.send(()).unwrap();
    server_handle.await.unwrap();

    // 6. Assert on audit log contents
    // 7. Verify chain using the CLI's verify logic
}
```

**Helper functions**: Extract common helpers into a `helpers` module
within the test file (or a `tests/helpers/mod.rs` if needed). Key
helpers:

- `make_context(yaml, label)` -- create `EnforcementContext` in temp dir
- `test_socket_path(label)` -- unique socket path per test
- `start_server_with_shutdown(ctx, socket_path)` -- returns (handle, shutdown_tx)
- `send_request(stream, request_json)` -- send NDJSON + read response
- `read_audit_log(path)` -- read and parse all JSONL events
- `verify_chain(path)` -- run the chain verification algorithm

### 5.2 Case Study 1: SSRF Tool Call Blocked

**Checklist item**: "Case Study 1: SSRF tool call blocked by policy deny rule."

**Scenario**: An agent attempts to call `http_get` with the AWS metadata
endpoint URL (`http://169.254.169.254`). The policy has a deny rule that
matches this URL pattern. The engine denies the call.

**Policy** (`tests/fixtures/policies/ssrf-block.yaml`):
```yaml
schema_version: 1
name: "ssrf-block-test"
rules:
  - name: "deny-metadata-ssrf"
    action: deny
    tool: "http_get"
    conditions:
      - field: "args.url"
        operator: matches
        pattern: "http://169.254.*"
    reason: "SSRF: cloud metadata endpoint access blocked"

  - name: "deny-localhost-ssrf"
    action: deny
    tool: "http_get"
    conditions:
      - field: "args.url"
        operator: matches
        pattern: "http://127.0.0.*"
    reason: "SSRF: localhost access blocked"

  - name: "allow-http"
    action: allow
    tool_pattern: "http_*"

  - name: "allow-reads"
    action: allow
    tool_pattern: "*_read"

  - name: "deny-all"
    action: deny
    reason: "default deny"
```

**Test steps**:

1. Start engine with SSRF-blocking policy
2. Send request: `http_get` with `args.url = "http://169.254.169.254/latest/meta-data/"`
3. Assert response: `decision = "deny"`, `rule_id = "deny-metadata-ssrf"`
4. Send request: `http_get` with `args.url = "https://api.example.com/data"`
5. Assert response: `decision = "allow"`, `rule_id = "allow-http"`
6. Send request: `file_read` with no SSRF-related args
7. Assert response: `decision = "allow"`, `rule_id = "allow-reads"`
8. Shutdown engine
9. Read audit log: assert 3 `policy_decision` events
10. Verify chain: assert chain is valid

**What this proves**: Policy condition evaluation with `args.url`
dot-notation, glob matching on URL patterns, first-match-wins rule
ordering, deny with reason.

### 5.3 Case Study 2: Budget Kill (Runaway Cost)

**Checklist item**: "Case Study 2: Runaway cost stopped by budget hard cap
with safe partial output."

**Scenario**: An agent makes multiple tool calls, each with an estimated
cost. The budget hard cap is $0.50. After enough calls to exceed the
cap, the engine returns `kill`.

**Policy** (`tests/fixtures/policies/budget-kill.yaml`):
```yaml
schema_version: 1
name: "budget-kill-test"
rules:
  - name: "allow-all"
    action: allow

budget:
  cost_usd:
    soft: 0.30
    hard: 0.50
  call_count:
    hard: 100
```

**Test steps**:

1. Start engine with budget policy
2. Send 5 requests, each with `estimated_cost_usd = 0.10`
   - Requests 1--3: assert `decision = "allow"` (total: $0.10, $0.20, $0.30)
   - Request 4: assert `decision = "allow"` (total: $0.40, soft cap at $0.30 warning)
   - Request 5: assert `decision = "allow"` (total: $0.50, at hard cap boundary)
3. Send request 6 with `estimated_cost_usd = 0.10`
   - Assert `decision = "kill"`, `rule_id = "__builtin_budget_hard_cap"`
   - Assert reason contains "cost_usd"
4. Shutdown engine
5. Read audit log: assert `policy_decision` events for calls 1--5,
   at least one `budget_soft_cap_warning` event, and a `policy_decision`
   with `decision = "kill"` for call 6
6. Verify chain: assert chain is valid

**What this proves**: Multi-dimensional budget tracking, soft cap
warning, hard cap kill, per-run budget isolation.

**Note on "safe partial output"**: The kill decision means the agent
receives a kill signal and must stop. The "safe partial output" refers
to the fact that all tool calls before the kill were allowed and their
results are preserved. The audit log captures the full history including
the moment the budget was exceeded. This is the "safe partial output"
the checklist refers to: the run produced useful work up to the budget
limit, then stopped cleanly rather than crashing or producing corrupt
output.

### 5.4 Case Study 3: Loop Termination

**Checklist item**: "Case Study 3: Looping agent detected and terminated
after cooldown recovery fails."

**Scenario**: An agent makes repeated identical calls (same tool + same
args_hash). After hitting the threshold, it gets a cooldown. It
continues making the same call after cooldown. The engine kills the run.

**Policy** (`tests/fixtures/policies/loop-kill.yaml`):
```yaml
schema_version: 1
name: "loop-kill-test"
rules:
  - name: "allow-all"
    action: allow

loop_detection:
  enabled: true
  identical_call_window_seconds: 120
  identical_call_threshold: 3
  cooldown_ms: 100
```

**Test steps**:

1. Start engine with loop detection policy
2. Send request: `file_read` with `args_hash = "aaa...aaa"` (64 hex chars), seq=1
   - Assert `decision = "allow"`
3. Send request: same tool + same args_hash, seq=2
   - Assert `decision = "allow"`
4. Send request: same tool + same args_hash, seq=3
   - Assert `decision = "cooldown"`, `rule_id = "__builtin_loop_detection"`
   - Assert `cooldown_ms = 100`
   - Assert `cooldown_message` is present
5. Send request: same tool + same args_hash, seq=4 (agent did not change approach)
   - Assert `decision = "kill"`, `rule_id = "__builtin_loop_detection"`
   - Assert reason contains "after cooldown"
6. Shutdown engine
7. Read audit log: assert events show the progression allow -> allow -> cooldown -> kill
8. Verify chain: assert chain is valid

**What this proves**: Loop detection heuristic 1 (identical call
fingerprint), cooldown-then-kill escalation, cooldown_ms in response.

### 5.5 Case Study 4: Hash Chain Verification

**Checklist item**: "Case Study 4: Hash chain verified by replay CLI
(valid chain exits 0, modified chain exits 1)."

**Scenario**: Run a session that produces a valid audit log, then verify
it. Then tamper with the log and verify again.

**Test steps**:

1. Start engine with any valid policy (reuse SSRF policy)
2. Send 5 varied requests (different tools, different args) to produce
   a 5+ event audit log (plus system events)
3. Shutdown engine
4. **Valid chain test**: Call the CLI's `verify_chain()` function on the
   audit log. Assert it returns Ok with the correct event count.
5. **Tampered chain test**: Read the audit log into memory. Modify one
   byte in line 3 (e.g., change a character in the `tool` field). Write
   the modified log to a new file. Call `verify_chain()` on the modified
   file. Assert it returns an error indicating a break at line 3 or 4
   (line 4's `hash_prev` will not match the tampered line 3).
6. **Truncated chain test**: Write only the first 2 lines of the audit
   log to a new file. Call `verify_chain()`. Assert it returns Ok with
   2 events (truncation does not break the chain, it just has fewer events).
7. **Empty file test**: Call `verify_chain()` on an empty file. Assert
   it returns Ok with 0 events (an empty log is valid).

**What this proves**: The hash chain is tamper-evident, the verification
algorithm correctly detects modifications, and the CLI accurately
reports the break position.

---

## 6. File Structure

### 6.1 New and Modified Files

```
apps/cli/
  src/
    main.rs                    # MODIFIED: implement all three subcommands
    validate.rs                # NEW: validate command logic
    verify.rs                  # NEW: verify command logic (chain verification)
    replay.rs                  # NEW: replay command logic (pretty-print + verify)
    output.rs                  # NEW: shared output formatting (colored, JSON)
  tests/
    e2e_case_studies.rs        # NEW: 4 case study integration tests
  Cargo.toml                   # MODIFIED: add dev-dependencies if needed

tests/fixtures/policies/
  ssrf-block.yaml              # NEW: SSRF blocking policy for CS1
  budget-kill.yaml             # NEW: budget kill policy for CS2
  loop-kill.yaml               # NEW: loop termination policy for CS3
```

### 6.2 Shared Code Reuse from Engine Crate

The CLI links `loopstorm-engine` as a library dependency. It reuses:

| Engine type / function | CLI usage |
|---|---|
| `Policy::from_yaml()` | `validate` command |
| `Policy::from_yaml_str()` | Test helper |
| `AuditEvent` | `verify` and `replay` (deserialize JSONL lines) |
| `POLICY_SCHEMA_HASH` | `validate` output and `version` output |
| `sha2::Sha256` (workspace dep) | Chain verification |
| `EnforcementContext` | E2E test setup |
| `server::run_server_with_shutdown()` | E2E test harness |

The CLI does NOT reuse `AuditWriter` (that is the engine's write path).
The CLI only reads and verifies audit logs.

### 6.3 No New Engine Code Required

The engine crate already has all the public types and functions needed.
No changes to the engine crate are required for P2. If a type or
function needs to be made `pub` that is currently `pub(crate)`, note
it here and the implementor should make the minimal visibility change.

**Potential visibility change needed**: The `sha256_hex()` function in
`audit.rs` is currently a private free function. The CLI needs the same
SHA-256 hex computation. Options:

- **Option A (preferred)**: Use `sha2` and `hex` crates directly in
  the CLI (they are already workspace dependencies). Reimplement the
  trivial 3-line function:
  ```rust
  fn sha256_hex(data: &[u8]) -> String {
      let mut hasher = sha2::Sha256::new();
      hasher.update(data);
      hex::encode(hasher.finalize())
  }
  ```

- **Option B**: Make `audit::sha256_hex` public in the engine crate and
  call it from the CLI.

**Decision**: Option A. The function is trivial and duplicating it
avoids changing the engine's public API surface for a utility function.
The implementation is 3 lines and uses workspace deps that the CLI
already has.

---

## 7. Implementation Guidance

### 7.1 Module Structure in `apps/cli/src/`

```
main.rs         -- clap CLI definition, subcommand dispatch
validate.rs     -- pub fn run_validate(path, quiet, json) -> ExitCode
verify.rs       -- pub fn run_verify(path, quiet, json) -> ExitCode
                   pub fn verify_chain(path) -> Result<VerifyResult, VerifyError>
replay.rs       -- pub fn run_replay(path, no_verify, json) -> ExitCode
output.rs       -- colored/JSON output helpers
```

The `verify_chain()` function is separated from `run_verify()` so that:
- `run_verify()` calls `verify_chain()` and formats output
- `run_replay()` calls `verify_chain()` and formats output differently
- E2E tests call `verify_chain()` directly

### 7.2 Updated clap Structure

Replace the existing scaffold in `main.rs` with:

```rust
#[derive(Subcommand)]
enum Commands {
    /// Validate a policy YAML file
    Validate {
        #[arg(help = "Path to policy YAML file")]
        policy: PathBuf,
        #[arg(long, short, help = "Suppress detailed output")]
        quiet: bool,
        #[arg(long, help = "Output as JSON")]
        json: bool,
    },
    /// Verify hash chain integrity of a JSONL audit log
    Verify {
        #[arg(help = "Path to JSONL audit log file")]
        audit_log: PathBuf,
        #[arg(long, short, help = "Suppress detailed output")]
        quiet: bool,
        #[arg(long, help = "Output as JSON")]
        json: bool,
    },
    /// Replay and display audit log events
    Replay {
        #[arg(help = "Path to JSONL audit log file")]
        audit_log: PathBuf,
        #[arg(long, help = "Skip hash chain verification")]
        no_verify: bool,
        #[arg(long, help = "Output as JSON array")]
        json: bool,
    },
    /// Print version and embedded policy schema hash
    Version,
}
```

### 7.3 Chain Verification Result Type

```rust
pub struct VerifyResult {
    pub valid: bool,
    pub event_count: usize,
    pub break_at_line: Option<usize>,    // 1-indexed for human display
    pub expected_hash: Option<String>,
    pub actual_hash: Option<String>,
    pub error: Option<String>,
}
```

### 7.4 E2E Test Helper Pattern

The E2E tests should extract helpers into a module at the top of the
test file. These helpers are the same pattern as `ipc_integration.rs`
but with additions for audit log reading and chain verification:

```rust
// E2E test helpers (at top of e2e_case_studies.rs)

fn make_context(yaml: &str, label: &str) -> (EnforcementContext, PathBuf) { ... }
fn test_socket_path(label: &str) -> PathBuf { ... }
async fn start_server_with_shutdown(ctx, socket_path) -> (JoinHandle, Sender) { ... }
async fn wait_for_socket(path) { ... }
fn request_json(tool, run_id, seq) -> String { ... }
fn request_json_with_args(tool, run_id, seq, args) -> String { ... }
fn request_json_with_cost(tool, run_id, seq, cost_usd) -> String { ... }
async fn send_and_recv(stream, request) -> serde_json::Value { ... }
fn read_audit_events(path) -> Vec<serde_json::Value> { ... }
```

### 7.5 Colored Output

The `colored` crate (already in Cargo.toml) provides terminal coloring.
Use it for `replay` output:

- Event type: blue
- Decision allow: green
- Decision deny/kill: red
- Decision cooldown: yellow
- Chain status: green (OK) or red (FAIL)
- Timestamps: dim/gray

The `--json` flag suppresses all coloring and outputs machine-readable JSON.

### 7.6 Exit Code Constants

Define exit code constants in a shared location:

```rust
pub const EXIT_OK: u8 = 0;
pub const EXIT_FAIL: u8 = 1;
pub const EXIT_IO_ERROR: u8 = 2;
```

---

## 8. Acceptance Criteria / Definition of Done

### 8.1 CLI Commands

- [ ] `loopstorm validate policy.yaml` exits 0 for valid policies, 1 for
      invalid, 2 for I/O errors.
- [ ] `loopstorm validate --json` outputs JSON result.
- [ ] `loopstorm validate` prints policy summary (name, rules, budget, loop
      detection, schema hash).
- [ ] `loopstorm verify audit.jsonl` exits 0 for valid chains, 1 for broken
      chains, 2 for I/O errors.
- [ ] `loopstorm verify` reports exact break position on failure.
- [ ] `loopstorm verify --json` outputs JSON result.
- [ ] `loopstorm replay audit.jsonl` pretty-prints events with chain verification.
- [ ] `loopstorm replay --no-verify` skips chain verification.
- [ ] `loopstorm replay --json` outputs events as JSON array.
- [ ] `loopstorm version` prints version + embedded policy schema hash.

### 8.2 E2E Case Study Tests

- [ ] CS1: SSRF `http_get` to `169.254.*` is denied by policy; safe URLs are allowed.
- [ ] CS2: Budget hard cap ($0.50) kills run after cumulative cost exceeds cap;
      calls before the cap are allowed; audit log captures soft cap warning.
- [ ] CS3: Identical call loop triggers cooldown at threshold; continued identical
      calls after cooldown trigger kill.
- [ ] CS4: Valid audit log chain verifies (exit 0); tampered log chain fails
      verification with correct break position (exit 1).

### 8.3 Quality

- [ ] All new `.rs` files have `// SPDX-License-Identifier: MIT` header.
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` passes.
- [ ] `cargo fmt --all -- --check` passes.
- [ ] `cargo test --workspace` passes (all existing + new tests).
- [ ] No changes to engine crate public API (if any visibility changes are needed,
      document them in the PR description).

### 8.4 OSS Release Checklist Items Satisfied

After this PR, the following checklist items are satisfiable:

- [x] 6.1: `loopstorm replay <file>` verifies hash chain (exit 0/1)
- [x] 6.2: `loopstorm verify <file>` reports chain break position
- [x] 7.1: Case Study 1: SSRF block
- [x] 7.2: Case Study 2: Budget kill
- [x] 7.3: Case Study 3: Loop termination
- [x] 7.4: Case Study 4: Hash chain verification

Items NOT addressed (deferred to P5):
- 6.3: `loopstorm filter` -- P5
- 6.4: `loopstorm import` -- P5

---

## 9. Sequencing Guidance

Recommended implementation order:

1. **verify.rs** -- implement `verify_chain()` and `run_verify()` first.
   This is the core algorithm that `replay` and the E2E tests depend on.
   Write unit tests for `verify_chain()` with hand-crafted JSONL strings.

2. **validate.rs** -- implement `run_validate()`. This is straightforward
   (calls `Policy::from_yaml()`). Write a unit test that validates the
   existing `examples/basic-policy.yaml`.

3. **replay.rs** -- implement `run_replay()` using `verify_chain()`.
   Add pretty-print formatting with `colored`.

4. **main.rs** -- wire up all subcommands with clap dispatch.

5. **E2E Case Study 4** (chain verification) -- this tests `verify_chain()`
   against a real engine-produced audit log. Implement this before CS1-3
   because it validates the chain verification algorithm against real
   engine output.

6. **E2E Case Study 1** (SSRF block) -- simplest scenario, one deny + two allows.

7. **E2E Case Study 2** (budget kill) -- requires multiple sequential calls.

8. **E2E Case Study 3** (loop termination) -- requires understanding of
   loop detector state management (same run_id, same args_hash across calls).

---

## 10. Test Fixture Policies

The three policy files for case studies should live in
`tests/fixtures/policies/` at the repo root (shared fixtures directory).
They are YAML files, not Rust code, and should be loaded by the tests
using `include_str!()` or `std::fs::read_to_string()`.

**Recommendation**: Use `include_str!()` with relative paths from the
test file, matching the pattern used in the engine's unit tests. Since
integration tests are compiled from the `apps/cli/` directory, use
paths relative to `CARGO_MANIFEST_DIR`:

```rust
const SSRF_POLICY: &str = include_str!("../../../tests/fixtures/policies/ssrf-block.yaml");
```

Alternatively, define the policies as `const &str` directly in the test
file (simpler, avoids path issues, and the policies are small). This is
the pattern used in `ipc_integration.rs` and is recommended for P2.

---

## 11. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| AuditEvent serialization in verify does not match engine's write path | Use the same `AuditEvent` struct from the engine crate for deserialization and re-serialization. The `skip_serializing_if` attributes ensure field-level compatibility. |
| E2E tests are flaky due to timing (socket not ready, shutdown races) | Use the same `wait_for_socket()` polling pattern from ipc_integration.rs. Use timeouts on all async operations. |
| Loop detection test depends on calls being "within the window" | The window is 120 seconds. Tests complete in <1 second. No timing risk. |
| Budget test depends on exact floating-point arithmetic | Use `0.10` increments and a `0.50` cap. IEEE 754 f64 represents these exactly (they are binary fractions: 0.5 = 2^-1, 0.1 is not exact but the budget check uses `>` not `>=`, so small rounding errors are absorbed). **CAUTION**: Verify in tests that the kill fires at the right time. If needed, use `0.125` increments ($0.125 * 4 = $0.50) which are exact in binary. |
| E2E tests require Unix (UDS) | Same constraint as existing ipc_integration.rs. Tests are `#[cfg(unix)]`. CI runs on ubuntu-22.04. |

---

## 12. References

- `apps/engine/tests/ipc_integration.rs` -- existing IPC test harness pattern
- `apps/engine/src/audit.rs` -- AuditWriter hash chain implementation
- `apps/engine/src/evaluator.rs` -- policy evaluation pipeline
- `apps/engine/src/budget.rs` -- budget tracking and cap checks
- `apps/engine/src/loop_detector.rs` -- loop detection heuristics
- `specs/ipc-wire-format.md` -- IPC protocol specification
- `docs/oss-release-checklist.md` -- Sections 6 and 7
- ADR-002: Fail-Closed Default
- ADR-005: JSONL Fail-Closed
- ADR-013: Open-Core Licensing
