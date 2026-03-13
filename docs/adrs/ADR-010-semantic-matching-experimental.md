<!-- SPDX-License-Identifier: MIT -->
# ADR-010: Semantic Policy Matching Is Experimental

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

Deterministic policy matching (exact string match, glob patterns) works for well-defined tool surfaces where tool names and argument structures are known at policy-authoring time. However, as agent tool surfaces grow and tool names become dynamic (e.g., MCP servers registering tools at runtime), operators may want to express policies like "deny any tool call that accesses production data" without enumerating every possible tool name.

Semantic matching — using vector embeddings (e.g., pgvector) to match tool descriptions against policy intent — could address this. But it introduces non-determinism into the enforcement path, which violates the product's core architectural principle.

---

## Decision

Semantic policy matching using pgvector or similar embedding-based approaches is classified as **experimental** and is a **v2 capability**. It is explicitly not part of v1 or v1.1.

If implemented in v2:
1. Semantic matching must operate as a **secondary matching layer** that runs after deterministic matching. Deterministic rules always take precedence.
2. Semantic matches must produce a confidence score. Matches below a configurable threshold are treated as no-match (fail-closed applies).
3. Semantic matching must never be the sole basis for an `allow` decision. It may inform `deny` or `require_approval` decisions.
4. All semantic match decisions must be logged with the confidence score, the matched embedding, and the deterministic fallback result.
5. Semantic matching requires the hosted backend (pgvector). It is not available in Mode 0.

The enforcement plane remains deterministic. Semantic matching is an observation-plane augmentation that can recommend policy changes, not an enforcement-plane decision mechanism.

---

## Consequences

**Positive:**
- Preserves the deterministic enforcement guarantee for v1 and v1.1.
- Provides a clear path for future enhancement without architectural compromise.
- Prevents premature complexity in the policy evaluator.

**Negative:**
- Operators with dynamic tool surfaces must maintain larger glob-based policy packs until semantic matching is available.
- The v2 timeline for semantic matching is uncertain. Operators asking for this capability today must use deterministic patterns.

---

## Migration Path

When semantic matching is introduced in v2, existing policy packs remain valid. Semantic matching is additive — it applies to tool calls that did not match any deterministic rule. The `policy.schema.json` will be extended with an optional `semantic_rules` block alongside the existing `rules` block. Policy packs without `semantic_rules` behave exactly as before.
