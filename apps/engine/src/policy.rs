// SPDX-License-Identifier: MIT
//! Policy pack loading and validation.
//!
//! The engine embeds the policy schema at compile time (see build.rs / ADR-003).
//! At startup it loads the user-supplied policy YAML, validates it against the
//! embedded schema, and returns a compiled PolicyPack ready for evaluation.
//!
//! include_str! path is relative to the source file (apps/engine/src/policy.rs),
//! so we go up three levels to reach the workspace root, then into
//! packages/schemas/policy/.

/// The raw policy schema JSON, embedded at compile time from packages/schemas/.
pub const POLICY_SCHEMA_JSON: &str =
    include_str!("../../../packages/schemas/policy/policy.schema.json");

// TODO(engine): implement PolicyPack struct and from_yaml() constructor
// TODO(engine): implement rule evaluation (first-match-wins, ADR-002)
// TODO(engine): implement budget tracking (ADR-007)
// TODO(engine): implement loop detection heuristics
