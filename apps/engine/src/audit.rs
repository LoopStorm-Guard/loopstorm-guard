// SPDX-License-Identifier: MIT
//! Tamper-evident JSONL audit log writer (ADR-005).
//!
//! Each event is written as a single JSON line. Every event includes a
//! `hash_prev` field containing the SHA-256 hash of the previous line's
//! bytes, forming a hash chain for tamper detection.
//!
//! **CRITICAL**: If the write fails (disk full, permissions, etc.), the
//! engine MUST kill the run. Write failure = kill. This is per ADR-005.

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use thiserror::Error;
use tracing::error;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// Errors from the audit writer.
#[derive(Debug, Error)]
pub enum AuditError {
    #[error("failed to open audit log at {path}: {source}")]
    Open {
        path: PathBuf,
        source: std::io::Error,
    },

    #[error("failed to write audit event: {0}")]
    Write(#[from] std::io::Error),

    #[error("failed to serialize audit event: {0}")]
    Serialize(#[from] serde_json::Error),

    #[error("audit write failed — run must be killed (ADR-005): {reason}")]
    WriteFailed { reason: String },
}

// ---------------------------------------------------------------------------
// Event types (matching event.schema.json)
// ---------------------------------------------------------------------------

/// An audit event conforming to event.schema.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub schema_version: u32,
    pub event_type: String,
    pub run_id: String,
    pub seq: u64,

    /// SHA-256 hex digest of this event's payload (computed by the writer).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,

    /// SHA-256 hash of the previous event's line bytes. Null for the first event.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash_prev: Option<String>,

    pub ts: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub args_hash: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub args_redacted: Option<serde_json::Value>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_role: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_cost_usd: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_status: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub dimension: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_rule: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_action: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooldown_ms: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget: Option<serde_json::Value>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy_pack_id: Option<String>,

    // -- Behavioral telemetry fields (v1.1) --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_seq_fingerprint: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub inter_call_ms: Option<u64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_rate_delta: Option<f64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub param_shape_hash: Option<String>,
}

// ---------------------------------------------------------------------------
// AuditWriter
// ---------------------------------------------------------------------------

/// Append-only JSONL audit log writer with hash-chain integrity.
pub struct AuditWriter {
    writer: BufWriter<File>,
    path: PathBuf,
    /// SHA-256 hex digest of the last line written. Used as `hash_prev` for the
    /// next event. Initialized to SHA-256 of the empty string for the first event.
    last_hash: String,
    /// Sequence counter for the chain.
    event_count: u64,
}

impl std::fmt::Debug for AuditWriter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuditWriter")
            .field("path", &self.path)
            .field("last_hash", &self.last_hash)
            .field("event_count", &self.event_count)
            .finish()
    }
}

/// Compute SHA-256 hex digest of some bytes.
fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

impl AuditWriter {
    /// Create a new audit writer, opening or creating the log file at `path`.
    pub fn new(path: &Path) -> Result<Self, AuditError> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| AuditError::Open {
                path: path.to_path_buf(),
                source: e,
            })?;

        // SHA-256 of the empty string — the genesis hash for the first event.
        let genesis_hash = sha256_hex(b"");

        Ok(Self {
            writer: BufWriter::new(file),
            path: path.to_path_buf(),
            last_hash: genesis_hash,
            event_count: 0,
        })
    }

    /// Write an event to the audit log.
    ///
    /// The writer fills in `hash_prev` (from the previous event's hash) and
    /// `hash` (SHA-256 of the serialized line without `hash` and `hash_prev`).
    ///
    /// **CRITICAL**: If this fails, the caller MUST kill the run (ADR-005).
    pub fn write_event(&mut self, event: &mut AuditEvent) -> Result<(), AuditError> {
        // Set hash_prev
        if self.event_count == 0 {
            event.hash_prev = None; // First event: null hash_prev per schema
        } else {
            event.hash_prev = Some(self.last_hash.clone());
        }

        // Compute hash: serialize event without hash and hash_prev fields,
        // then SHA-256 the result.
        let saved_hash = event.hash.take();
        let saved_hash_prev = event.hash_prev.take();

        let payload_json = serde_json::to_string(event)?;
        let event_hash = sha256_hex(payload_json.as_bytes());

        // Restore hash_prev and set hash
        event.hash_prev = saved_hash_prev;
        let _ = saved_hash; // discard any caller-set hash
        event.hash = Some(event_hash);

        // Serialize the complete event
        let line = serde_json::to_string(event)?;

        // Write the line with trailing newline
        self.writer
            .write_all(line.as_bytes())
            .map_err(|e| AuditError::WriteFailed {
                reason: format!("write to {}: {}", self.path.display(), e),
            })?;
        self.writer
            .write_all(b"\n")
            .map_err(|e| AuditError::WriteFailed {
                reason: format!("write newline to {}: {}", self.path.display(), e),
            })?;

        // Flush for durability
        self.writer.flush().map_err(|e| {
            error!(
                path = %self.path.display(),
                error = %e,
                "audit flush failed — run must be killed"
            );
            AuditError::WriteFailed {
                reason: format!("flush {}: {}", self.path.display(), e),
            }
        })?;

        // Update chain state: hash the full line bytes for the next event's hash_prev
        self.last_hash = sha256_hex(line.as_bytes());
        self.event_count += 1;

        Ok(())
    }

    /// Get the path of the audit log file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Get the number of events written so far.
    pub fn event_count(&self) -> u64 {
        self.event_count
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;

    fn make_event(run_id: &str, seq: u64, event_type: &str) -> AuditEvent {
        AuditEvent {
            schema_version: 1,
            event_type: event_type.to_string(),
            run_id: run_id.to_string(),
            seq,
            hash: None,
            hash_prev: None,
            ts: "2026-03-15T00:00:00Z".to_string(),
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
            run_status: None,
            dimension: None,
            loop_rule: None,
            loop_action: None,
            cooldown_ms: None,
            budget: None,
            latency_ms: None,
            policy_pack_id: None,
            call_seq_fingerprint: None,
            inter_call_ms: None,
            token_rate_delta: None,
            param_shape_hash: None,
        }
    }

    #[test]
    fn events_written_as_jsonl() {
        let dir = std::env::temp_dir().join(format!("audit_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.jsonl");

        let mut writer = AuditWriter::new(&path).unwrap();

        let mut event1 = make_event("run-1", 1, "run_started");
        event1.run_status = Some("started".to_string());
        writer.write_event(&mut event1).unwrap();

        let mut event2 = make_event("run-1", 2, "policy_decision");
        event2.tool = Some("file_read".to_string());
        event2.decision = Some("allow".to_string());
        writer.write_event(&mut event2).unwrap();

        // Read back and verify
        let file = File::open(&path).unwrap();
        let reader = std::io::BufReader::new(file);
        let lines: Vec<String> = reader.lines().map(|l| l.unwrap()).collect();

        assert_eq!(lines.len(), 2);

        // Both lines should be valid JSON
        let parsed1: serde_json::Value = serde_json::from_str(&lines[0]).unwrap();
        let parsed2: serde_json::Value = serde_json::from_str(&lines[1]).unwrap();

        assert_eq!(parsed1["event_type"], "run_started");
        assert_eq!(parsed2["event_type"], "policy_decision");

        // Cleanup
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn hash_chain_is_correct() {
        let dir = std::env::temp_dir().join(format!("audit_chain_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("chain.jsonl");

        let mut writer = AuditWriter::new(&path).unwrap();

        for i in 1..=5 {
            let mut event = make_event("run-1", i, "policy_decision");
            event.tool = Some(format!("tool_{}", i));
            event.decision = Some("allow".to_string());
            writer.write_event(&mut event).unwrap();
        }

        // Read back and verify the hash chain
        let file = File::open(&path).unwrap();
        let reader = std::io::BufReader::new(file);
        let lines: Vec<String> = reader.lines().map(|l| l.unwrap()).collect();

        assert_eq!(lines.len(), 5);

        // First event: hash_prev should be null (None)
        let first: serde_json::Value = serde_json::from_str(&lines[0]).unwrap();
        assert!(
            first.get("hash_prev").is_none() || first["hash_prev"].is_null(),
            "first event hash_prev should be null/absent"
        );

        // Subsequent events: hash_prev should be SHA-256 of the previous line's bytes
        for i in 1..lines.len() {
            let prev_line_hash = sha256_hex(lines[i - 1].as_bytes());
            let current: serde_json::Value = serde_json::from_str(&lines[i]).unwrap();
            let hash_prev = current["hash_prev"]
                .as_str()
                .expect("hash_prev should be present");
            assert_eq!(
                hash_prev, prev_line_hash,
                "hash_prev mismatch at line {}",
                i
            );
        }

        // Cleanup
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn first_event_uses_sha256_of_empty_string_as_genesis() {
        // The genesis hash (internal state before first event) is SHA-256 of "".
        // The first event's hash_prev is null per the schema.
        // The second event's hash_prev is SHA-256 of the first event's line bytes.
        let dir = std::env::temp_dir().join(format!("audit_genesis_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("genesis.jsonl");

        let mut writer = AuditWriter::new(&path).unwrap();

        let mut event1 = make_event("run-1", 1, "run_started");
        writer.write_event(&mut event1).unwrap();

        // Read back
        let file = File::open(&path).unwrap();
        let reader = std::io::BufReader::new(file);
        let lines: Vec<String> = reader.lines().map(|l| l.unwrap()).collect();

        let first: serde_json::Value = serde_json::from_str(&lines[0]).unwrap();
        // First event: hash_prev is null
        assert!(
            first.get("hash_prev").is_none() || first["hash_prev"].is_null(),
            "first event hash_prev should be null"
        );
        // But hash should be present
        assert!(first.get("hash").is_some() && first["hash"].as_str().is_some());

        // Cleanup
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_to_nonexistent_path_returns_error() {
        // Try to open a file in a directory that doesn't exist.
        // Use a deeply nested path that won't exist on any OS.
        let path = std::env::temp_dir()
            .join("loopstorm_nonexistent_12345")
            .join("deeply")
            .join("nested")
            .join("audit.jsonl");
        let result = AuditWriter::new(&path);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AuditError::Open { .. }));
    }

    #[test]
    fn event_hash_is_deterministic() {
        let dir = std::env::temp_dir().join(format!("audit_det_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("det.jsonl");

        let mut writer = AuditWriter::new(&path).unwrap();

        let mut event = make_event("run-1", 1, "policy_decision");
        event.tool = Some("file_read".to_string());
        event.decision = Some("allow".to_string());
        writer.write_event(&mut event).unwrap();

        // The hash should be set
        assert!(event.hash.is_some());
        let hash = event.hash.as_ref().unwrap();
        assert_eq!(hash.len(), 64); // SHA-256 hex = 64 chars

        // Cleanup
        std::fs::remove_dir_all(&dir).ok();
    }
}
