// SPDX-License-Identifier: MIT
//! loopstorm-cli — command-line interface for LoopStorm Guard.
//!
//! Subcommands (to be implemented):
//!   loopstorm validate <policy.yaml>   — validate a policy file locally
//!   loopstorm verify  <audit.jsonl>    — verify audit log chain integrity
//!   loopstorm run     <agent-cmd>      — wrap an agent command with enforcement
//!   loopstorm version                  — print version and policy schema hash

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
    /// Validate a policy YAML file against the embedded schema
    Validate {
        #[arg(help = "Path to policy YAML file")]
        policy: String,
    },
    /// Verify the hash chain integrity of a JSONL audit log
    Verify {
        #[arg(help = "Path to JSONL audit log file")]
        audit_log: String,
    },
    /// Print version and embedded policy schema hash
    Version,
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Validate { policy } => {
            println!("Validating policy: {}", policy);
            // TODO(cli): load policy YAML, validate against engine schema
        }
        Commands::Verify { audit_log } => {
            println!("Verifying audit log: {}", audit_log);
            // TODO(cli): read JSONL, verify hash chain
        }
        Commands::Version => {
            println!(
                "loopstorm {} (policy schema: {})",
                env!("CARGO_PKG_VERSION"),
                loopstorm_engine::POLICY_SCHEMA_HASH,
            );
        }
    }
}
