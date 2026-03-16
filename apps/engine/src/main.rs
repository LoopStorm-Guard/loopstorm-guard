// SPDX-License-Identifier: MIT
//! loopstorm-engine binary entry point.
//!
//! The engine is the air-gappable enforcement core (Mode 0). It must never
//! make outbound network calls itself — event forwarding to the hosted
//! backend is handled by the shim or a separate forwarder process.
//!
//! Usage:
//!   loopstorm-engine --policy <path> [--socket <path>] [--audit-log <path>]
//!   loopstorm-engine --version
//!   loopstorm-engine --validate-policy --policy <path>

use std::path::PathBuf;
#[cfg(unix)]
use std::sync::Arc;

use clap::Parser;
#[cfg(unix)]
use tokio::sync::Mutex;
use tracing::{error, info};

use loopstorm_engine::{EnforcementContext, POLICY_SCHEMA_HASH};

/// LoopStorm Guard enforcement engine.
///
/// Listens on a Unix Domain Socket for DecisionRequest messages and returns
/// DecisionResponse messages. Policy is evaluated locally with no network calls.
#[derive(Parser, Debug)]
#[command(name = "loopstorm-engine")]
#[command(about = "LoopStorm Guard enforcement engine — air-gappable policy evaluation")]
#[command(disable_version_flag = true)]
struct Cli {
    /// Path to the policy YAML file.
    #[arg(long, required_unless_present = "version")]
    policy: Option<PathBuf>,

    /// Unix Domain Socket path to listen on.
    /// Override with LOOPSTORM_SOCKET environment variable.
    #[arg(long, env = "LOOPSTORM_SOCKET", default_value = "/tmp/loopstorm-engine.sock")]
    socket: PathBuf,

    /// JSONL audit log output path.
    #[arg(long, default_value = "./loopstorm-audit.jsonl")]
    audit_log: PathBuf,

    /// Log level: trace, debug, info, warn, error.
    #[arg(long, default_value = "info")]
    log_level: String,

    /// Print version information (including embedded policy schema hash) and exit.
    #[arg(long)]
    version: bool,

    /// Validate the policy file and exit. Requires --policy.
    #[arg(long, requires = "policy")]
    validate_policy: bool,

    /// Remove a stale socket file before starting. Without this flag, the engine
    /// refuses to start if the socket path already exists.
    #[arg(long)]
    force: bool,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    // --version: print version + embedded schema hash, then exit.
    if cli.version {
        println!(
            "loopstorm-engine {} (policy schema: {})",
            env!("CARGO_PKG_VERSION"),
            POLICY_SCHEMA_HASH,
        );
        std::process::exit(0);
    }

    // Initialise tracing subscriber.
    let log_level = cli.log_level.as_str();
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(log_level));
    tracing_subscriber::fmt().with_env_filter(filter).init();

    // --policy is guaranteed by clap (required_unless_present = "version").
    let policy_path = cli.policy.expect("--policy is required");

    // --validate-policy: parse/compile policy and exit.
    if cli.validate_policy {
        match loopstorm_engine::policy::Policy::from_yaml(&policy_path) {
            Ok(_) => {
                println!("policy OK: {}", policy_path.display());
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("policy validation failed: {}", e);
                std::process::exit(1);
            }
        }
    }

    // Socket existence check — refuse to start if the socket file already exists,
    // unless --force is passed (which removes the stale socket first).
    // This prevents socket hijacking attacks.
    if cli.socket.exists() {
        if cli.force {
            info!(socket = %cli.socket.display(), "removing stale socket (--force)");
            if let Err(e) = std::fs::remove_file(&cli.socket) {
                error!(socket = %cli.socket.display(), error = %e, "failed to remove stale socket");
                std::process::exit(1);
            }
        } else {
            eprintln!(
                "error: socket file already exists at {}\n\
                 If the engine is not running, remove it manually or use --force.",
                cli.socket.display()
            );
            std::process::exit(1);
        }
    }

    // Create the enforcement context.
    let ctx = match EnforcementContext::new(&policy_path, &cli.audit_log) {
        Ok(c) => {
            info!(
                policy = %policy_path.display(),
                audit_log = %cli.audit_log.display(),
                "enforcement context initialised"
            );
            c
        }
        Err(e) => {
            error!(error = %e, "failed to initialise enforcement context");
            std::process::exit(1);
        }
    };

    // Start the server. On Unix, wrap the context in Arc<Mutex> and run the
    // UDS server. On Windows, print an error and exit (named pipe support is P2).
    #[cfg(unix)]
    {
        let ctx = Arc::new(Mutex::new(ctx));
        if let Err(e) = loopstorm_engine::server::run_server(&cli.socket, ctx).await {
            error!(error = %e, "server error");
            std::process::exit(1);
        }
    }

    #[cfg(not(unix))]
    {
        // Suppress unused variable warning on non-unix targets.
        let _ = ctx;
        eprintln!("error: Windows named pipe support is not yet implemented.");
        eprintln!("See specs/ipc-wire-format.md §2.2 for the planned Windows implementation.");
        std::process::exit(1);
    }
}
