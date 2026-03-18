// SPDX-License-Identifier: MIT
//! loopstorm — LoopStorm Guard CLI.
//!
//! Subcommands:
//!   loopstorm validate <policy.yaml>   — validate a policy file
//!   loopstorm verify  <audit.jsonl>    — verify audit log hash chain
//!   loopstorm replay  <audit.jsonl>    — pretty-print audit log events
//!   loopstorm version                  — print version and schema hash

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "loopstorm",
    about = "LoopStorm Guard CLI — policy validation, audit verification, agent wrapping",
    version = env!("CARGO_PKG_VERSION"),
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Validate a policy YAML file
    Validate {
        #[arg(help = "Path to policy YAML file")]
        policy: PathBuf,
        #[arg(long, short, help = "Suppress detailed output")]
        quiet: bool,
        #[arg(long, help = "Output as JSON")]
        json: bool,
    },
    /// Verify hash chain integrity of a JSONL audit log
    Verify {
        #[arg(help = "Path to JSONL audit log file")]
        audit_log: PathBuf,
        #[arg(long, short, help = "Suppress detailed output")]
        quiet: bool,
        #[arg(long, help = "Output as JSON")]
        json: bool,
    },
    /// Replay and display audit log events
    Replay {
        #[arg(help = "Path to JSONL audit log file")]
        audit_log: PathBuf,
        #[arg(long, help = "Skip hash chain verification")]
        no_verify: bool,
        #[arg(long, help = "Output as JSON array")]
        json: bool,
    },
    /// Print version and embedded policy schema hash
    Version,
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    let code = match cli.command {
        Commands::Validate {
            policy,
            quiet,
            json,
        } => loopstorm_cli::validate::run_validate(&policy, quiet, json),
        Commands::Verify {
            audit_log,
            quiet,
            json,
        } => loopstorm_cli::verify::run_verify(&audit_log, quiet, json),
        Commands::Replay {
            audit_log,
            no_verify,
            json,
        } => loopstorm_cli::replay::run_replay(&audit_log, no_verify, json),
        Commands::Version => {
            println!(
                "loopstorm {} (policy schema: {})",
                env!("CARGO_PKG_VERSION"),
                loopstorm_engine::POLICY_SCHEMA_HASH,
            );
            0
        }
    };

    ExitCode::from(code)
}
