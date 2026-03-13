// SPDX-License-Identifier: MIT
//! Decision types — DecisionRequest, DecisionResponse, and the Decision enum.
//! These mirror the IPC schemas in schemas/ipc/ (ADR-001).

use serde::{Deserialize, Serialize};

/// The enforcement decision produced by the engine for each tool call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Deny,
    /// Loop detected — shim should pause for `cooldown_ms` before retrying.
    Cooldown,
    /// Run terminated due to budget exhaustion or policy kill action.
    Kill,
    /// Human approval required before the call proceeds (v1.1).
    RequireApproval,
}

/// Inbound request from a shim — mirrors DecisionRequest schema (ADR-001).
#[derive(Debug, Deserialize)]
pub struct DecisionRequest {
    pub schema_version: u32,
    pub run_id: String,
    pub seq: u64,
    pub tool: String,
    pub args_hash: String,
    pub args_redacted: Option<serde_json::Value>,
    pub agent_role: Option<String>,
    pub agent_name: Option<String>,
    pub model: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub estimated_cost_usd: Option<f64>,
    pub environment: Option<String>,
    pub ts: String,
}

/// Outbound response to the shim — mirrors DecisionResponse schema (ADR-001).
#[derive(Debug, Serialize)]
pub struct DecisionResponse {
    pub schema_version: u32,
    pub run_id: String,
    pub seq: u64,
    pub decision: Decision,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooldown_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cooldown_message: Option<String>,
    pub ts: String,
}
