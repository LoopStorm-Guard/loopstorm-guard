// SPDX-License-Identifier: MIT
//! Behavioral telemetry computation (v1.1).
//!
//! Computes four per-call fields on `policy_decision` events:
//! - `call_seq_fingerprint`: SHA-256 of last N (tool, args_hash) tuples
//! - `inter_call_ms`: milliseconds since previous DecisionRequest in this run
//! - `token_rate_delta`: ratio of this call's tokens to the run's rolling average
//! - `param_shape_hash`: SHA-256 of sorted top-level keys of args_redacted
//!
//! See `specs/behavioral-telemetry.md` for the normative specification.

use std::collections::VecDeque;
use std::time::Instant;

use sha2::{Digest, Sha256};

/// Rolling window size for `call_seq_fingerprint`. Compile-time constant.
const WINDOW_SIZE: usize = 5;

/// Per-run telemetry state. One instance per active `run_id`.
#[derive(Debug)]
pub struct TelemetryState {
    /// Ring buffer of (tool, args_hash) tuples, capacity WINDOW_SIZE.
    call_window: VecDeque<(String, String)>,
    /// Monotonic timestamp of the last DecisionRequest receipt.
    prev_request_instant: Option<Instant>,
    /// Cumulative token sum across all calls in this run.
    total_token_sum: u64,
    /// Count of calls that provided token data.
    token_call_count: u64,
}

/// Computed telemetry fields for a single call.
#[derive(Debug, Clone)]
pub struct TelemetryFields {
    pub call_seq_fingerprint: String,
    pub inter_call_ms: u64,
    pub token_rate_delta: Option<f64>,
    pub param_shape_hash: String,
}

impl Default for TelemetryState {
    fn default() -> Self {
        Self::new()
    }
}

impl TelemetryState {
    pub fn new() -> Self {
        Self {
            call_window: VecDeque::with_capacity(WINDOW_SIZE),
            prev_request_instant: None,
            total_token_sum: 0,
            token_call_count: 0,
        }
    }

    /// Compute all four telemetry fields for a single call.
    ///
    /// `now` is the monotonic instant of the current request receipt.
    pub fn compute(
        &mut self,
        tool: &str,
        args_hash: &str,
        args_redacted: Option<&serde_json::Value>,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
        now: Instant,
    ) -> TelemetryFields {
        // 1. call_seq_fingerprint
        self.call_window
            .push_back((tool.to_string(), args_hash.to_string()));
        if self.call_window.len() > WINDOW_SIZE {
            self.call_window.pop_front();
        }
        let call_seq_fingerprint = compute_call_seq_fingerprint(&self.call_window);

        // 2. inter_call_ms
        let inter_call_ms = match self.prev_request_instant {
            None => 0,
            Some(prev) => now.duration_since(prev).as_millis() as u64,
        };
        self.prev_request_instant = Some(now);

        // 3. token_rate_delta
        let has_token_data = input_tokens.is_some() || output_tokens.is_some();
        let token_rate_delta = if has_token_data {
            let call_tokens = input_tokens.unwrap_or(0) + output_tokens.unwrap_or(0);
            Some(self.compute_token_rate_delta(call_tokens))
        } else {
            None
        };

        // 4. param_shape_hash
        let param_shape_hash = compute_param_shape_hash(args_redacted);

        TelemetryFields {
            call_seq_fingerprint,
            inter_call_ms,
            token_rate_delta,
            param_shape_hash,
        }
    }

    fn compute_token_rate_delta(&mut self, call_tokens: u64) -> f64 {
        if self.total_token_sum == 0 && self.token_call_count == 0 {
            // First call with token data.
            self.total_token_sum = call_tokens;
            self.token_call_count = 1;
            return 1.0;
        }

        let rolling_avg = if self.token_call_count > 0 {
            self.total_token_sum as f64 / self.token_call_count as f64
        } else {
            0.0
        };

        let delta = if rolling_avg == 0.0 {
            if call_tokens == 0 {
                1.0
            } else {
                call_tokens as f64
            }
        } else {
            call_tokens as f64 / rolling_avg
        };

        // Update running totals AFTER computing delta.
        self.total_token_sum += call_tokens;
        self.token_call_count += 1;

        // Round to 6 decimal places.
        (delta * 1_000_000.0).round() / 1_000_000.0
    }
}

/// SHA-256 hex of the joined (tool:args_hash) entries in the window.
fn compute_call_seq_fingerprint(window: &VecDeque<(String, String)>) -> String {
    let parts: Vec<String> = window
        .iter()
        .map(|(tool, hash)| format!("{}:{}", tool, hash))
        .collect();
    let payload = parts.join("\n");
    sha256_hex(payload.as_bytes())
}

/// SHA-256 hex of sorted top-level keys of args_redacted.
pub fn compute_param_shape_hash(args_redacted: Option<&serde_json::Value>) -> String {
    match args_redacted {
        None => sha256_hex(b"null"),
        Some(serde_json::Value::Object(map)) => {
            let mut keys: Vec<&str> = map.keys().map(|k| k.as_str()).collect();
            keys.sort();
            let payload = keys.join("\n");
            sha256_hex(payload.as_bytes())
        }
        Some(serde_json::Value::Array(_)) => sha256_hex(b"array"),
        Some(serde_json::Value::String(_)) => sha256_hex(b"string"),
        Some(serde_json::Value::Number(_)) => sha256_hex(b"number"),
        Some(serde_json::Value::Bool(_)) => sha256_hex(b"boolean"),
        Some(serde_json::Value::Null) => sha256_hex(b"null"),
    }
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    // -----------------------------------------------------------------------
    // call_seq_fingerprint vectors (spec Section 8.1)
    // -----------------------------------------------------------------------

    #[test]
    fn csf_1_single_call() {
        let mut window = VecDeque::new();
        window.push_back((
            "file.read".to_string(),
            "abacd07d80a52db8cd8d4d149e15a032350e8a15c2c9feb81802c2d535a1f36a".to_string(),
        ));
        assert_eq!(
            compute_call_seq_fingerprint(&window),
            "800285a565cfe1737f89e6af8a6c3aa73b51616e30645230a97b3a99dbb93d55"
        );
    }

    #[test]
    fn csf_2_full_window() {
        let mut window = VecDeque::new();
        window.push_back(("file.read".into(), "a".repeat(64)));
        window.push_back(("file.write".into(), "b".repeat(64)));
        window.push_back(("http.get".into(), "c".repeat(64)));
        window.push_back(("db.query".into(), "d".repeat(64)));
        window.push_back(("file.read".into(), "e".repeat(64)));
        assert_eq!(
            compute_call_seq_fingerprint(&window),
            "fd6a411aa09d22bc4369a38669f66e8726de95b8e5f355682dd8d910347dac12"
        );
    }

    #[test]
    fn csf_3_repeated_identical_calls() {
        let mut window = VecDeque::new();
        for _ in 0..3 {
            window.push_back(("http.get".into(), "a".repeat(64)));
        }
        assert_eq!(
            compute_call_seq_fingerprint(&window),
            "9ade2fe092e79592862f3a725776e716444cfcd13a6177954ed6aa01df89bc15"
        );
    }

    #[test]
    fn csf_4_window_rollover() {
        let mut state = TelemetryState::new();
        let now = Instant::now();
        // Feed 6 calls; only calls 2-6 should be in window
        let tools = ["tool_a", "tool_b", "tool_c", "tool_d", "tool_e", "tool_f"];
        let hashes = ["a", "b", "c", "d", "e", "f"];
        for (i, (tool, h)) in tools.iter().zip(hashes.iter()).enumerate() {
            state.compute(
                tool,
                &h.repeat(64),
                None,
                None,
                None,
                now + Duration::from_millis(i as u64),
            );
        }
        // After 6 calls, window should have tool_b..tool_f
        let fingerprint = compute_call_seq_fingerprint(&state.call_window);
        assert_eq!(
            fingerprint,
            "316d12a5e7b007059f9cc0243ce704323f8f68bc898bcb710be2428428bbb2cb"
        );
    }

    // -----------------------------------------------------------------------
    // inter_call_ms vectors (spec Section 8.2)
    // -----------------------------------------------------------------------

    #[test]
    fn icm_1_first_call() {
        let mut state = TelemetryState::new();
        let now = Instant::now();
        let fields = state.compute("tool", &"a".repeat(64), None, None, None, now);
        assert_eq!(fields.inter_call_ms, 0);
    }

    #[test]
    fn icm_2_normal_gap() {
        let mut state = TelemetryState::new();
        let t0 = Instant::now();
        state.compute("tool", &"a".repeat(64), None, None, None, t0);
        let fields = state.compute(
            "tool",
            &"a".repeat(64),
            None,
            None,
            None,
            t0 + Duration::from_millis(1500),
        );
        assert_eq!(fields.inter_call_ms, 1500);
    }

    #[test]
    fn icm_3_sub_millisecond_gap() {
        let mut state = TelemetryState::new();
        let t0 = Instant::now();
        state.compute("tool", &"a".repeat(64), None, None, None, t0);
        // 700 microseconds = 0.7ms → floor to 0
        let fields = state.compute(
            "tool",
            &"a".repeat(64),
            None,
            None,
            None,
            t0 + Duration::from_micros(700),
        );
        assert_eq!(fields.inter_call_ms, 0);
    }

    #[test]
    fn icm_4_large_gap() {
        let mut state = TelemetryState::new();
        let t0 = Instant::now();
        state.compute("tool", &"a".repeat(64), None, None, None, t0);
        let fields = state.compute(
            "tool",
            &"a".repeat(64),
            None,
            None,
            None,
            t0 + Duration::from_millis(3_600_000),
        );
        assert_eq!(fields.inter_call_ms, 3_600_000);
    }

    // -----------------------------------------------------------------------
    // token_rate_delta vectors (spec Section 8.3)
    // -----------------------------------------------------------------------

    #[test]
    fn trd_1_first_call_baseline() {
        let mut state = TelemetryState::new();
        let now = Instant::now();
        let fields = state.compute("tool", &"a".repeat(64), None, Some(500), Some(100), now);
        assert_eq!(fields.token_rate_delta, Some(1.0));
        assert_eq!(state.total_token_sum, 600);
        assert_eq!(state.token_call_count, 1);
    }

    #[test]
    fn trd_2_steady_consumption() {
        let mut state = TelemetryState::new();
        state.total_token_sum = 3000;
        state.token_call_count = 3;
        let now = Instant::now();
        let fields = state.compute("tool", &"a".repeat(64), None, Some(800), Some(200), now);
        assert_eq!(fields.token_rate_delta, Some(1.0));
        assert_eq!(state.total_token_sum, 4000);
        assert_eq!(state.token_call_count, 4);
    }

    #[test]
    fn trd_3_consumption_spike() {
        let mut state = TelemetryState::new();
        state.total_token_sum = 3000;
        state.token_call_count = 3;
        let now = Instant::now();
        let fields = state.compute("tool", &"a".repeat(64), None, Some(4000), Some(1000), now);
        assert_eq!(fields.token_rate_delta, Some(5.0));
        assert_eq!(state.total_token_sum, 8000);
        assert_eq!(state.token_call_count, 4);
    }

    #[test]
    fn trd_4_consumption_drop() {
        let mut state = TelemetryState::new();
        state.total_token_sum = 10000;
        state.token_call_count = 5;
        let now = Instant::now();
        let fields = state.compute("tool", &"a".repeat(64), None, Some(100), Some(0), now);
        assert_eq!(fields.token_rate_delta, Some(0.05));
        assert_eq!(state.total_token_sum, 10100);
        assert_eq!(state.token_call_count, 6);
    }

    #[test]
    fn trd_5_zero_avg_nonzero_current() {
        let mut state = TelemetryState::new();
        state.total_token_sum = 0;
        state.token_call_count = 2;
        let now = Instant::now();
        let fields = state.compute("tool", &"a".repeat(64), None, Some(500), Some(0), now);
        assert_eq!(fields.token_rate_delta, Some(500.0));
        assert_eq!(state.total_token_sum, 500);
        assert_eq!(state.token_call_count, 3);
    }

    #[test]
    fn trd_6_no_token_data() {
        let mut state = TelemetryState::new();
        let now = Instant::now();
        let fields = state.compute("tool", &"a".repeat(64), None, None, None, now);
        assert_eq!(fields.token_rate_delta, None);
    }

    // -----------------------------------------------------------------------
    // param_shape_hash vectors (spec Section 8.4)
    // -----------------------------------------------------------------------

    #[test]
    fn psh_1_simple_flat_object() {
        let args = serde_json::json!({"url": "https://example.com", "method": "GET"});
        assert_eq!(
            compute_param_shape_hash(Some(&args)),
            "708ffd3968576d9f1cbfa90f8d2665a5400bc1714a73992d2b801b69eaea227d"
        );
    }

    #[test]
    fn psh_2_empty_object() {
        let args = serde_json::json!({});
        assert_eq!(
            compute_param_shape_hash(Some(&args)),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn psh_3_null_args() {
        assert_eq!(
            compute_param_shape_hash(None),
            "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
        );
    }

    #[test]
    fn psh_4_array_args() {
        let args = serde_json::json!([1, 2, 3]);
        assert_eq!(
            compute_param_shape_hash(Some(&args)),
            "dbe42cc09c16704aa3d60127c60b4e1646fc6da1d4764aa517de053e65a663d7"
        );
    }

    #[test]
    fn psh_5_many_keys_sorted() {
        let args = serde_json::json!({"z_last": 1, "a_first": 2, "m_middle": 3});
        assert_eq!(
            compute_param_shape_hash(Some(&args)),
            "a0d0b27977b9383f9990f55d0f6ff1f41d9ff6f7f1e5f1df01d905c219cabb68"
        );
    }

    #[test]
    fn psh_null_value() {
        // serde_json::Value::Null should hash as "null"
        let args = serde_json::Value::Null;
        assert_eq!(
            compute_param_shape_hash(Some(&args)),
            "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"
        );
    }

    // -----------------------------------------------------------------------
    // Integration: full compute() flow
    // -----------------------------------------------------------------------

    #[test]
    fn compute_produces_all_fields() {
        let mut state = TelemetryState::new();
        let now = Instant::now();
        let args = serde_json::json!({"path": "/tmp/test.txt"});
        let fields = state.compute(
            "file.read",
            &"a".repeat(64),
            Some(&args),
            Some(100),
            Some(50),
            now,
        );
        assert_eq!(fields.call_seq_fingerprint.len(), 64);
        assert_eq!(fields.inter_call_ms, 0); // first call
        assert_eq!(fields.token_rate_delta, Some(1.0)); // first call baseline
        assert_eq!(fields.param_shape_hash.len(), 64);
    }

    #[test]
    fn compute_without_tokens_omits_token_rate_delta() {
        let mut state = TelemetryState::new();
        let now = Instant::now();
        let fields = state.compute("file.read", &"a".repeat(64), None, None, None, now);
        assert!(fields.token_rate_delta.is_none());
    }
}
