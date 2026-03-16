// SPDX-License-Identifier: MIT
//! Policy pack loading and validation.
//!
//! The engine embeds the policy schema at compile time (see build.rs / ADR-003).
//! At startup it loads the user-supplied policy YAML, validates it against the
//! embedded schema, and returns a compiled Policy ready for evaluation.

use std::path::Path;

use globset::{Glob, GlobMatcher};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The raw policy schema JSON, embedded at compile time from packages/schemas/.
pub const POLICY_SCHEMA_JSON: &str =
    include_str!("../../../packages/schemas/policy/policy.schema.json");

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// Errors that can occur during policy loading and validation.
#[derive(Debug, Error)]
pub enum PolicyError {
    #[error("failed to read policy file: {0}")]
    Io(#[from] std::io::Error),

    #[error("failed to parse YAML: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("unsupported schema_version {version} (expected 1)")]
    UnsupportedVersion { version: u32 },

    #[error("policy validation error: {0}")]
    Validation(String),

    #[error("invalid glob pattern in rule '{rule}': {source}")]
    InvalidGlob {
        rule: String,
        source: globset::Error,
    },

    #[error("rule '{rule}' specifies both 'tool' and 'tool_pattern' (mutually exclusive)")]
    ToolAndPatternBoth { rule: String },

    #[error("policy must have at least one rule")]
    EmptyRules,
}

// ---------------------------------------------------------------------------
// Policy structs (matching policy.schema.json)
// ---------------------------------------------------------------------------

/// A deserialized and validated policy pack ready for evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    pub schema_version: u32,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub agent_role: Option<String>,
    #[serde(default)]
    pub environment: Option<String>,
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub budget: Option<BudgetConfig>,
    #[serde(default)]
    pub loop_detection: Option<LoopDetectionConfig>,
    #[serde(default)]
    pub redaction: Option<RedactionConfig>,
}

/// A single policy rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub name: String,
    pub action: RuleAction,
    #[serde(default)]
    pub tool: Option<String>,
    #[serde(default)]
    pub tool_pattern: Option<String>,
    #[serde(default)]
    pub conditions: Option<Vec<Condition>>,
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(default)]
    pub timeout_action: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
}

/// The enforcement action for a rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleAction {
    Allow,
    Deny,
    RequireApproval,
}

/// A condition that must be true for a rule to match.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Condition {
    pub field: String,
    pub operator: ConditionOperator,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    #[serde(default)]
    pub pattern: Option<String>,
}

/// Comparison operators for conditions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConditionOperator {
    Equals,
    NotEquals,
    Matches,
    NotMatches,
    In,
    NotIn,
}

/// Budget configuration with four dimensions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetConfig {
    #[serde(default)]
    pub cost_usd: Option<BudgetDimensionFloat>,
    #[serde(default)]
    pub input_tokens: Option<BudgetDimensionInt>,
    #[serde(default)]
    pub output_tokens: Option<BudgetDimensionInt>,
    #[serde(default)]
    pub call_count: Option<BudgetDimensionInt>,
}

/// Budget dimension for floating-point values (cost_usd).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetDimensionFloat {
    #[serde(default)]
    pub soft: Option<f64>,
    pub hard: f64,
}

/// Budget dimension for integer values (tokens, call_count).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetDimensionInt {
    #[serde(default)]
    pub soft: Option<u64>,
    pub hard: u64,
}

/// Loop detection configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopDetectionConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_window_seconds")]
    pub identical_call_window_seconds: u64,
    #[serde(default = "default_call_threshold")]
    pub identical_call_threshold: u64,
    #[serde(default = "default_error_threshold")]
    pub identical_error_threshold: u64,
    #[serde(default = "default_cooldown_ms")]
    pub cooldown_ms: u64,
}

fn default_true() -> bool {
    true
}
fn default_window_seconds() -> u64 {
    120
}
fn default_call_threshold() -> u64 {
    3
}
fn default_error_threshold() -> u64 {
    3
}
fn default_cooldown_ms() -> u64 {
    5000
}

impl Default for LoopDetectionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            identical_call_window_seconds: 120,
            identical_call_threshold: 3,
            identical_error_threshold: 3,
            cooldown_ms: 5000,
        }
    }
}

/// Redaction configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedactionConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub additional_patterns: Option<Vec<RedactionPattern>>,
    #[serde(default)]
    pub key_patterns: Option<Vec<String>>,
}

impl Default for RedactionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            additional_patterns: None,
            key_patterns: None,
        }
    }
}

/// A custom redaction pattern.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedactionPattern {
    pub name: String,
    pub pattern: String,
    #[serde(default = "default_replacement")]
    pub replacement: String,
}

fn default_replacement() -> String {
    "[REDACTED]".to_string()
}

// ---------------------------------------------------------------------------
// Compiled rule (with pre-built glob matcher)
// ---------------------------------------------------------------------------

/// A rule with a pre-compiled glob matcher for tool_pattern.
#[derive(Debug, Clone)]
pub struct CompiledRule {
    pub rule: Rule,
    pub tool_glob: Option<GlobMatcher>,
}

impl CompiledRule {
    /// Check if the rule's tool or tool_pattern matches the given tool name.
    pub fn matches_tool(&self, tool: &str) -> bool {
        if let Some(exact) = &self.rule.tool {
            return exact == tool;
        }
        if let Some(ref glob) = self.tool_glob {
            return glob.is_match(tool);
        }
        // No tool or tool_pattern means the rule matches any tool.
        true
    }
}

/// A fully compiled policy pack ready for evaluation.
#[derive(Debug, Clone)]
pub struct CompiledPolicy {
    pub policy: Policy,
    pub compiled_rules: Vec<CompiledRule>,
}

// ---------------------------------------------------------------------------
// Policy loading
// ---------------------------------------------------------------------------

impl Policy {
    /// Load and validate a policy from a YAML file path.
    pub fn from_yaml(path: &Path) -> Result<CompiledPolicy, PolicyError> {
        let contents = std::fs::read_to_string(path)?;
        Self::from_yaml_str(&contents)
    }

    /// Parse and validate a policy from a YAML string.
    pub fn from_yaml_str(yaml: &str) -> Result<CompiledPolicy, PolicyError> {
        let policy: Policy = serde_yaml::from_str(yaml)?;
        policy.validate_and_compile()
    }

    /// Validate the deserialized policy and compile glob patterns.
    fn validate_and_compile(self) -> Result<CompiledPolicy, PolicyError> {
        // Validate schema_version
        if self.schema_version != 1 {
            return Err(PolicyError::UnsupportedVersion {
                version: self.schema_version,
            });
        }

        // Validate rules are non-empty
        if self.rules.is_empty() {
            return Err(PolicyError::EmptyRules);
        }

        // Compile rules
        let mut compiled_rules = Vec::with_capacity(self.rules.len());
        for rule in &self.rules {
            // Validate mutual exclusivity of tool and tool_pattern
            if rule.tool.is_some() && rule.tool_pattern.is_some() {
                return Err(PolicyError::ToolAndPatternBoth {
                    rule: rule.name.clone(),
                });
            }

            // Compile glob pattern if present
            let tool_glob = if let Some(ref pattern) = rule.tool_pattern {
                let glob = Glob::new(pattern).map_err(|e| PolicyError::InvalidGlob {
                    rule: rule.name.clone(),
                    source: e,
                })?;
                Some(glob.compile_matcher())
            } else {
                None
            };

            compiled_rules.push(CompiledRule {
                rule: rule.clone(),
                tool_glob,
            });
        }

        // Sort by priority if priorities are set (lower number = higher priority).
        // Rules without priority keep their original order relative to each other
        // and come after rules with explicit priorities.
        compiled_rules.sort_by(|a, b| {
            match (a.rule.priority, b.rule.priority) {
                (Some(pa), Some(pb)) => pa.cmp(&pb),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal, // preserve original order
            }
        });

        Ok(CompiledPolicy {
            policy: self,
            compiled_rules,
        })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_YAML: &str = r#"
schema_version: 1
name: "test-policy"
rules:
  - name: "allow-read"
    action: allow
    tool: "file_read"
  - name: "deny-write"
    action: deny
    tool: "file_write"
    reason: "writes are not allowed"
budget:
  cost_usd:
    soft: 1.0
    hard: 5.0
  call_count:
    hard: 100
loop_detection:
  enabled: true
  identical_call_window_seconds: 60
  identical_call_threshold: 5
  cooldown_ms: 3000
redaction:
  enabled: true
"#;

    #[test]
    fn valid_yaml_loads_successfully() {
        let result = Policy::from_yaml_str(VALID_YAML);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result.err());
        let compiled = result.unwrap();
        assert_eq!(compiled.policy.schema_version, 1);
        assert_eq!(compiled.policy.name.as_deref(), Some("test-policy"));
        assert_eq!(compiled.compiled_rules.len(), 2);
    }

    #[test]
    fn invalid_yaml_returns_error() {
        let bad_yaml = "{{{{not valid yaml";
        let result = Policy::from_yaml_str(bad_yaml);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PolicyError::Yaml(_)));
    }

    #[test]
    fn missing_required_fields_return_error() {
        // Missing rules
        let yaml = r#"
schema_version: 1
"#;
        let result = Policy::from_yaml_str(yaml);
        assert!(result.is_err());
    }

    #[test]
    fn schema_version_mismatch_returns_error() {
        let yaml = r#"
schema_version: 99
rules:
  - name: "test"
    action: allow
"#;
        let result = Policy::from_yaml_str(yaml);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PolicyError::UnsupportedVersion { version: 99 }
        ));
    }

    #[test]
    fn empty_rules_returns_error() {
        let yaml = r#"
schema_version: 1
rules: []
"#;
        let result = Policy::from_yaml_str(yaml);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PolicyError::EmptyRules));
    }

    #[test]
    fn tool_and_tool_pattern_both_returns_error() {
        let yaml = r#"
schema_version: 1
rules:
  - name: "bad-rule"
    action: allow
    tool: "file_read"
    tool_pattern: "file_*"
"#;
        let result = Policy::from_yaml_str(yaml);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PolicyError::ToolAndPatternBoth { .. }
        ));
    }

    #[test]
    fn glob_pattern_compiles() {
        let yaml = r#"
schema_version: 1
rules:
  - name: "allow-file-ops"
    action: allow
    tool_pattern: "file_*"
"#;
        let result = Policy::from_yaml_str(yaml);
        assert!(result.is_ok());
        let compiled = result.unwrap();
        assert!(compiled.compiled_rules[0].matches_tool("file_read"));
        assert!(compiled.compiled_rules[0].matches_tool("file_write"));
        assert!(!compiled.compiled_rules[0].matches_tool("http_get"));
    }

    #[test]
    fn priority_ordering() {
        let yaml = r#"
schema_version: 1
rules:
  - name: "low-priority"
    action: allow
    tool: "file_read"
    priority: 10
  - name: "high-priority"
    action: deny
    tool: "file_read"
    priority: 1
"#;
        let compiled = Policy::from_yaml_str(yaml).unwrap();
        assert_eq!(compiled.compiled_rules[0].rule.name, "high-priority");
        assert_eq!(compiled.compiled_rules[1].rule.name, "low-priority");
    }

    #[test]
    fn budget_config_parses() {
        let compiled = Policy::from_yaml_str(VALID_YAML).unwrap();
        let budget = compiled.policy.budget.as_ref().unwrap();
        let cost = budget.cost_usd.as_ref().unwrap();
        assert_eq!(cost.soft, Some(1.0));
        assert_eq!(cost.hard, 5.0);
        let calls = budget.call_count.as_ref().unwrap();
        assert_eq!(calls.hard, 100);
    }

    #[test]
    fn loop_detection_defaults() {
        let yaml = r#"
schema_version: 1
rules:
  - name: "test"
    action: allow
"#;
        let compiled = Policy::from_yaml_str(yaml).unwrap();
        assert!(compiled.policy.loop_detection.is_none());

        // When provided without all fields, defaults should apply
        let yaml_with_loop = r#"
schema_version: 1
rules:
  - name: "test"
    action: allow
loop_detection:
  enabled: true
"#;
        let compiled2 = Policy::from_yaml_str(yaml_with_loop).unwrap();
        let ld = compiled2.policy.loop_detection.as_ref().unwrap();
        assert!(ld.enabled);
        assert_eq!(ld.identical_call_window_seconds, 120);
        assert_eq!(ld.identical_call_threshold, 3);
        assert_eq!(ld.cooldown_ms, 5000);
    }

    #[test]
    fn conditions_parse() {
        let yaml = r#"
schema_version: 1
rules:
  - name: "env-check"
    action: deny
    tool: "db_query"
    conditions:
      - field: "environment"
        operator: equals
        value: "production"
      - field: "agent_role"
        operator: in
        value: ["junior", "intern"]
"#;
        let compiled = Policy::from_yaml_str(yaml).unwrap();
        let rule = &compiled.compiled_rules[0].rule;
        let conditions = rule.conditions.as_ref().unwrap();
        assert_eq!(conditions.len(), 2);
        assert_eq!(conditions[0].field, "environment");
        assert_eq!(conditions[0].operator, ConditionOperator::Equals);
        assert_eq!(conditions[1].operator, ConditionOperator::In);
    }
}
