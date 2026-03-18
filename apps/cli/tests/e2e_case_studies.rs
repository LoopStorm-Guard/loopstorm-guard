// SPDX-License-Identifier: MIT
//! End-to-end case study tests for LoopStorm Guard.
//!
//! These tests prove the full enforcement pipeline works end-to-end:
//! engine + IPC + policy + audit + verification.
//!
//! All tests are Unix-only (UDS is not available on Windows).
//!
//! Case Study 1: SSRF tool call blocked by policy deny rule
//! Case Study 2: Runaway cost stopped by budget hard cap
//! Case Study 3: Looping agent detected and terminated after cooldown
//! Case Study 4: Hash chain verified (valid exits 0, tampered exits 1)

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

use loopstorm_cli::verify::verify_chain;
use loopstorm_engine::policy::Policy;
use loopstorm_engine::server::run_server_with_shutdown;
use loopstorm_engine::{AuditWriter, BudgetTracker, EnforcementContext, LoopDetector, Redactor};

// ---------------------------------------------------------------------------
// Policies (inline, matching the YAML fixtures)
// ---------------------------------------------------------------------------

const SSRF_POLICY: &str = r#"
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
"#;

const BUDGET_POLICY: &str = r#"
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
"#;

const LOOP_POLICY: &str = r#"
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
"#;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// Create a temp directory unique per test.
fn temp_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ls_e2e_{}_{}", label, uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Build an EnforcementContext from a YAML string.
fn make_context(yaml: &str, label: &str) -> (EnforcementContext, PathBuf) {
    let dir = temp_dir(label);
    let audit_path = dir.join("audit.jsonl");
    let policy = Policy::from_yaml_str(yaml).expect("test policy should parse");
    let audit_writer = AuditWriter::new(&audit_path).unwrap();
    let redactor = Redactor::new(policy.policy.redaction.as_ref());
    let ctx = EnforcementContext {
        policy,
        budget_tracker: BudgetTracker::new(),
        loop_detector: LoopDetector::new(),
        audit_writer,
        redactor,
    };
    (ctx, dir)
}

/// Unique socket path per test.
fn test_socket_path(_label: &str) -> PathBuf {
    std::env::temp_dir().join(format!("ls_e2e_{}.sock", uuid::Uuid::new_v4()))
}

/// Wait until the socket file exists (up to 500ms).
async fn wait_for_socket(path: &Path) {
    for _ in 0..50 {
        if path.exists() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("socket file did not appear at {}", path.display());
}

/// Build a minimal DecisionRequest JSON (unique args_hash per seq).
fn request_json(tool: &str, run_id: &str, seq: u64) -> String {
    serde_json::json!({
        "schema_version": 1,
        "run_id": run_id,
        "seq": seq,
        "tool": tool,
        "args_hash": format!("{:0>64x}", seq),
        "ts": "2026-03-16T00:00:00Z"
    })
    .to_string()
}

/// Build a DecisionRequest JSON with args_redacted.
fn request_json_with_args(tool: &str, run_id: &str, seq: u64, args: serde_json::Value) -> String {
    serde_json::json!({
        "schema_version": 1,
        "run_id": run_id,
        "seq": seq,
        "tool": tool,
        "args_hash": format!("{:0>64x}", seq),
        "args_redacted": args,
        "ts": "2026-03-16T00:00:00Z"
    })
    .to_string()
}

/// Build a DecisionRequest JSON with estimated_cost_usd.
fn request_json_with_cost(tool: &str, run_id: &str, seq: u64, cost_usd: f64) -> String {
    serde_json::json!({
        "schema_version": 1,
        "run_id": run_id,
        "seq": seq,
        "tool": tool,
        "args_hash": format!("{:0>64x}", seq),
        "estimated_cost_usd": cost_usd,
        "ts": "2026-03-16T00:00:00Z"
    })
    .to_string()
}

/// Build a DecisionRequest JSON with a FIXED args_hash (for loop detection).
fn request_json_same_hash(tool: &str, run_id: &str, seq: u64) -> String {
    serde_json::json!({
        "schema_version": 1,
        "run_id": run_id,
        "seq": seq,
        "tool": tool,
        "args_hash": "a".repeat(64),
        "ts": "2026-03-16T00:00:00Z"
    })
    .to_string()
}

/// Send one NDJSON request and read one NDJSON response on a persistent connection.
async fn send_request(
    writer: &mut OwnedWriteHalf,
    reader: &mut BufReader<OwnedReadHalf>,
    request: &str,
) -> serde_json::Value {
    writer
        .write_all(format!("{}\n", request).as_bytes())
        .await
        .expect("write failed");
    writer.flush().await.expect("flush failed");

    let mut line = String::new();
    timeout(Duration::from_secs(5), reader.read_line(&mut line))
        .await
        .expect("read timed out")
        .expect("read error");

    serde_json::from_str(line.trim()).expect("response is not valid JSON")
}

/// Read all audit events from a JSONL file.
fn read_audit_events(path: &Path) -> Vec<serde_json::Value> {
    let content = std::fs::read_to_string(path).expect("audit log should exist");
    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("each line must be valid JSON"))
        .collect()
}

// ---------------------------------------------------------------------------
// Case Study 1: SSRF Tool Call Blocked
// ---------------------------------------------------------------------------

#[tokio::test]
async fn case_study_1_ssrf_block() {
    let (ctx, dir) = make_context(SSRF_POLICY, "cs1");
    let audit_path = dir.join("audit.jsonl");
    let socket_path = test_socket_path("cs1");

    let ctx = Arc::new(Mutex::new(ctx));
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let server_handle = {
        let ctx = Arc::clone(&ctx);
        let path = socket_path.clone();
        tokio::spawn(async move {
            let _ = run_server_with_shutdown(&path, ctx, async {
                let _ = shutdown_rx.await;
            })
            .await;
        })
    };

    wait_for_socket(&socket_path).await;

    let stream = UnixStream::connect(&socket_path).await.unwrap();
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);

    // Request 1: SSRF attempt — should be DENIED
    let req1 = request_json_with_args(
        "http_get",
        "run-ssrf",
        1,
        serde_json::json!({"url": "http://169.254.169.254"}),
    );
    let resp1 = send_request(&mut write, &mut reader, &req1).await;
    assert_eq!(
        resp1["decision"], "deny",
        "SSRF to 169.254.* must be denied"
    );
    assert_eq!(resp1["rule_id"], "deny-metadata-ssrf");

    // Request 2: Safe URL — should be ALLOWED by allow-http
    let req2 = request_json_with_args(
        "http_get",
        "run-ssrf",
        2,
        serde_json::json!({"url": "https://api.example.com"}),
    );
    let resp2 = send_request(&mut write, &mut reader, &req2).await;
    assert_eq!(resp2["decision"], "allow", "safe URL must be allowed");
    assert_eq!(resp2["rule_id"], "allow-http");

    // Request 3: file_read — should be ALLOWED by allow-reads
    let req3 = request_json("file_read", "run-ssrf", 3);
    let resp3 = send_request(&mut write, &mut reader, &req3).await;
    assert_eq!(resp3["decision"], "allow", "file_read must be allowed");
    assert_eq!(resp3["rule_id"], "allow-reads");

    // Shutdown
    drop(write);
    drop(reader);
    let _ = shutdown_tx.send(());
    timeout(Duration::from_secs(10), server_handle)
        .await
        .expect("server did not shut down in time")
        .expect("server task panicked");

    // Verify audit log
    let events = read_audit_events(&audit_path);
    let policy_events: Vec<_> = events
        .iter()
        .filter(|e| e["event_type"] == "policy_decision")
        .collect();
    assert_eq!(
        policy_events.len(),
        3,
        "should have 3 policy_decision events"
    );
    assert_eq!(policy_events[0]["decision"], "deny");
    assert_eq!(policy_events[1]["decision"], "allow");
    assert_eq!(policy_events[2]["decision"], "allow");

    // Verify chain integrity
    let result = verify_chain(&audit_path).unwrap();
    assert!(result.valid, "audit chain must be valid");
}

// ---------------------------------------------------------------------------
// Case Study 2: Budget Kill (Runaway Cost)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn case_study_2_budget_kill() {
    let (ctx, dir) = make_context(BUDGET_POLICY, "cs2");
    let audit_path = dir.join("audit.jsonl");
    let socket_path = test_socket_path("cs2");

    let ctx = Arc::new(Mutex::new(ctx));
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let server_handle = {
        let ctx = Arc::clone(&ctx);
        let path = socket_path.clone();
        tokio::spawn(async move {
            let _ = run_server_with_shutdown(&path, ctx, async {
                let _ = shutdown_rx.await;
            })
            .await;
        })
    };

    wait_for_socket(&socket_path).await;

    let stream = UnixStream::connect(&socket_path).await.unwrap();
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);

    // Requests 1-5: each costs $0.10, all should be allowed
    // Cumulative: $0.10, $0.20, $0.30, $0.40, $0.50
    // Soft cap at $0.30 → warnings after calls 4 and 5
    // Hard cap at $0.50 → NOT exceeded yet (0.50 is not > 0.50)
    for seq in 1..=5_u64 {
        let req = request_json_with_cost("api_call", "run-budget", seq, 0.10);
        let resp = send_request(&mut write, &mut reader, &req).await;
        assert_eq!(
            resp["decision"],
            "allow",
            "call {} (total ${:.2}) should be allowed",
            seq,
            seq as f64 * 0.10
        );
    }

    // Request 6: $0.10 more → total $0.60 > hard cap $0.50 → KILL
    let req6 = request_json_with_cost("api_call", "run-budget", 6, 0.10);
    let resp6 = send_request(&mut write, &mut reader, &req6).await;
    assert_eq!(
        resp6["decision"], "kill",
        "call 6 must be killed (budget hard cap exceeded)"
    );
    assert_eq!(resp6["rule_id"], "__builtin_budget_hard_cap");
    assert!(
        resp6["reason"].as_str().unwrap_or("").contains("cost_usd"),
        "kill reason should mention cost_usd"
    );

    // Shutdown
    drop(write);
    drop(reader);
    let _ = shutdown_tx.send(());
    timeout(Duration::from_secs(10), server_handle)
        .await
        .expect("server did not shut down in time")
        .expect("server task panicked");

    // Verify audit log
    let events = read_audit_events(&audit_path);

    // Should have 6 policy_decision events (5 allow + 1 kill)
    let policy_events: Vec<_> = events
        .iter()
        .filter(|e| e["event_type"] == "policy_decision")
        .collect();
    assert_eq!(
        policy_events.len(),
        6,
        "should have 6 policy_decision events"
    );

    // Last policy_decision should be kill
    assert_eq!(policy_events[5]["decision"], "kill");

    // Should have at least one budget_soft_cap_warning
    let warnings: Vec<_> = events
        .iter()
        .filter(|e| e["event_type"] == "budget_soft_cap_warning")
        .collect();
    assert!(
        !warnings.is_empty(),
        "should have at least one budget soft cap warning"
    );

    // Debug: dump all events for diagnostics
    for (i, e) in events.iter().enumerate() {
        eprintln!(
            "CS2 event {}: type={}, decision={}, hash_prev_present={}",
            i,
            e["event_type"],
            e.get("decision").unwrap_or(&serde_json::Value::Null),
            e.get("hash_prev").is_some() && !e["hash_prev"].is_null(),
        );
    }

    // Verify chain integrity
    let result = verify_chain(&audit_path).unwrap();
    if !result.valid {
        // Extra diagnostics: read raw lines and check hashes
        let raw_content = std::fs::read_to_string(&audit_path).unwrap();
        let raw_lines: Vec<&str> = raw_content.lines().filter(|l| !l.trim().is_empty()).collect();
        eprintln!("CS2 total raw lines: {}", raw_lines.len());
        if let Some(break_line) = result.break_at_line {
            let idx = break_line - 1; // 0-indexed
            eprintln!("CS2 break at line {} (0-idx {})", break_line, idx);
            if idx < raw_lines.len() {
                eprintln!("CS2 failing line (first 200 chars): {}", &raw_lines[idx][..raw_lines[idx].len().min(200)]);
            }
            if idx > 0 && idx - 1 < raw_lines.len() {
                let prev_hash = loopstorm_cli::output::sha256_hex(raw_lines[idx - 1].as_bytes());
                eprintln!("CS2 sha256(prev_line): {}", prev_hash);
            }
            eprintln!("CS2 error: {:?}", result.error);
            eprintln!("CS2 expected_hash: {:?}", result.expected_hash);
            eprintln!("CS2 actual_hash: {:?}", result.actual_hash);
        }
    }
    assert!(
        result.valid,
        "audit chain must be valid: break_at_line={:?}, error={:?}, expected={:?}, actual={:?}",
        result.break_at_line,
        result.error,
        result.expected_hash,
        result.actual_hash,
    );
}

// ---------------------------------------------------------------------------
// Case Study 3: Loop Termination
// ---------------------------------------------------------------------------

#[tokio::test]
async fn case_study_3_loop_termination() {
    let (ctx, dir) = make_context(LOOP_POLICY, "cs3");
    let audit_path = dir.join("audit.jsonl");
    let socket_path = test_socket_path("cs3");

    let ctx = Arc::new(Mutex::new(ctx));
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let server_handle = {
        let ctx = Arc::clone(&ctx);
        let path = socket_path.clone();
        tokio::spawn(async move {
            let _ = run_server_with_shutdown(&path, ctx, async {
                let _ = shutdown_rx.await;
            })
            .await;
        })
    };

    wait_for_socket(&socket_path).await;

    let stream = UnixStream::connect(&socket_path).await.unwrap();
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);

    // All 4 requests use the SAME tool + args_hash (identical fingerprint).
    // Threshold=3, so: allow, allow, cooldown, kill.

    // Call 1: identical fingerprint, count=1 → allow
    let req1 = request_json_same_hash("file_read", "run-loop", 1);
    let resp1 = send_request(&mut write, &mut reader, &req1).await;
    assert_eq!(resp1["decision"], "allow", "call 1 should be allowed");

    // Call 2: identical fingerprint, count=2 → allow
    let req2 = request_json_same_hash("file_read", "run-loop", 2);
    let resp2 = send_request(&mut write, &mut reader, &req2).await;
    assert_eq!(resp2["decision"], "allow", "call 2 should be allowed");

    // Call 3: identical fingerprint, count=3 → cooldown (threshold hit)
    let req3 = request_json_same_hash("file_read", "run-loop", 3);
    let resp3 = send_request(&mut write, &mut reader, &req3).await;
    assert_eq!(
        resp3["decision"], "cooldown",
        "call 3 should trigger cooldown"
    );
    assert_eq!(resp3["rule_id"], "__builtin_loop_detection");
    assert_eq!(resp3["cooldown_ms"], 100, "cooldown_ms should be 100");
    assert!(
        resp3["cooldown_message"].as_str().is_some(),
        "cooldown_message should be present"
    );

    // Call 4: identical fingerprint after cooldown → kill
    let req4 = request_json_same_hash("file_read", "run-loop", 4);
    let resp4 = send_request(&mut write, &mut reader, &req4).await;
    assert_eq!(
        resp4["decision"], "kill",
        "call 4 should kill (loop after cooldown)"
    );
    assert_eq!(resp4["rule_id"], "__builtin_loop_detection");
    assert!(
        resp4["reason"]
            .as_str()
            .unwrap_or("")
            .contains("after cooldown"),
        "kill reason should mention 'after cooldown'"
    );

    // Shutdown
    drop(write);
    drop(reader);
    let _ = shutdown_tx.send(());
    timeout(Duration::from_secs(10), server_handle)
        .await
        .expect("server did not shut down in time")
        .expect("server task panicked");

    // Verify audit log progression: allow → allow → cooldown → kill
    let events = read_audit_events(&audit_path);
    let policy_events: Vec<_> = events
        .iter()
        .filter(|e| e["event_type"] == "policy_decision")
        .collect();
    assert_eq!(
        policy_events.len(),
        4,
        "should have 4 policy_decision events"
    );
    assert_eq!(policy_events[0]["decision"], "allow");
    assert_eq!(policy_events[1]["decision"], "allow");
    assert_eq!(policy_events[2]["decision"], "cooldown");
    assert_eq!(policy_events[3]["decision"], "kill");

    // Verify chain integrity
    let result = verify_chain(&audit_path).unwrap();
    assert!(result.valid, "audit chain must be valid");
}

// ---------------------------------------------------------------------------
// Case Study 4: Hash Chain Verification
// ---------------------------------------------------------------------------

#[tokio::test]
async fn case_study_4_hash_chain_verification() {
    let (ctx, dir) = make_context(SSRF_POLICY, "cs4");
    let audit_path = dir.join("audit.jsonl");
    let socket_path = test_socket_path("cs4");

    let ctx = Arc::new(Mutex::new(ctx));
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let server_handle = {
        let ctx = Arc::clone(&ctx);
        let path = socket_path.clone();
        tokio::spawn(async move {
            let _ = run_server_with_shutdown(&path, ctx, async {
                let _ = shutdown_rx.await;
            })
            .await;
        })
    };

    wait_for_socket(&socket_path).await;

    let stream = UnixStream::connect(&socket_path).await.unwrap();
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);

    // Send 5 varied requests to build a multi-event audit log
    let tools = [
        "file_read",
        "file_write",
        "file_read",
        "http_get",
        "file_read",
    ];
    for (i, tool) in tools.iter().enumerate() {
        let seq = (i + 1) as u64;
        let req = request_json(tool, "run-cs4", seq);
        let _ = send_request(&mut write, &mut reader, &req).await;
    }

    // Shutdown
    drop(write);
    drop(reader);
    let _ = shutdown_tx.send(());
    timeout(Duration::from_secs(10), server_handle)
        .await
        .expect("server did not shut down in time")
        .expect("server task panicked");

    // -- Part 1: Valid chain verifies --
    let result = verify_chain(&audit_path).unwrap();
    assert!(result.valid, "valid chain must verify");
    // 5 requests + engine_started + engine_stopped = 7 events minimum
    assert!(
        result.event_count >= 7,
        "should have at least 7 events, got {}",
        result.event_count
    );

    // -- Part 2: Tampered chain fails --
    let content = std::fs::read_to_string(&audit_path).unwrap();
    let lines: Vec<&str> = content.lines().collect();
    assert!(lines.len() >= 4, "need at least 4 lines for tamper test");

    // Tamper line 3 (0-indexed 2): change "run-cs4" to "run-XXXX"
    let mut tampered_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
    tampered_lines[2] = tampered_lines[2].replacen("run-cs4", "run-XXXX", 1);
    assert_ne!(
        tampered_lines[2], lines[2],
        "tampered line should differ from original"
    );

    let tampered_path = dir.join("tampered.jsonl");
    std::fs::write(&tampered_path, tampered_lines.join("\n") + "\n").unwrap();

    let result = verify_chain(&tampered_path).unwrap();
    assert!(!result.valid, "tampered chain must fail verification");
    assert!(result.break_at_line.is_some());
    let break_line = result.break_at_line.unwrap();
    // Break could be at line 3 (hash mismatch) or line 4 (hash_prev mismatch)
    assert!(
        break_line == 3 || break_line == 4,
        "break should be at line 3 or 4, got {}",
        break_line
    );

    // -- Part 3: Truncated chain (first 2 lines) is valid --
    let truncated_path = dir.join("truncated.jsonl");
    let truncated_content = lines[..2].join("\n") + "\n";
    std::fs::write(&truncated_path, &truncated_content).unwrap();

    let result = verify_chain(&truncated_path).unwrap();
    assert!(result.valid, "truncated chain should be valid");
    assert_eq!(result.event_count, 2);

    // -- Part 4: Empty file is valid --
    let empty_path = dir.join("empty.jsonl");
    std::fs::write(&empty_path, "").unwrap();

    let result = verify_chain(&empty_path).unwrap();
    assert!(result.valid, "empty chain should be valid");
    assert_eq!(result.event_count, 0);
}
