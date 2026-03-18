// SPDX-License-Identifier: MIT
//! Replay command — pretty-prints audit log events with chain verification.
//!
//! `loopstorm replay audit.jsonl` reads a JSONL audit log, verifies the hash
//! chain (unless `--no-verify`), and displays each event in a human-readable
//! format with terminal colors.

use std::path::Path;

use colored::Colorize;
use loopstorm_engine::AuditEvent;

use crate::output::{EXIT_FAIL, EXIT_IO_ERROR, EXIT_OK};
use crate::verify;

/// Run the `replay` subcommand.
pub fn run_replay(path: &Path, no_verify: bool, json: bool) -> u8 {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            if json {
                println!("{}", serde_json::json!({"error": e.to_string()}));
            } else {
                eprintln!("{}: {}", "ERROR".red().bold(), e);
            }
            return EXIT_IO_ERROR;
        }
    };

    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();

    // JSON mode: output events as a JSON array
    if json {
        return run_replay_json(path, &lines, no_verify);
    }

    // Pretty-print mode
    for (i, line) in lines.iter().enumerate() {
        match serde_json::from_str::<AuditEvent>(line) {
            Ok(event) => print_event(i + 1, &event),
            Err(e) => {
                eprintln!(
                    "{}: malformed JSON at line {}: {}",
                    "ERROR".red().bold(),
                    i + 1,
                    e
                );
                return EXIT_IO_ERROR;
            }
        }
    }

    // Chain verification
    if !no_verify {
        match verify::verify_chain(path) {
            Ok(result) if result.valid => {
                println!(
                    "--- Chain: {} ({} events verified) ---",
                    "OK".green().bold(),
                    result.event_count
                );
                EXIT_OK
            }
            Ok(result) => {
                let line = result.break_at_line.unwrap_or(0);
                println!("--- {} at line {} ---", "CHAIN BREAK".red().bold(), line);
                if let Some(ref expected) = result.expected_hash {
                    println!("    expected hash_prev: {}", expected);
                }
                if let Some(ref actual) = result.actual_hash {
                    println!("    actual hash_prev:   {}", actual);
                }
                let remaining = lines.len().saturating_sub(line);
                if remaining > 0 {
                    println!("    ({} remaining event(s) not displayed)", remaining);
                }
                EXIT_FAIL
            }
            Err(e) => {
                eprintln!("{}: {}", "ERROR".red().bold(), e);
                EXIT_IO_ERROR
            }
        }
    } else {
        EXIT_OK
    }
}

/// JSON output mode for replay.
fn run_replay_json(path: &Path, lines: &[&str], no_verify: bool) -> u8 {
    let mut events = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(v) => events.push(v),
            Err(e) => {
                println!(
                    "{}",
                    serde_json::json!({"error": format!("malformed JSON at line {}: {}", i + 1, e)})
                );
                return EXIT_IO_ERROR;
            }
        }
    }

    if no_verify {
        println!("{}", serde_json::json!(events));
        return EXIT_OK;
    }

    match verify::verify_chain(path) {
        Ok(result) if result.valid => {
            println!(
                "{}",
                serde_json::json!({
                    "events": events,
                    "chain_valid": true,
                    "event_count": result.event_count
                })
            );
            EXIT_OK
        }
        Ok(result) => {
            println!(
                "{}",
                serde_json::json!({
                    "events": events,
                    "chain_valid": false,
                    "break_at_line": result.break_at_line,
                    "error": result.error
                })
            );
            EXIT_FAIL
        }
        Err(e) => {
            println!("{}", serde_json::json!({"error": e.to_string()}));
            EXIT_IO_ERROR
        }
    }
}

/// Pretty-print a single audit event.
fn print_event(num: usize, event: &AuditEvent) {
    let ts = event.ts.dimmed();
    let event_type = event.event_type.blue();

    println!("[{}] {}  {}  run={}", num, ts, event_type, event.run_id);

    match event.event_type.as_str() {
        "system_event" => {
            if let Some(ref status) = event.run_status {
                println!("    status: {}", status);
            }
        }
        "policy_decision" => {
            let mut parts = Vec::new();
            if let Some(ref tool) = event.tool {
                parts.push(format!("tool: {}", tool));
            }
            if let Some(ref decision) = event.decision {
                let colored = match decision.as_str() {
                    "allow" => decision.green().to_string(),
                    "deny" | "kill" => decision.red().to_string(),
                    "cooldown" => decision.yellow().to_string(),
                    _ => decision.to_string(),
                };
                parts.push(format!("decision: {}", colored));
            }
            if let Some(ref rule_id) = event.rule_id {
                parts.push(format!("rule: {}", rule_id));
            }
            if let Some(latency) = event.latency_ms {
                parts.push(format!("({:.1}ms)", latency));
            }
            println!("    {}", parts.join("  "));
            if let Some(ref reason) = event.reason {
                println!("    reason: \"{}\"", reason);
            }
        }
        "budget_soft_cap_warning" => {
            if let Some(ref dim) = event.dimension {
                print!("    dimension: {}", dim);
            }
            if let Some(ref reason) = event.reason {
                print!("  {}", reason);
            }
            println!();
        }
        _ => {
            if let Some(ref reason) = event.reason {
                println!("    {}", reason);
            }
        }
    }
    println!();
}
