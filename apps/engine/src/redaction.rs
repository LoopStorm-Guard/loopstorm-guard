// SPDX-License-Identifier: MIT
//! Redaction engine — sanitize sensitive values before audit logging.
//!
//! Default patterns (always active when redaction is enabled):
//! - API keys: `sk-...`, `pk-...`, `api_...`
//! - Bearer tokens: `Bearer ...`
//! - AWS credentials: `AKIA...`
//! - JWTs: `eyJ...`
//! - Generic secrets: values for keys containing `password`, `secret`, `token`, `key`, `credential`
//!
//! Custom patterns can be added via the policy `redaction` config.

use regex::Regex;
use tracing::debug;

use crate::policy::RedactionConfig;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REDACTED: &str = "[REDACTED]";

/// Sensitive key patterns — if a JSON object key contains any of these
/// substrings (case-insensitive), its value is redacted.
const SENSITIVE_KEY_PATTERNS: &[&str] = &[
    "password",
    "secret",
    "token",
    "key",
    "credential",
    "authorization",
    "auth",
    "api_key",
    "apikey",
    "access_key",
    "private_key",
];

// ---------------------------------------------------------------------------
// Redactor
// ---------------------------------------------------------------------------

/// A compiled redactor with default and custom regex patterns.
#[derive(Debug, Clone)]
pub struct Redactor {
    /// Whether redaction is enabled.
    enabled: bool,
    /// Compiled value-level regex patterns.
    value_patterns: Vec<CompiledPattern>,
    /// Additional key patterns from policy config (in addition to defaults).
    custom_key_patterns: Vec<String>,
}

#[derive(Debug, Clone)]
struct CompiledPattern {
    #[allow(dead_code)]
    name: String,
    regex: Regex,
    replacement: String,
}

impl Redactor {
    /// Create a new redactor from policy config.
    pub fn new(config: Option<&RedactionConfig>) -> Self {
        let enabled = config.map(|c| c.enabled).unwrap_or(true);

        if !enabled {
            return Self {
                enabled: false,
                value_patterns: Vec::new(),
                custom_key_patterns: Vec::new(),
            };
        }

        let mut value_patterns = Vec::new();

        // Default value patterns
        let defaults = [
            (
                "openai_api_key",
                r"sk-[A-Za-z0-9]{20,}",
                REDACTED,
            ),
            (
                "publishable_key",
                r"pk-[A-Za-z0-9]{20,}",
                REDACTED,
            ),
            (
                "api_prefix_key",
                r"api_[A-Za-z0-9]{20,}",
                REDACTED,
            ),
            (
                "bearer_token",
                r"Bearer\s+[A-Za-z0-9\-._~+/]+=*",
                REDACTED,
            ),
            (
                "aws_access_key",
                r"AKIA[0-9A-Z]{16}",
                REDACTED,
            ),
            (
                "jwt",
                r"eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]*",
                REDACTED,
            ),
            (
                "generic_secret_hex",
                r#"(?i)(?:secret|password|token|key|credential)["':\s=]+[A-Fa-f0-9]{32,}"#,
                REDACTED,
            ),
        ];

        for (name, pattern, replacement) in &defaults {
            if let Ok(regex) = Regex::new(pattern) {
                value_patterns.push(CompiledPattern {
                    name: name.to_string(),
                    regex,
                    replacement: replacement.to_string(),
                });
            }
        }

        // Add custom patterns from config
        let mut custom_key_patterns = Vec::new();
        if let Some(config) = config {
            if let Some(ref patterns) = config.additional_patterns {
                for p in patterns {
                    match Regex::new(&p.pattern) {
                        Ok(regex) => {
                            value_patterns.push(CompiledPattern {
                                name: p.name.clone(),
                                regex,
                                replacement: p.replacement.clone(),
                            });
                        }
                        Err(e) => {
                            debug!(
                                pattern_name = %p.name,
                                error = %e,
                                "skipping invalid custom redaction pattern"
                            );
                        }
                    }
                }
            }
            if let Some(ref keys) = config.key_patterns {
                custom_key_patterns = keys.clone();
            }
        }

        Self {
            enabled,
            value_patterns,
            custom_key_patterns,
        }
    }

    /// Redact sensitive values from a JSON value.
    ///
    /// Returns a new value with sensitive data replaced by `[REDACTED]`.
    pub fn redact(&self, value: &serde_json::Value) -> serde_json::Value {
        if !self.enabled {
            return value.clone();
        }
        self.redact_value(value, None)
    }

    /// Recursively redact values.
    fn redact_value(
        &self,
        value: &serde_json::Value,
        parent_key: Option<&str>,
    ) -> serde_json::Value {
        match value {
            serde_json::Value::Object(map) => {
                let mut new_map = serde_json::Map::new();
                for (key, val) in map {
                    if self.is_sensitive_key(key) {
                        new_map
                            .insert(key.clone(), serde_json::Value::String(REDACTED.to_string()));
                    } else {
                        new_map.insert(key.clone(), self.redact_value(val, Some(key)));
                    }
                }
                serde_json::Value::Object(new_map)
            }
            serde_json::Value::Array(arr) => {
                let new_arr: Vec<serde_json::Value> = arr
                    .iter()
                    .map(|v| self.redact_value(v, parent_key))
                    .collect();
                serde_json::Value::Array(new_arr)
            }
            serde_json::Value::String(s) => {
                let redacted = self.redact_string(s);
                serde_json::Value::String(redacted)
            }
            // Numbers, bools, null pass through
            other => other.clone(),
        }
    }

    /// Check if a key name indicates sensitive data.
    fn is_sensitive_key(&self, key: &str) -> bool {
        let lower = key.to_lowercase();

        // Check default sensitive key patterns
        for pattern in SENSITIVE_KEY_PATTERNS {
            if lower.contains(pattern) {
                return true;
            }
        }

        // Check custom key patterns
        for pattern in &self.custom_key_patterns {
            if lower.contains(&pattern.to_lowercase()) {
                return true;
            }
        }

        false
    }

    /// Apply regex patterns to redact sensitive substrings from a string value.
    fn redact_string(&self, input: &str) -> String {
        let mut result = input.to_string();
        for pattern in &self.value_patterns {
            result = pattern
                .regex
                .replace_all(&result, pattern.replacement.as_str())
                .to_string();
        }
        result
    }
}

impl Default for Redactor {
    fn default() -> Self {
        Self::new(None)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn api_keys_are_redacted() {
        let redactor = Redactor::default();
        let input = json!({
            "message": "Using key sk-abcdefghijklmnopqrstuvwxyz1234567890 to call API"
        });
        let result = redactor.redact(&input);
        let msg = result["message"].as_str().unwrap();
        assert!(!msg.contains("sk-abcdefghijklmnopqrstuvwxyz1234567890"));
        assert!(msg.contains(REDACTED));
    }

    #[test]
    fn bearer_tokens_are_redacted() {
        let redactor = Redactor::default();
        let input = json!({
            "header": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        });
        let result = redactor.redact(&input);
        let header = result["header"].as_str().unwrap();
        assert!(!header.contains("eyJ"));
        assert!(header.contains(REDACTED));
    }

    #[test]
    fn aws_credentials_are_redacted() {
        let redactor = Redactor::default();
        let input = json!({
            "key": "My AWS key is AKIAIOSFODNN7EXAMPLE"
        });
        let result = redactor.redact(&input);
        let key_val = result["key"].as_str().unwrap();
        assert!(!key_val.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(key_val.contains(REDACTED));
    }

    #[test]
    fn sensitive_keys_are_redacted() {
        let redactor = Redactor::default();
        let input = json!({
            "username": "john",
            "password": "super_secret_123",
            "api_key": "my-key-value",
            "database_url": "postgres://localhost"
        });
        let result = redactor.redact(&input);
        assert_eq!(result["username"], "john");
        assert_eq!(result["password"], REDACTED);
        assert_eq!(result["api_key"], REDACTED);
        // database_url doesn't match sensitive key patterns
        assert_eq!(result["database_url"], "postgres://localhost");
    }

    #[test]
    fn custom_patterns_work() {
        let config = RedactionConfig {
            enabled: true,
            additional_patterns: Some(vec![crate::policy::RedactionPattern {
                name: "custom-ssn".to_string(),
                pattern: r"\d{3}-\d{2}-\d{4}".to_string(),
                replacement: "[SSN-REDACTED]".to_string(),
            }]),
            key_patterns: None,
        };
        let redactor = Redactor::new(Some(&config));
        let input = json!({
            "ssn": "123-45-6789",
            "name": "John Doe"
        });
        let result = redactor.redact(&input);
        // SSN should be redacted by the custom regex pattern
        let ssn = result["ssn"].as_str().unwrap();
        assert!(!ssn.contains("123-45-6789"));
        assert!(ssn.contains("[SSN-REDACTED]"));
        assert_eq!(result["name"], "John Doe");
    }

    #[test]
    fn non_sensitive_values_preserved() {
        let redactor = Redactor::default();
        let input = json!({
            "count": 42,
            "active": true,
            "tags": ["rust", "security"],
            "name": "LoopStorm Guard",
            "description": "A safety platform"
        });
        let result = redactor.redact(&input);
        assert_eq!(result["count"], 42);
        assert_eq!(result["active"], true);
        assert_eq!(result["tags"], json!(["rust", "security"]));
        assert_eq!(result["name"], "LoopStorm Guard");
    }

    #[test]
    fn nested_objects_redacted_recursively() {
        let redactor = Redactor::default();
        let input = json!({
            "config": {
                "database": {
                    "host": "localhost",
                    "password": "db_secret",
                    "nested": {
                        "api_key": "nested-key-value"
                    }
                }
            }
        });
        let result = redactor.redact(&input);
        assert_eq!(result["config"]["database"]["host"], "localhost");
        assert_eq!(result["config"]["database"]["password"], REDACTED);
        assert_eq!(result["config"]["database"]["nested"]["api_key"], REDACTED);
    }

    #[test]
    fn arrays_redacted_recursively() {
        let redactor = Redactor::default();
        let input = json!({
            "items": [
                {"name": "item1", "secret_key": "abc123"},
                {"name": "item2", "value": "safe"}
            ]
        });
        let result = redactor.redact(&input);
        assert_eq!(result["items"][0]["name"], "item1");
        assert_eq!(result["items"][0]["secret_key"], REDACTED);
        assert_eq!(result["items"][1]["name"], "item2");
        assert_eq!(result["items"][1]["value"], "safe");
    }

    #[test]
    fn disabled_redaction_passes_through() {
        let config = RedactionConfig {
            enabled: false,
            additional_patterns: None,
            key_patterns: None,
        };
        let redactor = Redactor::new(Some(&config));
        let input = json!({
            "password": "super_secret",
            "api_key": "sk-abcdefghijklmnopqrstuvwxyz1234567890"
        });
        let result = redactor.redact(&input);
        // Nothing should be redacted when disabled
        assert_eq!(result["password"], "super_secret");
        assert_eq!(
            result["api_key"],
            "sk-abcdefghijklmnopqrstuvwxyz1234567890"
        );
    }

    #[test]
    fn custom_key_patterns() {
        let config = RedactionConfig {
            enabled: true,
            additional_patterns: None,
            key_patterns: Some(vec!["social_security".to_string(), "dob".to_string()]),
        };
        let redactor = Redactor::new(Some(&config));
        let input = json!({
            "social_security_number": "123-45-6789",
            "date_of_birth": "not matched",
            "dob": "1990-01-01",
            "name": "John"
        });
        let result = redactor.redact(&input);
        assert_eq!(result["social_security_number"], REDACTED);
        assert_eq!(result["dob"], REDACTED);
        assert_eq!(result["name"], "John");
    }

    #[test]
    fn jwt_tokens_redacted_in_strings() {
        let redactor = Redactor::default();
        let jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        let input = json!({
            "data": format!("Token is {}", jwt)
        });
        let result = redactor.redact(&input);
        let data = result["data"].as_str().unwrap();
        assert!(!data.contains("eyJ"));
    }
}
