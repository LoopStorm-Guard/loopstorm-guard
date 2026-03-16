// SPDX-License-Identifier: MIT
//! Loop detector — identifies stuck agent behavior (ADR control philosophy Stage 2).
//!
//! Two heuristics detect non-progress:
//!
//! **Heuristic 1 — Identical Call Fingerprint**: If the same `(tool, args_hash)` pair
//! appears more than `max_identical_calls` times within a rolling window of
//! `window_seconds`, trigger loop detection.
//!
//! **Heuristic 2 — Identical Error Response**: If the same tool call produces
//! identical error responses without any intervening success, trigger loop detection.
//!
//! On first trigger: cooldown (agent gets one chance to self-correct).
//! On second trigger after cooldown: kill the run.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tracing::debug;

use crate::decision::DecisionRequest;
use crate::policy::LoopDetectionConfig;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Result of a loop detection check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LoopStatus {
    /// No loop detected.
    Ok,
    /// Loop detected — first trigger. Cooldown should be applied.
    CooldownWarning { reason: String },
    /// Loop detected after cooldown — kill the run.
    LoopDetected { reason: String },
}

/// A recorded call entry for the sliding window.
#[derive(Debug, Clone)]
struct CallEntry {
    tool: String,
    args_hash: String,
    timestamp: Instant,
}

/// State tracking for a single run.
#[derive(Debug)]
struct RunLoopState {
    /// Sliding window of recent calls (Heuristic 1).
    call_history: VecDeque<CallEntry>,
    /// Count of consecutive identical error responses per (tool, args_hash)
    /// key (Heuristic 2). Reset on any success for that key.
    error_streaks: HashMap<String, u64>,
    /// Whether we've already sent a cooldown warning for a particular
    /// fingerprint. On second trigger, we kill.
    cooldown_sent: HashMap<String, bool>,
}

impl RunLoopState {
    fn new() -> Self {
        Self {
            call_history: VecDeque::new(),
            error_streaks: HashMap::new(),
            cooldown_sent: HashMap::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// LoopDetector
// ---------------------------------------------------------------------------

/// Thread-safe loop detector for all runs.
#[derive(Debug, Clone)]
pub struct LoopDetector {
    states: Arc<RwLock<HashMap<String, RunLoopState>>>,
}

impl LoopDetector {
    /// Create a new loop detector.
    pub fn new() -> Self {
        Self {
            states: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Check a request against loop detection heuristics.
    ///
    /// This records the call in the history and evaluates both heuristics.
    pub fn check(&self, request: &DecisionRequest, config: &LoopDetectionConfig) -> LoopStatus {
        if !config.enabled {
            return LoopStatus::Ok;
        }

        let mut states = self.states.write().expect("loop detector lock poisoned");
        let state = states
            .entry(request.run_id.clone())
            .or_insert_with(RunLoopState::new);

        let now = Instant::now();
        let fingerprint = format!("{}:{}", request.tool, request.args_hash);

        // Record this call
        state.call_history.push_back(CallEntry {
            tool: request.tool.clone(),
            args_hash: request.args_hash.clone(),
            timestamp: now,
        });

        // Prune entries outside the window
        let window = Duration::from_secs(config.identical_call_window_seconds);
        while let Some(front) = state.call_history.front() {
            if now.duration_since(front.timestamp) > window {
                state.call_history.pop_front();
            } else {
                break;
            }
        }

        // Heuristic 1: Count identical calls in the window
        let identical_count = state
            .call_history
            .iter()
            .filter(|entry| entry.tool == request.tool && entry.args_hash == request.args_hash)
            .count() as u64;

        debug!(
            run_id = %request.run_id,
            fingerprint = %fingerprint,
            identical_count = identical_count,
            threshold = config.identical_call_threshold,
            "loop detection: identical call count in window"
        );

        if identical_count >= config.identical_call_threshold {
            let already_warned = state
                .cooldown_sent
                .get(&fingerprint)
                .copied()
                .unwrap_or(false);

            if already_warned {
                return LoopStatus::LoopDetected {
                    reason: format!(
                        "identical call fingerprint ({}) repeated {} times after cooldown — killing run",
                        fingerprint, identical_count
                    ),
                };
            } else {
                state.cooldown_sent.insert(fingerprint.clone(), true);
                return LoopStatus::CooldownWarning {
                    reason: format!(
                        "identical call fingerprint ({}) repeated {} times in {}s window",
                        fingerprint, identical_count, config.identical_call_window_seconds
                    ),
                };
            }
        }

        LoopStatus::Ok
    }

    /// Record an error response for Heuristic 2 (identical error streaks).
    ///
    /// Called after the tool call completes with an error. The caller provides
    /// the error hash to detect identical error responses.
    pub fn record_error(
        &self,
        run_id: &str,
        tool: &str,
        args_hash: &str,
        config: &LoopDetectionConfig,
    ) -> LoopStatus {
        if !config.enabled {
            return LoopStatus::Ok;
        }

        let mut states = self.states.write().expect("loop detector lock poisoned");
        let state = states
            .entry(run_id.to_string())
            .or_insert_with(RunLoopState::new);

        let fingerprint = format!("{}:{}", tool, args_hash);
        let count = state.error_streaks.entry(fingerprint.clone()).or_insert(0);
        *count += 1;

        if *count >= config.identical_error_threshold {
            let already_warned = state
                .cooldown_sent
                .get(&fingerprint)
                .copied()
                .unwrap_or(false);

            if already_warned {
                return LoopStatus::LoopDetected {
                    reason: format!(
                        "identical error response for ({}) repeated {} times after cooldown — killing run",
                        fingerprint, count
                    ),
                };
            } else {
                state.cooldown_sent.insert(fingerprint.clone(), true);
                return LoopStatus::CooldownWarning {
                    reason: format!(
                        "identical error response for ({}) repeated {} times without intervening success",
                        fingerprint, count
                    ),
                };
            }
        }

        LoopStatus::Ok
    }

    /// Record a successful response, resetting error streaks for the fingerprint.
    pub fn record_success(&self, run_id: &str, tool: &str, args_hash: &str) {
        let mut states = self.states.write().expect("loop detector lock poisoned");
        if let Some(state) = states.get_mut(run_id) {
            let fingerprint = format!("{}:{}", tool, args_hash);
            state.error_streaks.remove(&fingerprint);
        }
    }

    /// Reset all state for a run (e.g., when the run ends).
    pub fn reset(&self, run_id: &str) {
        let mut states = self.states.write().expect("loop detector lock poisoned");
        states.remove(run_id);
    }
}

impl Default for LoopDetector {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> LoopDetectionConfig {
        LoopDetectionConfig {
            enabled: true,
            identical_call_window_seconds: 120,
            identical_call_threshold: 3,
            identical_error_threshold: 3,
            cooldown_ms: 5000,
        }
    }

    fn make_request(run_id: &str, tool: &str, args_hash: &str) -> DecisionRequest {
        DecisionRequest {
            schema_version: 1,
            run_id: run_id.to_string(),
            seq: 1,
            tool: tool.to_string(),
            args_hash: args_hash.to_string(),
            args_redacted: None,
            agent_role: None,
            agent_name: None,
            model: None,
            input_tokens: None,
            output_tokens: None,
            estimated_cost_usd: None,
            environment: None,
            ts: "2026-03-15T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn normal_calls_dont_trigger() {
        let detector = LoopDetector::new();
        let config = default_config();

        // Different tools — no loop
        let req1 = make_request("run-1", "file_read", &"a".repeat(64));
        let req2 = make_request("run-1", "file_write", &"b".repeat(64));

        assert_eq!(detector.check(&req1, &config), LoopStatus::Ok);
        assert_eq!(detector.check(&req2, &config), LoopStatus::Ok);
    }

    #[test]
    fn repeated_identical_calls_trigger_after_threshold() {
        let detector = LoopDetector::new();
        let config = default_config(); // threshold = 3

        let hash = "a".repeat(64);
        let req = make_request("run-1", "file_read", &hash);

        // First two calls — ok
        assert_eq!(detector.check(&req, &config), LoopStatus::Ok);
        assert_eq!(detector.check(&req, &config), LoopStatus::Ok);

        // Third call — triggers cooldown warning
        let status = detector.check(&req, &config);
        assert!(
            matches!(status, LoopStatus::CooldownWarning { .. }),
            "Expected CooldownWarning, got {:?}",
            status
        );
    }

    #[test]
    fn cooldown_then_kill() {
        let detector = LoopDetector::new();
        let config = LoopDetectionConfig {
            identical_call_threshold: 2,
            ..default_config()
        };

        let hash = "a".repeat(64);
        let req = make_request("run-1", "file_read", &hash);

        // First trigger — cooldown
        assert_eq!(detector.check(&req, &config), LoopStatus::Ok);
        let status = detector.check(&req, &config);
        assert!(matches!(status, LoopStatus::CooldownWarning { .. }));

        // Agent continues with the same call after cooldown — kill
        let status2 = detector.check(&req, &config);
        assert!(
            matches!(status2, LoopStatus::LoopDetected { .. }),
            "Expected LoopDetected, got {:?}",
            status2
        );
    }

    #[test]
    fn different_runs_are_isolated() {
        let detector = LoopDetector::new();
        let config = LoopDetectionConfig {
            identical_call_threshold: 2,
            ..default_config()
        };

        let hash = "a".repeat(64);
        let req_a = make_request("run-a", "file_read", &hash);
        let req_b = make_request("run-b", "file_read", &hash);

        // Run A triggers cooldown
        assert_eq!(detector.check(&req_a, &config), LoopStatus::Ok);
        let status_a = detector.check(&req_a, &config);
        assert!(matches!(status_a, LoopStatus::CooldownWarning { .. }));

        // Run B is unaffected
        assert_eq!(detector.check(&req_b, &config), LoopStatus::Ok);
    }

    #[test]
    fn error_streaks_trigger() {
        let detector = LoopDetector::new();
        let config = LoopDetectionConfig {
            identical_error_threshold: 2,
            ..default_config()
        };

        let hash = "a".repeat(64);

        // Two identical errors without intervening success
        assert_eq!(
            detector.record_error("run-1", "http_get", &hash, &config),
            LoopStatus::Ok
        );
        let status = detector.record_error("run-1", "http_get", &hash, &config);
        assert!(matches!(status, LoopStatus::CooldownWarning { .. }));
    }

    #[test]
    fn success_resets_error_streak() {
        let detector = LoopDetector::new();
        let config = LoopDetectionConfig {
            identical_error_threshold: 3,
            ..default_config()
        };

        let hash = "a".repeat(64);

        // Two errors
        detector.record_error("run-1", "http_get", &hash, &config);
        detector.record_error("run-1", "http_get", &hash, &config);

        // Success resets
        detector.record_success("run-1", "http_get", &hash);

        // Two more errors — should be ok (streak reset)
        assert_eq!(
            detector.record_error("run-1", "http_get", &hash, &config),
            LoopStatus::Ok
        );
        assert_eq!(
            detector.record_error("run-1", "http_get", &hash, &config),
            LoopStatus::Ok
        );
    }

    #[test]
    fn disabled_detection_always_ok() {
        let detector = LoopDetector::new();
        let config = LoopDetectionConfig {
            enabled: false,
            ..default_config()
        };

        let hash = "a".repeat(64);
        let req = make_request("run-1", "file_read", &hash);

        // Many identical calls — should all be ok because detection is disabled
        for _ in 0..100 {
            assert_eq!(detector.check(&req, &config), LoopStatus::Ok);
        }
    }

    #[test]
    fn different_args_dont_trigger() {
        let detector = LoopDetector::new();
        let config = LoopDetectionConfig {
            identical_call_threshold: 2,
            ..default_config()
        };

        // Same tool but different args_hash
        let req1 = make_request("run-1", "file_read", &"a".repeat(64));
        let req2 = make_request("run-1", "file_read", &"b".repeat(64));
        let req3 = make_request("run-1", "file_read", &"c".repeat(64));

        assert_eq!(detector.check(&req1, &config), LoopStatus::Ok);
        assert_eq!(detector.check(&req2, &config), LoopStatus::Ok);
        assert_eq!(detector.check(&req3, &config), LoopStatus::Ok);
    }

    #[test]
    fn reset_clears_state() {
        let detector = LoopDetector::new();
        let config = LoopDetectionConfig {
            identical_call_threshold: 2,
            ..default_config()
        };

        let hash = "a".repeat(64);
        let req = make_request("run-1", "file_read", &hash);

        assert_eq!(detector.check(&req, &config), LoopStatus::Ok);
        let status = detector.check(&req, &config);
        assert!(matches!(status, LoopStatus::CooldownWarning { .. }));

        // Reset the run
        detector.reset("run-1");

        // After reset, same calls should start fresh
        assert_eq!(detector.check(&req, &config), LoopStatus::Ok);
    }
}
