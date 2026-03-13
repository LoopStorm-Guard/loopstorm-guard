<!-- SPDX-License-Identifier: MIT -->
# ADR-003: Policy Schema Single Source of Truth

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

The policy YAML schema is consumed by multiple components:

1. The Rust engine (validates and evaluates policy at runtime).
2. The backend API (validates policy uploads).
3. The CLI (validates policy files locally).
4. The web UI (renders policy rules for display).
5. Documentation and developer tooling.

If each consumer maintains its own understanding of the policy schema, drift is inevitable. A valid policy in one consumer may be invalid in another.

---

## Decision

The JSON Schema file at `schemas/policy/policy.schema.json` is the **single source of truth** for the policy YAML schema.

All consumers must derive their validation logic from this file:

- The Rust engine embeds the schema at build time. The engine's `build.rs` must assert that the SHA-256 hash of `schemas/policy/policy.schema.json` matches a pinned value. If the schema changes without updating the pinned hash, the engine build fails.
- The backend API validates uploaded policy files against the same schema.
- The CLI uses the same schema for local validation.
- The web UI renders policy structure based on the schema definition.

Schema changes follow this process:

1. The schema file is updated with a `schema_version` bump.
2. A backward-compatibility fixture test is added (prior version policy files must still validate or produce a clear migration error).
3. All consumer PRs are tagged and must update before the schema change merges.
4. The engine's pinned hash in `build.rs` is updated.
5. CI enforces the hash match.

---

## Consequences

**Positive:**
- One file governs all validation. No drift between consumers.
- Schema changes are visible in version control as changes to a single file.
- CI catches any engine build where the schema has changed without acknowledgment.

**Negative:**
- The engine build depends on an external file path. The build process must be configured to find the schema file relative to the monorepo root.
- Schema changes require coordinated updates across multiple consumers. This is intentional friction that prevents accidental breaking changes.

---

## Migration Path

If the policy schema needs to support multiple versions simultaneously (e.g., during a migration period), the engine must support loading policies with a `schema_version` field and applying the correct validation rules for each version. The single-source schema file may contain version-conditional definitions using JSON Schema's `if/then/else` or a version-discriminated union.
