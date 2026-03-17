// SPDX-License-Identifier: MIT
//! Async UDS IPC listener — accepts connections, reads NDJSON DecisionRequests,
//! calls enforce(), and writes NDJSON DecisionResponses.
//!
//! Protocol spec: specs/ipc-wire-format.md
//! Security: ADR-001 (IPC Wire Format), ADR-002 (Fail-Closed), ADR-005 (Audit)

use crate::decision::{Decision, DecisionResponse};

/// Maximum message size: 64 KiB (65 536 bytes), including the trailing newline.
/// See specs/ipc-wire-format.md §3.1.
pub const MAX_MESSAGE_BYTES: usize = 65_536;

// ---------------------------------------------------------------------------
// Cross-platform utilities (available on all targets)
// ---------------------------------------------------------------------------

/// Build a kill DecisionResponse for error cases.
///
/// This is `pub` so tests and the integration test harness can construct
/// expected kill responses for comparison.
pub fn kill_response(run_id: &str, seq: u64, rule_id: &str, reason: &str) -> DecisionResponse {
    DecisionResponse {
        schema_version: 1,
        run_id: run_id.to_string(),
        seq,
        decision: Decision::Kill,
        rule_id: Some(rule_id.to_string()),
        reason: Some(reason.to_string()),
        cooldown_ms: None,
        cooldown_message: None,
        approval_id: None,
        approval_timeout_ms: None,
        approval_timeout_action: None,
        budget_remaining: None,
        ts: chrono::Utc::now().to_rfc3339(),
    }
}

// ---------------------------------------------------------------------------
// Unix-only IPC server implementation
// ---------------------------------------------------------------------------

#[cfg(unix)]
mod unix_server {
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use std::sync::Arc;

    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::{UnixListener, UnixStream};
    use tokio::sync::{watch, Mutex};
    use tokio::time::{timeout, Duration};
    use tracing::{error, info, warn};

    use super::{kill_response, MAX_MESSAGE_BYTES};
    use crate::audit::AuditEvent;
    use crate::decision::{DecisionRequest, DecisionResponse};
    use crate::{enforce, EnforcementContext};

    /// Read timeout per connection: 30 seconds idle.
    /// See specs/ipc-wire-format.md §7.
    const READ_TIMEOUT: Duration = Duration::from_secs(30);

    /// Graceful-shutdown drain timeout: 5 seconds.
    /// See specs/ipc-wire-format.md §8.1.
    const SHUTDOWN_DRAIN_SECS: u64 = 5;

    // -------------------------------------------------------------------------
    // Public entry point
    // -------------------------------------------------------------------------

    /// Start the engine server and run until an OS shutdown signal is received.
    ///
    /// Installs a SIGTERM/SIGINT handler and delegates to
    /// `run_server_with_shutdown`.
    pub async fn run_server(
        socket_path: &Path,
        ctx: Arc<Mutex<EnforcementContext>>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let shutdown = wait_for_shutdown_signal();
        run_server_with_shutdown(socket_path, ctx, shutdown).await
    }

    /// Start the engine server and run until `shutdown_signal` resolves.
    ///
    /// Separated from `run_server` so tests can inject a custom shutdown future
    /// (e.g., a channel receiver) without sending OS signals to the process.
    ///
    /// - Creates and binds the Unix Domain Socket listener.
    /// - Sets socket file permissions to 0600.
    /// - Writes an `engine_started` system event to the audit log.
    /// - Enters the accept loop; each connection is handled in a separate task.
    /// - On shutdown: drains in-flight requests for up to 5 s, writes
    ///   `engine_stopped`, removes the socket file, returns.
    ///
    /// # Errors
    /// Returns an error if the socket cannot be bound.
    pub async fn run_server_with_shutdown<F>(
        socket_path: &Path,
        ctx: Arc<Mutex<EnforcementContext>>,
        shutdown_signal: F,
    ) -> Result<(), Box<dyn std::error::Error>>
    where
        F: std::future::Future<Output = ()> + Send,
    {
        // Bind the listener.
        let listener = UnixListener::bind(socket_path)?;

        // Set socket permissions to 0600 (owner read/write only).
        std::fs::set_permissions(socket_path, std::fs::Permissions::from_mode(0o600))?;

        info!(socket = %socket_path.display(), "engine listening");

        // Write engine_started system event.
        write_system_event(&ctx, "engine_started").await;

        // Shutdown channel: sender held here, receiver passed into the accept task.
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        // Spawn the accept loop in a task so we can await shutdown alongside it.
        let socket_path_owned = socket_path.to_path_buf();
        let ctx_accept = Arc::clone(&ctx);

        let accept_handle = tokio::spawn(async move {
            accept_loop(listener, ctx_accept, shutdown_rx).await;
        });

        // Wait for the shutdown signal.
        shutdown_signal.await;

        info!("shutdown signal received — stopping accept loop");

        // Signal all tasks to stop.
        let _ = shutdown_tx.send(true);

        // Wait for the accept loop to finish, up to SHUTDOWN_DRAIN_SECS.
        if timeout(Duration::from_secs(SHUTDOWN_DRAIN_SECS), accept_handle)
            .await
            .is_err()
        {
            warn!("drain timeout exceeded — forcing shutdown");
        }

        // Write engine_stopped system event before closing the audit writer.
        write_system_event(&ctx, "engine_stopped").await;

        // Remove the socket file.
        if let Err(e) = std::fs::remove_file(&socket_path_owned) {
            warn!(
                path = %socket_path_owned.display(),
                error = %e,
                "could not remove socket file"
            );
        }

        info!("engine stopped");
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Accept loop
    // -------------------------------------------------------------------------

    /// Accept connections and spawn a handler task for each.
    async fn accept_loop(
        listener: UnixListener,
        ctx: Arc<Mutex<EnforcementContext>>,
        mut shutdown_rx: watch::Receiver<bool>,
    ) {
        loop {
            tokio::select! {
                // Bias toward shutdown check so we don't accept after signalled.
                biased;

                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        info!("accept loop: shutdown signalled");
                        break;
                    }
                }
                result = listener.accept() => {
                    match result {
                        Ok((stream, _addr)) => {
                            let ctx = Arc::clone(&ctx);
                            tokio::spawn(async move {
                                handle_connection(stream, ctx).await;
                            });
                        }
                        Err(e) => {
                            error!(error = %e, "accept error");
                            // Brief yield before retrying to avoid busy-looping on error.
                            tokio::time::sleep(Duration::from_millis(10)).await;
                        }
                    }
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Connection handler
    // -------------------------------------------------------------------------

    /// Handle one UDS connection: read NDJSON requests in a loop, dispatch each
    /// to `enforce()`, and write NDJSON responses.
    ///
    /// Any error (parse, oversized, internal) results in a kill response and
    /// connection close (fail-closed per ADR-002).
    async fn handle_connection(stream: UnixStream, ctx: Arc<Mutex<EnforcementContext>>) {
        let (read_half, mut write_half) = stream.into_split();
        let mut reader = BufReader::new(read_half);

        loop {
            // Read up to MAX_MESSAGE_BYTES into a byte buffer, checking
            // for oversized messages ourselves.
            let line_bytes = match timeout(
                READ_TIMEOUT,
                read_line_limited(&mut reader, MAX_MESSAGE_BYTES),
            )
            .await
            {
                Err(_timeout) => {
                    // Read timeout — close connection silently (per spec §7).
                    return;
                }
                Ok(Err(e)) => {
                    error!(error = %e, "connection read error");
                    return;
                }
                Ok(Ok(ReadOutcome::Eof)) => {
                    // Client disconnected cleanly.
                    return;
                }
                Ok(Ok(ReadOutcome::TooLarge)) => {
                    // Message exceeds 64 KiB — kill + close.
                    let resp = kill_response(
                        "unknown",
                        0,
                        "__builtin_ipc_message_too_large",
                        "message exceeds 64 KiB limit",
                    );
                    let _ = write_response(&mut write_half, &resp).await;
                    return;
                }
                Ok(Ok(ReadOutcome::Line(bytes))) => bytes,
            };

            // Convert bytes to UTF-8.
            let line = match String::from_utf8(line_bytes) {
                Err(_) => {
                    let resp = kill_response(
                        "unknown",
                        0,
                        "__builtin_ipc_encoding_error",
                        "non-UTF-8 bytes in message",
                    );
                    let _ = write_response(&mut write_half, &resp).await;
                    return;
                }
                Ok(s) => s,
            };

            let trimmed = line.trim_end_matches('\n').trim_end_matches('\r');

            // Skip blank lines (defensive).
            if trimmed.is_empty() {
                continue;
            }

            // Deserialize DecisionRequest.
            let request: DecisionRequest = match serde_json::from_str(trimmed) {
                Ok(r) => r,
                Err(e) => {
                    warn!(error = %e, "malformed JSON in request");
                    let resp = kill_response(
                        "unknown",
                        0,
                        "__builtin_ipc_parse_error",
                        &format!("JSON parse error: {}", e),
                    );
                    let _ = write_response(&mut write_half, &resp).await;
                    return;
                }
            };

            // Validate schema_version.
            if request.schema_version != 1 {
                let resp = kill_response(
                    &request.run_id,
                    request.seq,
                    "__builtin_schema_version_unsupported",
                    &format!(
                        "unsupported schema_version: {} (only 1 is supported)",
                        request.schema_version
                    ),
                );
                let _ = write_response(&mut write_half, &resp).await;
                return;
            }

            // Call enforce() under the Tokio mutex.
            // Acquire, call enforce(), then drop the lock before writing the response
            // to minimise lock hold time (important under concurrent connections).
            let response = {
                let mut ctx_guard = ctx.lock().await;
                enforce(&request, &mut *ctx_guard)
            };

            if let Err(e) = write_response(&mut write_half, &response).await {
                error!(error = %e, "failed to write response — closing connection");
                return;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Line reader with size limit
    // -------------------------------------------------------------------------

    /// Outcome of reading one NDJSON line.
    enum ReadOutcome {
        Line(Vec<u8>),
        TooLarge,
        Eof,
    }

    /// Read bytes from `reader` until `\n` or `max_bytes` is exceeded.
    /// Returns the bytes including the `\n` if found.
    async fn read_line_limited<R>(
        reader: &mut BufReader<R>,
        max_bytes: usize,
    ) -> Result<ReadOutcome, std::io::Error>
    where
        R: tokio::io::AsyncRead + Unpin,
    {
        let mut accumulated: Vec<u8> = Vec::with_capacity(1024);

        loop {
            // Fill the BufReader's internal buffer and search for a newline.
            let available = {
                let buf = reader.fill_buf().await?;
                if buf.is_empty() {
                    return Ok(ReadOutcome::Eof);
                }
                buf.to_vec()
            };

            if let Some(pos) = available.iter().position(|&b| b == b'\n') {
                let consume_len = pos + 1;
                accumulated.extend_from_slice(&available[..consume_len]);
                reader.consume(consume_len);

                if accumulated.len() > max_bytes {
                    return Ok(ReadOutcome::TooLarge);
                }
                return Ok(ReadOutcome::Line(accumulated));
            } else {
                // No newline yet — consume all available bytes and loop.
                let take = available.len();
                accumulated.extend_from_slice(&available[..take]);
                reader.consume(take);

                if accumulated.len() > max_bytes {
                    return Ok(ReadOutcome::TooLarge);
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Response writer
    // -------------------------------------------------------------------------

    /// Serialize a DecisionResponse as NDJSON and write it to the stream.
    async fn write_response<W>(
        writer: &mut W,
        response: &DecisionResponse,
    ) -> Result<(), std::io::Error>
    where
        W: AsyncWriteExt + Unpin,
    {
        let mut json = serde_json::to_string(response)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        json.push('\n');
        writer.write_all(json.as_bytes()).await?;
        writer.flush().await?;
        Ok(())
    }

    // -------------------------------------------------------------------------
    // System event helpers
    // -------------------------------------------------------------------------

    /// Write a `system_event` audit entry with the given `run_status`.
    /// Best-effort: logs an error but does not panic on failure.
    async fn write_system_event(ctx: &Arc<Mutex<EnforcementContext>>, run_status: &str) {
        let mut ctx_guard = ctx.lock().await;
        let mut event = AuditEvent {
            schema_version: 1,
            event_type: "system_event".to_string(),
            run_id: "engine".to_string(),
            seq: 0,
            hash: None,
            hash_prev: None,
            ts: chrono::Utc::now().to_rfc3339(),
            tool: None,
            args_hash: None,
            args_redacted: None,
            decision: None,
            rule_id: None,
            reason: None,
            agent_name: None,
            agent_role: None,
            model: None,
            input_tokens: None,
            output_tokens: None,
            estimated_cost_usd: None,
            environment: None,
            run_status: Some(run_status.to_string()),
            dimension: None,
            loop_rule: None,
            loop_action: None,
            cooldown_ms: None,
            budget: None,
            latency_ms: None,
            policy_pack_id: None,
        };
        if let Err(e) = ctx_guard.audit_writer.write_event(&mut event) {
            error!(
                run_status = %run_status,
                error = %e,
                "failed to write system event to audit log"
            );
        }
    }

    // -------------------------------------------------------------------------
    // Signal handling
    // -------------------------------------------------------------------------

    /// Wait for SIGTERM or SIGINT.
    async fn wait_for_shutdown_signal() {
        use tokio::signal::unix::{signal, SignalKind};

        let mut sigterm =
            signal(SignalKind::terminate()).expect("failed to register SIGTERM handler");
        let mut sigint =
            signal(SignalKind::interrupt()).expect("failed to register SIGINT handler");

        tokio::select! {
            _ = sigterm.recv() => { info!("received SIGTERM"); }
            _ = sigint.recv() => { info!("received SIGINT"); }
        }
    }
}

// Re-export the Unix server's public entry points.
#[cfg(unix)]
pub use unix_server::{run_server, run_server_with_shutdown};

// ---------------------------------------------------------------------------
// Unit tests — cross-platform, no UDS required
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decision::{Decision, DecisionRequest};

    /// Build a minimal valid DecisionRequest JSON string.
    fn make_request_json(tool: &str, schema_version: u32, run_id: &str, seq: u64) -> String {
        serde_json::json!({
            "schema_version": schema_version,
            "run_id": run_id,
            "seq": seq,
            "tool": tool,
            "args_hash": "a".repeat(64),
            "ts": "2026-03-16T00:00:00Z"
        })
        .to_string()
    }

    #[test]
    fn test_ndjson_round_trip() {
        // Serialize a DecisionResponse and verify it produces valid NDJSON
        // (one JSON object per line, no embedded literal newlines).
        let resp = kill_response("run-1", 1, "test_rule", "test reason");
        let json = serde_json::to_string(&resp).unwrap();

        // Must be a single line — no literal newlines inside the JSON.
        assert!(
            !json.contains('\n'),
            "response JSON should not contain literal newlines"
        );

        // Must deserialize back correctly.
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["run_id"], "run-1");
        assert_eq!(parsed["seq"], 1);
        assert_eq!(parsed["decision"], "kill");
        assert_eq!(parsed["rule_id"], "test_rule");

        // Write as NDJSON (append newline) and verify exactly one newline.
        let ndjson = format!("{}\n", json);
        assert_eq!(
            ndjson.bytes().filter(|&b| b == b'\n').count(),
            1,
            "NDJSON line should have exactly one trailing newline"
        );
    }

    #[test]
    fn test_kill_response_fields() {
        let resp = kill_response("run-abc", 42, "__builtin_test", "some reason");
        assert_eq!(resp.decision, Decision::Kill);
        assert_eq!(resp.run_id, "run-abc");
        assert_eq!(resp.seq, 42);
        assert_eq!(resp.rule_id.as_deref(), Some("__builtin_test"));
        assert_eq!(resp.reason.as_deref(), Some("some reason"));
        assert_eq!(resp.schema_version, 1);
    }

    #[test]
    fn test_malformed_json_produces_kill() {
        // Simulate what the connection handler does with malformed JSON.
        let bad_input = "{ this is not valid json }";
        let parse_result = serde_json::from_str::<DecisionRequest>(bad_input);
        assert!(parse_result.is_err(), "malformed JSON must fail to parse");

        // The handler builds a kill response with the correct rule_id.
        let resp = kill_response("unknown", 0, "__builtin_ipc_parse_error", "test");
        assert_eq!(resp.decision, Decision::Kill);
        assert_eq!(resp.rule_id.as_deref(), Some("__builtin_ipc_parse_error"));
        assert_eq!(resp.run_id, "unknown");
        assert_eq!(resp.seq, 0);
    }

    #[test]
    fn test_unsupported_schema_version_kill() {
        // Valid JSON but schema_version != 1.
        let json = make_request_json("file_read", 99, "run-1", 1);
        let req: DecisionRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(req.schema_version, 99);

        // The handler builds a kill response with the version-unsupported rule_id.
        let resp = kill_response(
            &req.run_id,
            req.seq,
            "__builtin_schema_version_unsupported",
            "unsupported version",
        );
        assert_eq!(resp.decision, Decision::Kill);
        assert_eq!(
            resp.rule_id.as_deref(),
            Some("__builtin_schema_version_unsupported")
        );
        assert_eq!(resp.run_id, "run-1");
    }

    #[test]
    fn test_oversized_message_constant() {
        // Verify the limit constant is exactly 64 KiB.
        let one_kib: usize = 1024;
        assert_eq!(MAX_MESSAGE_BYTES, 64 * one_kib, "limit must be 64 KiB");
        assert_eq!(MAX_MESSAGE_BYTES, 65_536);
    }

    #[test]
    fn test_decision_request_deserializes_minimal() {
        // Minimal valid DecisionRequest — all optional fields absent.
        let json = make_request_json("my_tool", 1, "run-test", 5);
        let req: DecisionRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(req.schema_version, 1);
        assert_eq!(req.run_id, "run-test");
        assert_eq!(req.seq, 5);
        assert_eq!(req.tool, "my_tool");
    }

    #[test]
    fn test_decision_request_ignores_unknown_fields() {
        // Per spec §11: the engine MUST ignore unknown fields (forward compatibility).
        // serde's default behavior (no deny_unknown_fields) gives us this for free.
        let json = r#"{
            "schema_version": 1,
            "run_id": "run-1",
            "seq": 1,
            "tool": "file_read",
            "args_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "ts": "2026-03-16T00:00:00Z",
            "future_field": "some_value",
            "another_unknown": 42
        }"#;
        let result = serde_json::from_str::<DecisionRequest>(json);
        assert!(
            result.is_ok(),
            "unknown fields must be ignored: {:?}",
            result.err()
        );
    }
}
