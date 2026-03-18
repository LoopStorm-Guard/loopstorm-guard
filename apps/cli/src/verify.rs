// SPDX-License-Identifier: MIT
//! Hash chain verification for JSONL audit logs.
//!
//! The `verify_chain()` function reads a JSONL audit log, verifies the hash
//! chain integrity, and reports the first break position if the chain is
//! tampered. The algorithm mirrors the engine's `AuditWriter::write_event()`
//! hash computation.

use std::path::Path;

use crate::output::sha256_hex;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Result of verifying an audit log chain.
#[derive(Debug)]
pub struct VerifyResult {
    /// Whether the entire chain is valid.
    pub valid: bool,
    /// Number of events successfully verified.
    pub event_count: usize,
    /// 1-indexed line number of the first break (None if valid).
    pub break_at_line: Option<usize>,
    /// Expected hash at the break point.
    pub expected_hash: Option<String>,
    /// Actual hash found at the break point.
    pub actual_hash: Option<String>,
    /// Human-readable error description.
    pub error: Option<String>,
}

/// Errors that prevent verification from completing.
#[derive(Debug, thiserror::Error)]
pub enum VerifyError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("malformed JSON at line {line}: {source}")]
    Json {
        line: usize,
        source: serde_json::Error,
    },
}

// ---------------------------------------------------------------------------
// Core verification
// ---------------------------------------------------------------------------

/// Verify the hash chain integrity of a JSONL audit log file.
///
/// Algorithm (must match engine's `AuditWriter::write_event()`):
///
/// For each line L\[i\]:
///   1. Parse as `serde_json::Value` (preserving field order).
///   2. Extract and remove `hash` and `hash_prev` from the object.
///   3. If i == 0: assert `hash_prev` was absent or null.
///   4. If i > 0: assert `hash_prev` == SHA-256 of L\[i-1\]'s raw bytes.
///   5. Re-serialize the Value (without hash/hash_prev), compute SHA-256,
///      assert it equals the stored `hash`.
///
/// Uses `serde_json::Value` with `preserve_order` feature to avoid any
/// struct round-trip issues — the JSON field ordering is preserved exactly
/// as written by the engine.
pub fn verify_chain(path: &Path) -> Result<VerifyResult, VerifyError> {
    let content = std::fs::read_to_string(path)?;
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();

    if lines.is_empty() {
        return Ok(VerifyResult {
            valid: true,
            event_count: 0,
            break_at_line: None,
            expected_hash: None,
            actual_hash: None,
            error: None,
        });
    }

    for (i, line) in lines.iter().enumerate() {
        let line_num = i + 1; // 1-indexed for display

        // 1. Parse as serde_json::Value (preserve_order keeps field ordering)
        let mut value: serde_json::Value =
            serde_json::from_str(line).map_err(|e| VerifyError::Json {
                line: line_num,
                source: e,
            })?;

        let obj = match value.as_object_mut() {
            Some(m) => m,
            None => {
                return Ok(VerifyResult {
                    valid: false,
                    event_count: i,
                    break_at_line: Some(line_num),
                    expected_hash: None,
                    actual_hash: None,
                    error: Some("line is not a JSON object".to_string()),
                });
            }
        };

        // 2. Extract and remove hash and hash_prev
        let stored_hash = obj
            .remove("hash")
            .and_then(|v| v.as_str().map(String::from));
        let stored_hash_prev = obj
            .remove("hash_prev")
            .and_then(|v| v.as_str().map(String::from));

        // 3/4. Verify hash_prev
        if i == 0 {
            if stored_hash_prev.is_some() {
                return Ok(VerifyResult {
                    valid: false,
                    event_count: i,
                    break_at_line: Some(line_num),
                    expected_hash: None,
                    actual_hash: stored_hash_prev,
                    error: Some("first event should not have hash_prev".to_string()),
                });
            }
        } else {
            let expected = sha256_hex(lines[i - 1].as_bytes());
            match &stored_hash_prev {
                Some(hp) if *hp == expected => {} // OK
                _ => {
                    return Ok(VerifyResult {
                        valid: false,
                        event_count: i,
                        break_at_line: Some(line_num),
                        expected_hash: Some(expected),
                        actual_hash: stored_hash_prev,
                        error: Some("hash_prev mismatch".to_string()),
                    });
                }
            }
        }

        // 5. Verify hash: serialize Value without hash/hash_prev, compute SHA-256
        let payload_json =
            serde_json::to_string(&value).map_err(|e| VerifyError::Json {
                line: line_num,
                source: e,
            })?;
        let computed_hash = sha256_hex(payload_json.as_bytes());

        match &stored_hash {
            Some(h) if *h == computed_hash => {} // OK
            _ => {
                return Ok(VerifyResult {
                    valid: false,
                    event_count: i,
                    break_at_line: Some(line_num),
                    expected_hash: Some(computed_hash),
                    actual_hash: stored_hash,
                    error: Some("event hash mismatch".to_string()),
                });
            }
        }
    }

    Ok(VerifyResult {
        valid: true,
        event_count: lines.len(),
        break_at_line: None,
        expected_hash: None,
        actual_hash: None,
        error: None,
    })
}

// ---------------------------------------------------------------------------
// CLI command
// ---------------------------------------------------------------------------

/// Run the `verify` subcommand.
pub fn run_verify(path: &Path, quiet: bool, json: bool) -> u8 {
    use crate::output::{EXIT_FAIL, EXIT_IO_ERROR, EXIT_OK};
    use colored::Colorize;

    match verify_chain(path) {
        Ok(result) => {
            if json {
                if result.valid {
                    println!(
                        "{}",
                        serde_json::json!({
                            "valid": true,
                            "events": result.event_count
                        })
                    );
                } else {
                    println!(
                        "{}",
                        serde_json::json!({
                            "valid": false,
                            "break_at_line": result.break_at_line,
                            "expected": result.expected_hash,
                            "actual": result.actual_hash,
                            "error": result.error
                        })
                    );
                }
            } else if !quiet {
                if result.valid {
                    println!(
                        "{}: {} events, chain valid",
                        "OK".green().bold(),
                        result.event_count
                    );
                } else {
                    let line = result.break_at_line.unwrap_or(0);
                    println!("{}: chain break at line {}", "FAIL".red().bold(), line);
                    if let Some(ref expected) = result.expected_hash {
                        println!("  expected hash_prev: {}", expected);
                    }
                    if let Some(ref actual) = result.actual_hash {
                        println!("  actual hash_prev:   {}", actual);
                    }
                    if let Some(ref error) = result.error {
                        println!("  ({})", error);
                    }
                }
            }
            if result.valid {
                EXIT_OK
            } else {
                EXIT_FAIL
            }
        }
        Err(e) => {
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "valid": false,
                        "error": e.to_string()
                    })
                );
            } else if !quiet {
                eprintln!("{}: {}", "ERROR".red().bold(), e);
            }
            EXIT_IO_ERROR
        }
    }
}
