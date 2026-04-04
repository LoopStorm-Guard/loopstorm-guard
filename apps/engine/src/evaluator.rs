// SPDX-License-Identifier: MIT
//! Policy evaluator — first-match-wins rule evaluation engine (ADR-002).
//!
//! The evaluator processes a `DecisionRequest` against a compiled policy pack
//! and returns a `DecisionResponse`. The key invariants are:
//!
//! 1. `escalate_to_human` is ALWAYS allowed — before any rule evaluation.
//! 2. Rules are evaluated in order (first match wins).
//! 3. If no rule matches, the decision is **deny** (fail-closed).

use crate::budget::{BudgetStatus, BudgetTracker};
use crate::decision::{Decision, DecisionRequest, DecisionResponse};
use crate::loop_detector::{LoopDetector, LoopStatus};
use crate::policy::{CompiledPolicy, Condition, ConditionOperator, RuleAction};
use globset::Glob;
use tracing::{debug, info, warn};

/// Evaluate a decision request against the full enforcement pipeline.
///
/// Pipeline order:
/// 1. `escalate_to_human` bypass — always allow
/// 2. Budget hard cap check — deny if exceeded
/// 3. Loop detection — cooldown or kill
/// 4. Policy rule evaluation — first match wins
/// 5. No match → deny (fail-closed)
pub fn evaluate(
    request: &DecisionRequest,
    policy: &CompiledPolicy,
    budget_tracker: &BudgetTracker,
    loop_detector: &LoopDetector,
) -> DecisionResponse {
    let now = chrono::Utc::now().to_rfc3339();

    // 1. CRITICAL: escalate_to_human is NEVER blocked.
    if request.tool == "escalate_to_human" {
        info!(
            run_id = %request.run_id,
            seq = request.seq,
            "escalate_to_human: always allowed"
        );
        return DecisionResponse {
            schema_version: 1,
            run_id: request.run_id.clone(),
            seq: request.seq,
            decision: Decision::Allow,
            rule_id: Some("__builtin_escalate_to_human_allow".to_string()),
            reason: Some("escalate_to_human is always allowed".to_string()),
            cooldown_ms: None,
            cooldown_message: None,
            approval_id: None,
            approval_timeout_ms: None,
            approval_timeout_action: None,
            budget_remaining: None,
            ts: now,
        };
    }

    // 2. Budget hard cap check (pre-check with config if available)
    if let Some(ref budget_config) = policy.policy.budget {
        if let Some(BudgetStatus::HardCapExceeded {
            dimension,
            current,
            cap,
        }) = budget_tracker.check_hard_caps_with_config(&request.run_id, budget_config)
        {
            warn!(
                run_id = %request.run_id,
                dimension = %dimension,
                current = %current,
                cap = %cap,
                "budget hard cap exceeded — kill"
            );
            return DecisionResponse {
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
                ts: now,
            };
        }
    }

    // 3. Loop detection
    let loop_config = policy
        .policy
        .loop_detection
        .as_ref()
        .cloned()
        .unwrap_or_default();
    if loop_config.enabled {
        let loop_status = loop_detector.check(request, &loop_config);
        match loop_status {
            LoopStatus::CooldownWarning { reason } => {
                warn!(
                    run_id = %request.run_id,
                    seq = request.seq,
                    reason = %reason,
                    "loop detected — cooldown"
                );
                let cooldown_message = format!(
                    "Loop detected: {}. The agent should try a different approach.",
                    reason
                );
                return DecisionResponse {
                    schema_version: 1,
                    run_id: request.run_id.clone(),
                    seq: request.seq,
                    decision: Decision::Cooldown,
                    rule_id: Some("__builtin_loop_detection".to_string()),
                    reason: Some(reason),
                    cooldown_ms: Some(loop_config.cooldown_ms),
                    cooldown_message: Some(cooldown_message),
                    approval_id: None,
                    approval_timeout_ms: None,
                    approval_timeout_action: None,
                    budget_remaining: None,
                    ts: now,
                };
            }
            LoopStatus::LoopDetected { reason } => {
                warn!(
                    run_id = %request.run_id,
                    seq = request.seq,
                    reason = %reason,
                    "loop confirmed after cooldown — kill"
                );
                return DecisionResponse {
                    schema_version: 1,
                    run_id: request.run_id.clone(),
                    seq: request.seq,
                    decision: Decision::Kill,
                    rule_id: Some("__builtin_loop_detection".to_string()),
                    reason: Some(reason),
                    cooldown_ms: None,
                    cooldown_message: None,
                    approval_id: None,
                    approval_timeout_ms: None,
                    approval_timeout_action: None,
                    budget_remaining: None,
                    ts: now,
                };
            }
            LoopStatus::Ok => {}
        }
    }

    // 4. Policy rule evaluation — first match wins
    for compiled_rule in &policy.compiled_rules {
        if !compiled_rule.matches_tool(&request.tool) {
            continue;
        }

        // Check conditions (all must match — AND logic)
        if let Some(ref conditions) = compiled_rule.rule.conditions {
            if !evaluate_conditions(conditions, request) {
                continue;
            }
        }

        // Rule matched
        let decision = match compiled_rule.rule.action {
            RuleAction::Allow => Decision::Allow,
            RuleAction::Deny => Decision::Deny,
            RuleAction::RequireApproval => Decision::RequireApproval,
        };

        debug!(
            run_id = %request.run_id,
            seq = request.seq,
            rule = %compiled_rule.rule.name,
            decision = ?decision,
            "policy rule matched"
        );

        return DecisionResponse {
            schema_version: 1,
            run_id: request.run_id.clone(),
            seq: request.seq,
            decision,
            rule_id: Some(compiled_rule.rule.name.clone()),
            reason: compiled_rule.rule.reason.clone(),
            cooldown_ms: None,
            cooldown_message: None,
            approval_id: None,
            approval_timeout_ms: None,
            approval_timeout_action: None,
            budget_remaining: None,
            ts: now,
        };
    }

    // 5. No rule matched → deny (fail-closed, ADR-002)
    info!(
        run_id = %request.run_id,
        seq = request.seq,
        tool = %request.tool,
        "no matching rule — deny (fail-closed)"
    );
    DecisionResponse {
        schema_version: 1,
        run_id: request.run_id.clone(),
        seq: request.seq,
        decision: Decision::Deny,
        rule_id: None,
        reason: Some(format!(
            "no matching policy rule for tool '{}' — fail-closed deny",
            request.tool
        )),
        cooldown_ms: None,
        cooldown_message: None,
        approval_id: None,
        approval_timeout_ms: None,
        approval_timeout_action: None,
        budget_remaining: None,
        ts: now,
    }
}

/// Evaluate all conditions against a request. All must be true (AND logic).
fn evaluate_conditions(conditions: &[Condition], request: &DecisionRequest) -> bool {
    conditions
        .iter()
        .all(|condition| evaluate_single_condition(condition, request))
}

/// Evaluate a single condition against a request.
fn evaluate_single_condition(condition: &Condition, request: &DecisionRequest) -> bool {
    // Extract the field value from the request
    let field_value = extract_field_value(&condition.field, request);

    match condition.operator {
        ConditionOperator::Equals => {
            let expected = condition
                .value
                .as_ref()
                .and_then(|v| v.as_str())
                .unwrap_or("");
            field_value.as_deref() == Some(expected)
        }
        ConditionOperator::NotEquals => {
            let expected = condition
                .value
                .as_ref()
                .and_then(|v| v.as_str())
                .unwrap_or("");
            // Fail-closed: if the field is missing, the condition fails.
            // A missing field is ambiguous — we do not assume it is "not equal".
            if let Some(ref val) = field_value {
                val.as_str() != expected
            } else {
                false
            }
        }
        ConditionOperator::Matches => {
            let pattern_str = condition
                .pattern
                .as_deref()
                .or_else(|| condition.value.as_ref().and_then(|v| v.as_str()))
                .unwrap_or("");
            if let Some(ref val) = field_value {
                match Glob::new(pattern_str) {
                    Ok(glob) => glob.compile_matcher().is_match(val),
                    Err(_) => false, // invalid glob → condition fails → fail-closed
                }
            } else {
                false
            }
        }
        ConditionOperator::NotMatches => {
            let pattern_str = condition
                .pattern
                .as_deref()
                .or_else(|| condition.value.as_ref().and_then(|v| v.as_str()))
                .unwrap_or("");
            if let Some(ref val) = field_value {
                match Glob::new(pattern_str) {
                    Ok(glob) => !glob.compile_matcher().is_match(val),
                    Err(_) => false,
                }
            } else {
                // No value and not_matches — fail-closed
                false
            }
        }
        ConditionOperator::In => {
            let values = condition
                .value
                .as_ref()
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if let Some(ref val) = field_value {
                values.iter().any(|v| v == val)
            } else {
                false
            }
        }
        ConditionOperator::NotIn => {
            let values = condition
                .value
                .as_ref()
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if let Some(ref val) = field_value {
                !values.iter().any(|v| v == val)
            } else {
                // No value and not_in — fail-closed (field missing = ambiguous)
                false
            }
        }
    }
}

/// Extract a field value from a DecisionRequest for condition evaluation.
fn extract_field_value(field: &str, request: &DecisionRequest) -> Option<String> {
    match field {
        "agent_role" => request.agent_role.clone(),
        "environment" => request.environment.clone(),
        "tool" => Some(request.tool.clone()),
        "agent_name" => request.agent_name.clone(),
        "model" => request.model.clone(),
        "run_id" => Some(request.run_id.clone()),
        _ if field.starts_with("args.") => {
            // Dot-notation into args_redacted
            let path = &field[5..]; // strip "args."
            request
                .args_redacted
                .as_ref()
                .and_then(|args| navigate_json(args, path))
        }
        _ => None,
    }
}

/// Navigate a JSON value using dot-notation path.
fn navigate_json(value: &serde_json::Value, path: &str) -> Option<String> {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = value;
    for part in &parts {
        match current {
            serde_json::Value::Object(map) => {
                current = map.get(*part)?;
            }
            _ => return None,
        }
    }
    match current {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        serde_json::Value::Null => None,
        _ => Some(current.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::budget::BudgetTracker;
    use crate::loop_detector::LoopDetector;
    use crate::policy::Policy;

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
            input_tokens: None,
            output_tokens: None,
            estimated_cost_usd: None,
            environment: None,
            ts: "2026-03-15T00:00:00Z".to_string(),
        }
    }

    fn make_request_with_env(tool: &str, env: &str) -> DecisionRequest {
        let mut req = make_request(tool);
        req.environment = Some(env.to_string());
        req
    }

    fn make_request_with_role(tool: &str, role: &str) -> DecisionRequest {
        let mut req = make_request(tool);
        req.agent_role = Some(role.to_string());
        req
    }

    fn make_policy(yaml: &str) -> CompiledPolicy {
        Policy::from_yaml_str(yaml).expect("test policy should parse")
    }

    #[test]
    fn escalate_to_human_always_allowed() {
        // Even with a "deny all" policy, escalate_to_human must be allowed
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "deny-all"
    action: deny
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();
        let req = make_request("escalate_to_human");
        let resp = evaluate(&req, &policy, &budget, &loop_det);
        assert_eq!(resp.decision, Decision::Allow);
        assert_eq!(
            resp.rule_id.as_deref(),
            Some("__builtin_escalate_to_human_allow")
        );
    }

    #[test]
    fn first_match_wins_ordering() {
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "allow-file-read"
    action: allow
    tool: "file_read"
  - name: "deny-file-read"
    action: deny
    tool: "file_read"
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();
        let req = make_request("file_read");
        let resp = evaluate(&req, &policy, &budget, &loop_det);
        assert_eq!(resp.decision, Decision::Allow);
        assert_eq!(resp.rule_id.as_deref(), Some("allow-file-read"));
    }

    #[test]
    fn glob_pattern_matching_works() {
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "allow-file-ops"
    action: allow
    tool_pattern: "file_*"
  - name: "deny-all"
    action: deny
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();

        let req_read = make_request("file_read");
        let resp_read = evaluate(&req_read, &policy, &budget, &loop_det);
        assert_eq!(resp_read.decision, Decision::Allow);

        let req_write = make_request("file_write");
        let resp_write = evaluate(&req_write, &policy, &budget, &loop_det);
        assert_eq!(resp_write.decision, Decision::Allow);

        let req_http = make_request("http_get");
        let resp_http = evaluate(&req_http, &policy, &budget, &loop_det);
        assert_eq!(resp_http.decision, Decision::Deny);
    }

    #[test]
    fn no_matching_rule_deny_fail_closed() {
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "allow-file-read"
    action: allow
    tool: "file_read"
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();
        let req = make_request("http_post");
        let resp = evaluate(&req, &policy, &budget, &loop_det);
        assert_eq!(resp.decision, Decision::Deny);
        assert!(resp.rule_id.is_none());
        assert!(resp.reason.as_ref().unwrap().contains("fail-closed"));
    }

    #[test]
    fn conditions_evaluated_correctly() {
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "deny-prod-writes"
    action: deny
    tool: "db_write"
    conditions:
      - field: "environment"
        operator: equals
        value: "production"
    reason: "writes blocked in production"
  - name: "allow-db-write"
    action: allow
    tool: "db_write"
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();

        // In production, should be denied
        let req_prod = make_request_with_env("db_write", "production");
        let resp_prod = evaluate(&req_prod, &policy, &budget, &loop_det);
        assert_eq!(resp_prod.decision, Decision::Deny);
        assert_eq!(resp_prod.rule_id.as_deref(), Some("deny-prod-writes"));

        // In staging, condition doesn't match, falls through to allow
        let req_staging = make_request_with_env("db_write", "staging");
        let resp_staging = evaluate(&req_staging, &policy, &budget, &loop_det);
        assert_eq!(resp_staging.decision, Decision::Allow);
        assert_eq!(resp_staging.rule_id.as_deref(), Some("allow-db-write"));
    }

    #[test]
    fn condition_in_operator() {
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "deny-junior"
    action: deny
    tool: "deploy"
    conditions:
      - field: "agent_role"
        operator: in
        value: ["junior", "intern"]
    reason: "junior/intern cannot deploy"
  - name: "allow-deploy"
    action: allow
    tool: "deploy"
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();

        let req_junior = make_request_with_role("deploy", "junior");
        let resp_junior = evaluate(&req_junior, &policy, &budget, &loop_det);
        assert_eq!(resp_junior.decision, Decision::Deny);

        let req_senior = make_request_with_role("deploy", "senior");
        let resp_senior = evaluate(&req_senior, &policy, &budget, &loop_det);
        assert_eq!(resp_senior.decision, Decision::Allow);
    }

    #[test]
    fn condition_not_equals_operator() {
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "allow-non-prod"
    action: allow
    tool: "db_drop"
    conditions:
      - field: "environment"
        operator: not_equals
        value: "production"
  - name: "deny-all"
    action: deny
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();

        let req_staging = make_request_with_env("db_drop", "staging");
        let resp = evaluate(&req_staging, &policy, &budget, &loop_det);
        assert_eq!(resp.decision, Decision::Allow);

        let req_prod = make_request_with_env("db_drop", "production");
        let resp2 = evaluate(&req_prod, &policy, &budget, &loop_det);
        assert_eq!(resp2.decision, Decision::Deny);
    }

    #[test]
    fn not_equals_missing_field_is_fail_closed() {
        // A not_equals condition on a missing field should NOT match (fail-closed).
        // Without this, a missing environment would be treated as "not production",
        // which is ambiguous and violates fail-closed (ADR-002).
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "allow-non-prod"
    action: allow
    tool: "db_drop"
    conditions:
      - field: "environment"
        operator: not_equals
        value: "production"
  - name: "deny-all"
    action: deny
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();

        // No environment set — should fall through to deny-all (fail-closed)
        let req = make_request("db_drop");
        let resp = evaluate(&req, &policy, &budget, &loop_det);
        assert_eq!(
            resp.decision,
            Decision::Deny,
            "missing field on not_equals must be fail-closed"
        );
    }

    #[test]
    fn wildcard_rule_matches_any_tool() {
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "allow-everything"
    action: allow
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();

        let req = make_request("anything_at_all");
        let resp = evaluate(&req, &policy, &budget, &loop_det);
        assert_eq!(resp.decision, Decision::Allow);
    }

    #[test]
    fn require_approval_decision() {
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "approve-deploy"
    action: require_approval
    tool: "deploy"
    timeout: 300
    timeout_action: deny
    reason: "deployments require human approval"
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();

        let req = make_request("deploy");
        let resp = evaluate(&req, &policy, &budget, &loop_det);
        assert_eq!(resp.decision, Decision::RequireApproval);
    }

    #[test]
    fn args_dot_notation_condition() {
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "deny-metadata-url"
    action: deny
    tool: "http_get"
    conditions:
      - field: "args.url"
        operator: equals
        value: "http://169.254.169.254"
    reason: "cloud metadata access blocked"
  - name: "allow-http"
    action: allow
    tool: "http_get"
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();

        let mut req = make_request("http_get");
        req.args_redacted = Some(serde_json::json!({
            "url": "http://169.254.169.254"
        }));
        let resp = evaluate(&req, &policy, &budget, &loop_det);
        assert_eq!(resp.decision, Decision::Deny);

        let mut req2 = make_request("http_get");
        req2.args_redacted = Some(serde_json::json!({
            "url": "https://api.example.com"
        }));
        let resp2 = evaluate(&req2, &policy, &budget, &loop_det);
        assert_eq!(resp2.decision, Decision::Allow);
    }

    #[test]
    fn escalate_to_human_allowed_with_glob_deny_all() {
        // ADR-012 invariant: escalate_to_human must be allowed even when a
        // tool_pattern glob matches every tool name. The bypass fires BEFORE
        // rule evaluation, so no pattern can block it.
        let policy = make_policy(
            r#"
schema_version: 1
rules:
  - name: "deny-all-glob"
    action: deny
    tool_pattern: "*"
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();

        // escalate_to_human must be allowed
        let req = make_request("escalate_to_human");
        let resp = evaluate(&req, &policy, &budget, &loop_det);
        assert_eq!(resp.decision, Decision::Allow);
        assert_eq!(
            resp.rule_id.as_deref(),
            Some("__builtin_escalate_to_human_allow")
        );

        // any other tool should be denied by the glob
        let req2 = make_request("some_other_tool");
        let resp2 = evaluate(&req2, &policy, &budget, &loop_det);
        assert_eq!(resp2.decision, Decision::Deny);
        assert_eq!(resp2.rule_id.as_deref(), Some("deny-all-glob"));
    }

    #[test]
    fn escalate_to_human_allowed_with_budget_exceeded() {
        // ADR-012 invariant: escalate_to_human must be allowed even when the
        // budget hard cap has been exceeded. Agents must always be able to
        // ask a human for help, regardless of budget state.
        let policy = make_policy(
            r#"
schema_version: 1
budget:
  cost_usd:
    hard: 0.01
rules:
  - name: "allow-all"
    action: allow
"#,
        );
        let budget = BudgetTracker::new();
        let loop_det = LoopDetector::new();

        // Pre-record a budget update that exceeds the hard cap.
        // evaluate() checks accumulated state via check_hard_caps_with_config,
        // but does not record — recording happens in enforce() (lib.rs).
        let update = crate::budget::BudgetUpdate {
            cost_usd: 0.02,
            ..Default::default()
        };
        budget.record("test-run-001", &update, policy.policy.budget.as_ref());

        // Now a normal tool call should be killed (budget exceeded)
        let req1 = make_request("expensive_tool");
        let resp1 = evaluate(&req1, &policy, &budget, &loop_det);
        assert_eq!(resp1.decision, Decision::Kill);

        // But escalate_to_human must still be allowed
        let req2 = make_request("escalate_to_human");
        let resp2 = evaluate(&req2, &policy, &budget, &loop_det);
        assert_eq!(resp2.decision, Decision::Allow);
        assert_eq!(
            resp2.rule_id.as_deref(),
            Some("__builtin_escalate_to_human_allow")
        );
    }
}
