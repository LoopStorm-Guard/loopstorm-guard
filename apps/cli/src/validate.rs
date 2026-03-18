// SPDX-License-Identifier: MIT
//! Policy validation command.
//!
//! Loads a policy YAML file using the engine's `Policy::from_yaml()` and
//! prints a summary of the policy configuration.

use std::path::Path;

use crate::output::{EXIT_FAIL, EXIT_IO_ERROR, EXIT_OK};

/// Run the `validate` subcommand.
pub fn run_validate(path: &Path, quiet: bool, json: bool) -> u8 {
    use colored::Colorize;
    use loopstorm_engine::policy::Policy;
    use loopstorm_engine::POLICY_SCHEMA_HASH;

    match Policy::from_yaml(path) {
        Ok(compiled) => {
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "valid": true,
                        "name": compiled.policy.name,
                        "rules": compiled.compiled_rules.len(),
                        "schema_hash": POLICY_SCHEMA_HASH
                    })
                );
            } else if !quiet {
                println!("{}: {}", "OK".green().bold(), path.display());
                if let Some(ref name) = compiled.policy.name {
                    println!("  name:           \"{}\"", name);
                }
                println!("  rules:          {}", compiled.compiled_rules.len());

                // Budget summary
                if let Some(ref budget) = compiled.policy.budget {
                    let mut parts = Vec::new();
                    if let Some(ref cost) = budget.cost_usd {
                        if let Some(soft) = cost.soft {
                            parts.push(format!(
                                "cost_usd: soft={:.2} hard={:.2}",
                                soft, cost.hard
                            ));
                        } else {
                            parts.push(format!("cost_usd: hard={:.2}", cost.hard));
                        }
                    }
                    if let Some(ref tokens) = budget.input_tokens {
                        parts.push(format!("input_tokens: hard={}", tokens.hard));
                    }
                    if let Some(ref tokens) = budget.output_tokens {
                        parts.push(format!("output_tokens: hard={}", tokens.hard));
                    }
                    if let Some(ref calls) = budget.call_count {
                        parts.push(format!("call_count: hard={}", calls.hard));
                    }
                    if !parts.is_empty() {
                        println!("  budget:         {}", parts.join(", "));
                    }
                }

                // Loop detection summary
                if let Some(ref ld) = compiled.policy.loop_detection {
                    if ld.enabled {
                        println!(
                            "  loop_detection: enabled (threshold={}, window={}s, cooldown={}ms)",
                            ld.identical_call_threshold,
                            ld.identical_call_window_seconds,
                            ld.cooldown_ms
                        );
                    } else {
                        println!("  loop_detection: disabled");
                    }
                }

                println!("  schema_hash:    {}", POLICY_SCHEMA_HASH);
            }
            EXIT_OK
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
                eprintln!("{}: {}", "FAIL".red().bold(), path.display());
                eprintln!("  error: {}", e);
            }
            match e {
                loopstorm_engine::PolicyError::Io(_) => EXIT_IO_ERROR,
                _ => EXIT_FAIL,
            }
        }
    }
}
