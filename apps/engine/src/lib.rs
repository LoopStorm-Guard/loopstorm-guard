// SPDX-License-Identifier: MIT
//! loopstorm-engine — core enforcement library.
//!
//! This crate provides the policy evaluation engine, budget tracker,
//! loop detection heuristics, and IPC protocol implementation for
//! LoopStorm Guard.
//!
//! The engine binary (`loopstorm-engine`) listens on a Unix Domain Socket
//! (or named pipe on Windows) and processes DecisionRequest / DecisionResponse
//! messages as defined in ADR-001.

/// The policy schema hash baked in at compile time by build.rs (ADR-003).
/// The engine binary surfaces this in its version output for auditability.
pub const POLICY_SCHEMA_HASH: &str = env!("POLICY_SCHEMA_HASH");

pub mod audit;
pub mod budget;
pub mod decision;
pub mod evaluator;
pub mod loop_detector;
pub mod policy;
pub mod redaction;
pub mod server;
pub mod telemetry;

// Re-export key types for ergonomic use by consumers.
pub use audit::{AuditEvent, AuditWriter};
pub use budget::{BudgetState, BudgetStatus, BudgetTracker, BudgetUpdate};
pub use decision::{Decision, DecisionRequest, DecisionResponse};
pub use evaluator::evaluate;
pub use loop_detector::{LoopDetector, LoopStatus};
pub use policy::{CompiledPolicy, Policy, PolicyError};
pub use redaction::Redactor;

use std::collections::HashMap;
use std::path::Path;

use tracing::{error, info, warn};

// ---------------------------------------------------------------------------
// EnforcementContext — holds all runtime state for the enforcement pipeline
// ---------------------------------------------------------------------------

/// Runtime context for the enforcement pipeline.
///
/// Holds the compiled policy, budget tracker, loop detector, audit writer,
/// and redactor. One context is created per engine instance.
#[derive(Debug)]
pub struct EnforcementContext {
    pub policy: CompiledPolicy,
    pub budget_tracker: BudgetTracker,
    pub loop_detector: LoopDetector,
    pub audit_writer: AuditWriter,
    pub redactor: Redactor,
    /// Per-run behavioral telemetry state (v1.1).
    pub telemetry_states: HashMap<String, telemetry::TelemetryState>,
}

impl EnforcementContext {
    /// Create a new enforcement context from a policy file and audit log path.
    pub fn new(policy_path: &Path, audit_path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let policy = Policy::from_yaml(policy_path)?;
        let audit_writer = AuditWriter::new(audit_path)?;
        let redactor = Redactor::new(policy.policy.redaction.as_ref());

        Ok(Self {
            policy,
            budget_tracker: BudgetTracker::new(),
            loop_detector: LoopDetector::new(),
            audit_writer,
            redactor,
            telemetry_states: HashMap::new(),
        })
    }
}

// ---------------------------------------------------------------------------
// enforce — the main enforcement pipeline function
// ---------------------------------------------------------------------------

/// The main enforcement pipeline function.
///
/// Pipeline stages (in order):
/// 1. `escalate_to_human` bypass — always allow
/// 2. Check budget hard caps — deny/kill if exceeded
/// 3. Check loop detection — cooldown or kill
/// 4. Evaluate policy rules — first match wins
/// 5. Record budget update
/// 6. Redact args for audit
/// 7. Write audit event
/// 8. Return decision
///
/// **CRITICAL**: If the audit write fails, the run MUST be killed (ADR-005).
pub fn enforce(request: &DecisionRequest, ctx: &mut EnforcementContext) -> DecisionResponse {
    let start = std::time::Instant::now();

    // Steps 1-4: Evaluate (escalate_to_human bypass, budget, loop, policy rules)
    let response = evaluator::evaluate(
        request,
        &ctx.policy,
        &ctx.budget_tracker,
        &ctx.loop_detector,
    );

    // Step 5: Record budget update (only if allowed — still record on deny for tracking)
    let budget_config = ctx.policy.policy.budget.as_ref();
    let budget_update = BudgetUpdate {
        cost_usd: request.estimated_cost_usd.unwrap_or(0.0),
        input_tokens: request.input_tokens.unwrap_or(0),
        output_tokens: request.output_tokens.unwrap_or(0),
    };
    let budget_status = ctx
        .budget_tracker
        .record(&request.run_id, &budget_update, budget_config);

    // If budget recording reveals a hard cap exceeded (could happen if we
    // allowed this call but the cumulative total now exceeds), convert to kill.
    let response = match budget_status {
        BudgetStatus::HardCapExceeded {
            ref dimension,
            current,
            cap,
        } => {
            warn!(
                run_id = %request.run_id,
                dimension = %dimension,
                current = %current,
                cap = %cap,
                "budget hard cap exceeded after recording — kill"
            );
            DecisionResponse {
                schema_version: 1,
                run_id: request.run_id.clone(),
                seq: request.seq,
                decision: Decision::Kill,
                rule_id: Some("__builtin_budget_hard_cap".to_string()),
                reason: Some(format!(
                    "budget hard cap exceeded: {} = {:.4} (cap: {:.4})",
                    dimension, current, cap
                )),
                cooldown_ms: None,
                cooldown_message: None,
                approval_id: None,
                approval_timeout_ms: None,
                approval_timeout_action: None,
                budget_remaining: None,
                ts: chrono::Utc::now().to_rfc3339(),
            }
        }
        _ => response,
    };

    // Step 6: Redact args for audit
    let redacted_args = request
        .args_redacted
        .as_ref()
        .map(|args| ctx.redactor.redact(args));

    // Step 6.5: Compute behavioral telemetry (v1.1)
    let telemetry_state = ctx
        .telemetry_states
        .entry(request.run_id.clone())
        .or_default();
    let bt = telemetry_state.compute(
        &request.tool,
        &request.args_hash,
        redacted_args.as_ref(),
        request.input_tokens,
        request.output_tokens,
        start,
    );

    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    // Step 7: Write audit event
    let mut audit_event = AuditEvent {
        schema_version: 1,
        event_type: "policy_decision".to_string(),
        run_id: request.run_id.clone(),
        seq: request.seq,
        hash: None,
        hash_prev: None,
        ts: chrono::Utc::now().to_rfc3339(),
        tool: Some(request.tool.clone()),
        args_hash: Some(request.args_hash.clone()),
        args_redacted: redacted_args,
        decision: Some(
            serde_json::to_value(&response.decision)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| format!("{:?}", response.decision)),
        ),
        rule_id: response.rule_id.clone(),
        reason: response.reason.clone(),
        agent_name: request.agent_name.clone(),
        agent_role: request.agent_role.clone(),
        model: request.model.clone(),
        input_tokens: request.input_tokens,
        output_tokens: request.output_tokens,
        estimated_cost_usd: request.estimated_cost_usd,
        environment: request.environment.clone(),
        run_status: None,
        dimension: None,
        loop_rule: None,
        loop_action: None,
        cooldown_ms: response.cooldown_ms,
        budget: None,
        latency_ms: Some(elapsed_ms),
        policy_pack_id: ctx.policy.policy.name.clone(),
        call_seq_fingerprint: Some(bt.call_seq_fingerprint),
        inter_call_ms: Some(bt.inter_call_ms),
        token_rate_delta: bt.token_rate_delta,
        param_shape_hash: Some(bt.param_shape_hash),
    };

    // CRITICAL: If the audit write fails, the run MUST be killed (ADR-005).
    if let Err(e) = ctx.audit_writer.write_event(&mut audit_event) {
        error!(
            run_id = %request.run_id,
            error = %e,
            "FATAL: audit write failed — killing run (ADR-005)"
        );
        return DecisionResponse {
            schema_version: 1,
            run_id: request.run_id.clone(),
            seq: request.seq,
            decision: Decision::Kill,
            rule_id: Some("__builtin_audit_write_failure".to_string()),
            reason: Some(format!("audit write failed — run killed (ADR-005): {}", e)),
            cooldown_ms: None,
            cooldown_message: None,
            approval_id: None,
            approval_timeout_ms: None,
            approval_timeout_action: None,
            budget_remaining: None,
            ts: chrono::Utc::now().to_rfc3339(),
        };
    }

    // Log budget soft cap warnings as additional events
    if let BudgetStatus::SoftCapWarning {
        ref dimension,
        current,
        cap,
    } = budget_status
    {
        info!(
            run_id = %request.run_id,
            dimension = %dimension,
            current = %current,
            cap = %cap,
            "budget soft cap warning"
        );
        let mut warning_event = AuditEvent {
            schema_version: 1,
            event_type: "budget_soft_cap_warning".to_string(),
            run_id: request.run_id.clone(),
            seq: request.seq,
            hash: None,
            hash_prev: None,
            ts: chrono::Utc::now().to_rfc3339(),
            tool: None,
            args_hash: None,
            args_redacted: None,
            decision: None,
            rule_id: None,
            reason: Some(format!(
                "soft cap warning: {} = {:.4} (cap: {:.4})",
                dimension, current, cap
            )),
            agent_name: None,
            agent_role: None,
            model: None,
            input_tokens: None,
            output_tokens: None,
            estimated_cost_usd: None,
            environment: None,
            run_status: None,
            dimension: Some(dimension.clone()),
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
        };
        // Best effort — if this fails, we already have the main event
        if let Err(e) = ctx.audit_writer.write_event(&mut warning_event) {
            error!(
                run_id = %request.run_id,
                error = %e,
                "failed to write budget warning event"
            );
        }
    }

    // Step 8: Return decision
    response
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;

    fn setup_context(yaml: &str) -> EnforcementContext {
        let policy = Policy::from_yaml_str(yaml).expect("test policy should parse");
        let dir = std::env::temp_dir().join(format!("enforce_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let audit_path = dir.join("audit.jsonl");
        let audit_writer = AuditWriter::new(&audit_path).unwrap();
        let redactor = Redactor::new(policy.policy.redaction.as_ref());

        EnforcementContext {
            policy,
            budget_tracker: BudgetTracker::new(),
            loop_detector: LoopDetector::new(),
            audit_writer,
            redactor,
            telemetry_states: HashMap::new(),
        }
    }

    fn make_request(tool: &str) -> DecisionRequest {
        DecisionRequest {
            schema_version: 1,
            run_id: "test-run-001".to_string(),
            seq: 1,
            tool: tool.to_string(),
            args_hash: "a".repeat(64),
            args_redacted: None,
            agent_role: None,
            agent_name: None,
            model: None,
            input_tokens: Some(100),
            output_tokens: Some(50),
            estimated_cost_usd: Some(0.01),
            environment: None,
            ts: "2026-03-15T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn enforce_pipeline_escalate_to_human() {
        let mut ctx = setup_context(
            r#"
schema_version: 1
rules:
  - name: "deny-all"
    action: deny
"#,
        );

        let req = make_request("escalate_to_human");
        let resp = enforce(&req, &mut ctx);
        assert_eq!(resp.decision, Decision::Allow);
    }

    #[test]
    fn enforce_pipeline_allow_and_audit() {
        let mut ctx = setup_context(
            r#"
schema_version: 1
rules:
  - name: "allow-read"
    action: allow
    tool: "file_read"
  - name: "deny-all"
    action: deny
"#,
        );

        let req = make_request("file_read");
        let resp = enforce(&req, &mut ctx);
        assert_eq!(resp.decision, Decision::Allow);
        assert_eq!(ctx.audit_writer.event_count(), 1);

        // Verify audit log
        let audit_path = ctx.audit_writer.path().to_path_buf();
        let file = std::fs::File::open(&audit_path).unwrap();
        let reader = std::io::BufReader::new(file);
        let lines: Vec<String> = reader.lines().map(|l| l.unwrap()).collect();
        assert_eq!(lines.len(), 1);

        let event: serde_json::Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(event["event_type"], "policy_decision");
        assert_eq!(event["tool"], "file_read");
        assert_eq!(event["decision"], "allow");
    }

    #[test]
    fn enforce_pipeline_deny_and_audit() {
        let mut ctx = setup_context(
            r#"
schema_version: 1
rules:
  - name: "deny-all"
    action: deny
"#,
        );

        let req = make_request("anything");
        let resp = enforce(&req, &mut ctx);
        assert_eq!(resp.decision, Decision::Deny);
        assert_eq!(ctx.audit_writer.event_count(), 1);
    }

    #[test]
    fn enforce_pipeline_redacts_args() {
        let mut ctx = setup_context(
            r#"
schema_version: 1
rules:
  - name: "allow-all"
    action: allow
redaction:
  enabled: true
"#,
        );

        let mut req = make_request("http_call");
        req.args_redacted = Some(serde_json::json!({
            "url": "https://api.example.com",
            "api_key": "sk-abcdefghijklmnopqrstuvwxyz1234567890"
        }));
        let resp = enforce(&req, &mut ctx);
        assert_eq!(resp.decision, Decision::Allow);

        // Check audit log for redacted args
        let audit_path = ctx.audit_writer.path().to_path_buf();
        let file = std::fs::File::open(&audit_path).unwrap();
        let reader = std::io::BufReader::new(file);
        let lines: Vec<String> = reader.lines().map(|l| l.unwrap()).collect();
        let event: serde_json::Value = serde_json::from_str(&lines[0]).unwrap();
        let args = &event["args_redacted"];
        assert_eq!(args["url"], "https://api.example.com");
        assert_eq!(args["api_key"], "[REDACTED]");
    }
}
