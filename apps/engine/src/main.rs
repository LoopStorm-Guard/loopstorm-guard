// SPDX-License-Identifier: MIT
//! loopstorm-engine binary entry point.
//!
//! The engine is the air-gappable enforcement core (Mode 0). It must never
//! make outbound network calls itself — event forwarding to the hosted
//! backend is handled by the shim or a separate forwarder process.

fn main() {
    // TODO(platform): initialise tracing subscriber
    // TODO(engine): parse CLI flags (socket path, policy path, log level)
    // TODO(engine): load and validate policy pack against embedded schema
    // TODO(engine): start UDS listener loop
    println!(
        "loopstorm-engine {} (policy schema: {})",
        env!("CARGO_PKG_VERSION"),
        loopstorm_engine::POLICY_SCHEMA_HASH,
    );
}
