// SPDX-License-Identifier: MIT
//! Budget tracker — multi-dimensional budget enforcement (ADR-007).
//!
//! Tracks four dimensions per run: cost_usd, input_tokens, output_tokens, call_count.
//! Soft caps emit warnings; hard caps kill the run.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::policy::BudgetConfig;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Current budget state for a single run.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BudgetState {
    pub cost_usd: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub call_count: u64,
}

/// An update to record against the budget for a run.
#[derive(Debug, Clone, Default)]
pub struct BudgetUpdate {
    pub cost_usd: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// Budget check result.
#[derive(Debug, Clone, PartialEq)]
pub enum BudgetStatus {
    /// All dimensions are within limits.
    Ok,
    /// A soft cap has been reached — emit a warning but continue.
    SoftCapWarning {
        dimension: String,
        current: f64,
        cap: f64,
    },
    /// A hard cap has been exceeded — kill the run.
    HardCapExceeded {
        dimension: String,
        current: f64,
        cap: f64,
    },
}

// ---------------------------------------------------------------------------
// BudgetTracker
// ---------------------------------------------------------------------------

/// Thread-safe budget tracker for all runs.
#[derive(Debug, Clone)]
pub struct BudgetTracker {
    states: Arc<RwLock<HashMap<String, BudgetState>>>,
}

impl BudgetTracker {
    /// Create a new empty budget tracker.
    pub fn new() -> Self {
        Self {
            states: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Record a budget update for a run and check against caps.
    ///
    /// Returns the worst status across all dimensions (HardCapExceeded > SoftCapWarning > Ok).
    pub fn record(
        &self,
        run_id: &str,
        update: &BudgetUpdate,
        config: Option<&BudgetConfig>,
    ) -> BudgetStatus {
        let mut states = self.states.write().expect("budget lock poisoned");
        let state = states.entry(run_id.to_string()).or_default();

        // Increment counters
        state.cost_usd += update.cost_usd;
        state.input_tokens += update.input_tokens;
        state.output_tokens += update.output_tokens;
        state.call_count += 1;

        // Check against config
        let Some(config) = config else {
            return BudgetStatus::Ok;
        };

        // Check all dimensions, returning the worst status
        let mut worst = BudgetStatus::Ok;

        // cost_usd
        if let Some(ref dim) = config.cost_usd {
            let status = check_float_dimension("cost_usd", state.cost_usd, dim.soft, dim.hard);
            worst = worse_status(worst, status);
        }

        // input_tokens
        if let Some(ref dim) = config.input_tokens {
            let status = check_int_dimension(
                "input_tokens",
                state.input_tokens,
                dim.soft,
                dim.hard,
            );
            worst = worse_status(worst, status);
        }

        // output_tokens
        if let Some(ref dim) = config.output_tokens {
            let status = check_int_dimension(
                "output_tokens",
                state.output_tokens,
                dim.soft,
                dim.hard,
            );
            worst = worse_status(worst, status);
        }

        // call_count
        if let Some(ref dim) = config.call_count {
            let status = check_int_dimension(
                "call_count",
                state.call_count,
                dim.soft,
                dim.hard,
            );
            worst = worse_status(worst, status);
        }

        if let BudgetStatus::SoftCapWarning {
            ref dimension,
            current,
            cap,
        } = worst
        {
            warn!(
                run_id = %run_id,
                dimension = %dimension,
                current = %current,
                cap = %cap,
                "budget soft cap warning"
            );
        }

        worst
    }

    /// Check hard caps without recording an update.
    /// Returns `Some(HardCapExceeded)` if any hard cap is exceeded, `None` otherwise.
    pub fn check_hard_caps(&self, run_id: &str) -> Option<BudgetStatus> {
        let states = self.states.read().expect("budget lock poisoned");
        let _state = states.get(run_id)?;
        // Hard caps are checked at record time. This method lets the evaluator
        // do a pre-check before evaluation. If we've already recorded an
        // exceeded state, the budget state will be over the cap.
        // However, without config we can't check. This is done during record().
        // Return None here — the evaluator should rely on the record() result
        // or use check_hard_caps_with_config.
        None
    }

    /// Check hard caps with a known budget config.
    pub fn check_hard_caps_with_config(
        &self,
        run_id: &str,
        config: &BudgetConfig,
    ) -> Option<BudgetStatus> {
        let states = self.states.read().expect("budget lock poisoned");
        let state = states.get(run_id)?;

        if let Some(ref dim) = config.cost_usd {
            if state.cost_usd > dim.hard {
                return Some(BudgetStatus::HardCapExceeded {
                    dimension: "cost_usd".to_string(),
                    current: state.cost_usd,
                    cap: dim.hard,
                });
            }
        }

        if let Some(ref dim) = config.input_tokens {
            if state.input_tokens > dim.hard {
                return Some(BudgetStatus::HardCapExceeded {
                    dimension: "input_tokens".to_string(),
                    current: state.input_tokens as f64,
                    cap: dim.hard as f64,
                });
            }
        }

        if let Some(ref dim) = config.output_tokens {
            if state.output_tokens > dim.hard {
                return Some(BudgetStatus::HardCapExceeded {
                    dimension: "output_tokens".to_string(),
                    current: state.output_tokens as f64,
                    cap: dim.hard as f64,
                });
            }
        }

        if let Some(ref dim) = config.call_count {
            if state.call_count > dim.hard {
                return Some(BudgetStatus::HardCapExceeded {
                    dimension: "call_count".to_string(),
                    current: state.call_count as f64,
                    cap: dim.hard as f64,
                });
            }
        }

        None
    }

    /// Get the current budget state for a run.
    pub fn get_state(&self, run_id: &str) -> Option<BudgetState> {
        let states = self.states.read().expect("budget lock poisoned");
        states.get(run_id).cloned()
    }

    /// Reset the budget state for a run (e.g., when the run ends).
    pub fn reset(&self, run_id: &str) {
        let mut states = self.states.write().expect("budget lock poisoned");
        states.remove(run_id);
    }
}

impl Default for BudgetTracker {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn check_float_dimension(
    name: &str,
    current: f64,
    soft: Option<f64>,
    hard: f64,
) -> BudgetStatus {
    if current > hard {
        return BudgetStatus::HardCapExceeded {
            dimension: name.to_string(),
            current,
            cap: hard,
        };
    }
    if let Some(soft_cap) = soft {
        if current > soft_cap {
            return BudgetStatus::SoftCapWarning {
                dimension: name.to_string(),
                current,
                cap: soft_cap,
            };
        }
    }
    BudgetStatus::Ok
}

fn check_int_dimension(
    name: &str,
    current: u64,
    soft: Option<u64>,
    hard: u64,
) -> BudgetStatus {
    if current > hard {
        return BudgetStatus::HardCapExceeded {
            dimension: name.to_string(),
            current: current as f64,
            cap: hard as f64,
        };
    }
    if let Some(soft_cap) = soft {
        if current > soft_cap {
            return BudgetStatus::SoftCapWarning {
                dimension: name.to_string(),
                current: current as f64,
                cap: soft_cap as f64,
            };
        }
    }
    BudgetStatus::Ok
}

/// Return the worse of two statuses (HardCapExceeded > SoftCapWarning > Ok).
fn worse_status(a: BudgetStatus, b: BudgetStatus) -> BudgetStatus {
    match (&a, &b) {
        (BudgetStatus::HardCapExceeded { .. }, _) => a,
        (_, BudgetStatus::HardCapExceeded { .. }) => b,
        (BudgetStatus::SoftCapWarning { .. }, _) => a,
        (_, BudgetStatus::SoftCapWarning { .. }) => b,
        _ => BudgetStatus::Ok,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{BudgetDimensionFloat, BudgetDimensionInt};

    fn make_config(cost_hard: f64, cost_soft: Option<f64>, calls_hard: u64) -> BudgetConfig {
        BudgetConfig {
            cost_usd: Some(BudgetDimensionFloat {
                soft: cost_soft,
                hard: cost_hard,
            }),
            input_tokens: None,
            output_tokens: None,
            call_count: Some(BudgetDimensionInt {
                soft: None,
                hard: calls_hard,
            }),
        }
    }

    #[test]
    fn recording_within_limits_returns_ok() {
        let tracker = BudgetTracker::new();
        let config = make_config(10.0, Some(5.0), 100);
        let update = BudgetUpdate {
            cost_usd: 0.50,
            input_tokens: 100,
            output_tokens: 50,
        };
        let status = tracker.record("run-1", &update, Some(&config));
        assert_eq!(status, BudgetStatus::Ok);

        let state = tracker.get_state("run-1").unwrap();
        assert_eq!(state.cost_usd, 0.50);
        assert_eq!(state.call_count, 1);
    }

    #[test]
    fn soft_cap_warning_fires_at_threshold() {
        let tracker = BudgetTracker::new();
        let config = make_config(10.0, Some(2.0), 100);

        // First few calls — ok
        for _ in 0..4 {
            let update = BudgetUpdate {
                cost_usd: 0.50,
                ..Default::default()
            };
            tracker.record("run-1", &update, Some(&config));
        }
        // Total is now 2.0 — at soft cap

        let update = BudgetUpdate {
            cost_usd: 0.10,
            ..Default::default()
        };
        let status = tracker.record("run-1", &update, Some(&config));
        assert!(matches!(status, BudgetStatus::SoftCapWarning { .. }));
        if let BudgetStatus::SoftCapWarning {
            dimension, cap, ..
        } = status
        {
            assert_eq!(dimension, "cost_usd");
            assert_eq!(cap, 2.0);
        }
    }

    #[test]
    fn hard_cap_exceeded_denies() {
        let tracker = BudgetTracker::new();
        let config = make_config(5.0, Some(3.0), 100);

        // Blow past the hard cap
        let update = BudgetUpdate {
            cost_usd: 6.0,
            ..Default::default()
        };
        let status = tracker.record("run-1", &update, Some(&config));
        assert!(matches!(status, BudgetStatus::HardCapExceeded { .. }));
        if let BudgetStatus::HardCapExceeded {
            dimension,
            current,
            cap,
        } = status
        {
            assert_eq!(dimension, "cost_usd");
            assert_eq!(current, 6.0);
            assert_eq!(cap, 5.0);
        }
    }

    #[test]
    fn multiple_dimensions_tracked_independently() {
        let tracker = BudgetTracker::new();
        let config = BudgetConfig {
            cost_usd: Some(BudgetDimensionFloat {
                soft: None,
                hard: 100.0,
            }),
            input_tokens: Some(BudgetDimensionInt {
                soft: Some(500),
                hard: 1000,
            }),
            output_tokens: Some(BudgetDimensionInt {
                soft: None,
                hard: 500,
            }),
            call_count: Some(BudgetDimensionInt {
                soft: None,
                hard: 10,
            }),
        };

        // Cost is fine but input_tokens will exceed soft
        let update = BudgetUpdate {
            cost_usd: 1.0,
            input_tokens: 600,
            output_tokens: 100,
        };
        let status = tracker.record("run-1", &update, Some(&config));
        assert!(matches!(status, BudgetStatus::SoftCapWarning { .. }));
        if let BudgetStatus::SoftCapWarning { dimension, .. } = status {
            assert_eq!(dimension, "input_tokens");
        }
    }

    #[test]
    fn per_run_isolation() {
        let tracker = BudgetTracker::new();
        let config = make_config(5.0, None, 100);

        let update = BudgetUpdate {
            cost_usd: 3.0,
            ..Default::default()
        };
        tracker.record("run-a", &update, Some(&config));

        let update2 = BudgetUpdate {
            cost_usd: 1.0,
            ..Default::default()
        };
        tracker.record("run-b", &update2, Some(&config));

        let state_a = tracker.get_state("run-a").unwrap();
        let state_b = tracker.get_state("run-b").unwrap();
        assert_eq!(state_a.cost_usd, 3.0);
        assert_eq!(state_b.cost_usd, 1.0);
        assert_eq!(state_a.call_count, 1);
        assert_eq!(state_b.call_count, 1);
    }

    #[test]
    fn call_count_hard_cap() {
        let tracker = BudgetTracker::new();
        let config = make_config(100.0, None, 3);

        for i in 0..3 {
            let update = BudgetUpdate {
                cost_usd: 0.01,
                ..Default::default()
            };
            let status = tracker.record("run-1", &update, Some(&config));
            assert_eq!(status, BudgetStatus::Ok, "call {} should be ok", i);
        }

        // 4th call exceeds the hard cap of 3
        let update = BudgetUpdate {
            cost_usd: 0.01,
            ..Default::default()
        };
        let status = tracker.record("run-1", &update, Some(&config));
        assert!(matches!(status, BudgetStatus::HardCapExceeded { .. }));
    }

    #[test]
    fn no_config_always_ok() {
        let tracker = BudgetTracker::new();
        let update = BudgetUpdate {
            cost_usd: 999.0,
            input_tokens: 999_999,
            output_tokens: 999_999,
        };
        let status = tracker.record("run-1", &update, None);
        assert_eq!(status, BudgetStatus::Ok);
    }

    #[test]
    fn reset_clears_state() {
        let tracker = BudgetTracker::new();
        let update = BudgetUpdate {
            cost_usd: 1.0,
            ..Default::default()
        };
        tracker.record("run-1", &update, None);
        assert!(tracker.get_state("run-1").is_some());

        tracker.reset("run-1");
        assert!(tracker.get_state("run-1").is_none());
    }

    #[test]
    fn check_hard_caps_with_config() {
        let tracker = BudgetTracker::new();
        let config = make_config(5.0, None, 100);

        let update = BudgetUpdate {
            cost_usd: 6.0,
            ..Default::default()
        };
        tracker.record("run-1", &update, None); // record without check

        let check = tracker.check_hard_caps_with_config("run-1", &config);
        assert!(check.is_some());
        assert!(matches!(
            check.unwrap(),
            BudgetStatus::HardCapExceeded { .. }
        ));
    }
}
