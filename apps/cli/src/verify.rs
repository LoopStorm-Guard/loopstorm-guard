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
///   1. Parse as `serde_json::Value` to read `hash` and `hash_prev` values.
///   2. If i == 0: assert `hash_prev` was absent or null.
///   3. If i > 0: assert `hash_prev` == SHA-256 of L\[i-1\]'s raw bytes.
///   4. Reconstruct the payload by stripping `hash` and `hash_prev`
///      key-value pairs directly from the raw JSON string (avoiding
///      re-serialization that could alter float representations).
///   5. Compute SHA-256 of the payload, assert it equals the stored `hash`.
///
/// **Why raw-string stripping instead of Value round-trip?**
///
/// The engine computes event hashes by serializing a Rust struct with
/// `serde_json::to_string`. Floats (e.g. `latency_ms`) are formatted by
/// the Ryu algorithm, which may produce representations like
/// `0.022132000000000002`. Deserializing this into `serde_json::Value`
/// and re-serializing can produce a shorter form like `0.022132` due to
/// f64 parsing precision — the `Value` round-trip is NOT byte-identical
/// for all floats. By stripping the hash fields from the raw line bytes,
/// we reconstruct the exact payload the engine hashed.
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

        // 1. Parse as serde_json::Value (read-only) to extract hash and hash_prev
        let value: serde_json::Value =
            serde_json::from_str(line).map_err(|e| VerifyError::Json {
                line: line_num,
                source: e,
            })?;

        let obj = match value.as_object() {
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

        // Extract hash and hash_prev values (read-only — no mutation of the Value)
        let stored_hash = obj.get("hash").and_then(|v| v.as_str()).map(String::from);
        let stored_hash_prev = obj
            .get("hash_prev")
            .and_then(|v| v.as_str())
            .map(String::from);

        // 2/3. Verify hash_prev
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

        // 4/5. Verify hash: strip hash/hash_prev from the raw line, compute SHA-256
        let payload = strip_hash_fields(line, &stored_hash, &stored_hash_prev);
        let computed_hash = sha256_hex(payload.as_bytes());

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

/// Strip `"hash"` and `"hash_prev"` key-value pairs from a raw JSON line.
///
/// The engine computes event hashes by serializing the `AuditEvent` struct
/// with `hash` and `hash_prev` set to `None` (which `skip_serializing_if`
/// omits from the output). To reconstruct that exact payload for
/// verification, we remove these fields from the raw JSON line at the
/// string level — no deserialization/re-serialization needed.
///
/// This avoids the `serde_json::Value` round-trip that can alter float
/// representations (e.g. `0.022132000000000002` → `0.022132`).
///
/// Safety: hash values are 64-char lowercase hex strings (SHA-256).
/// The engine always serializes them as `,"hash":"<hex>"` (preceded by
/// a comma, since `hash` is never the first field in the struct).
/// False matches inside nested JSON (e.g. `args_redacted`) would require
/// an identical 64-char hex value, which is statistically impossible.
fn strip_hash_fields(line: &str, hash: &Option<String>, hash_prev: &Option<String>) -> String {
    let mut result = line.to_string();
    // Remove hash_prev first (it follows hash in struct field order),
    // then hash. Order doesn't affect correctness since the patterns
    // are non-overlapping.
    if let Some(hp) = hash_prev {
        let needle = format!(",\"hash_prev\":\"{}\"", hp);
        result = result.replacen(&needle, "", 1);
    }
    if let Some(h) = hash {
        let needle = format!(",\"hash\":\"{}\"", h);
        result = result.replacen(&needle, "", 1);
    }
    result
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
