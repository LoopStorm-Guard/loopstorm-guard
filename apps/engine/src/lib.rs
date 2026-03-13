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

pub mod decision;
pub mod policy;
