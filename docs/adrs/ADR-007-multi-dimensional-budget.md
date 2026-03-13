<!-- SPDX-License-Identifier: MIT -->
# ADR-007: Multi-Dimensional Budget Enforcement

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

Agent runs can fail in multiple cost dimensions simultaneously. A single-dimension budget (e.g., dollar cost only) misses scenarios where:

- An agent makes thousands of cheap calls (low cost, high call count).
- An agent consumes enormous token volumes on a free-tier model (high tokens, zero cost).
- An agent stays within cost but makes an excessive number of tool calls with side effects.

A budget system that only tracks one dimension provides incomplete protection.

---

## Decision

Budget enforcement is **multi-dimensional**. Each run operates under independent caps across the following dimensions:

| Dimension | Unit | Description |
|---|---|---|
| `cost_usd` | USD (float) | Estimated API cost based on model pricing tables |
| `input_tokens` | integer | Total input/prompt tokens consumed |
| `output_tokens` | integer | Total output/completion tokens consumed |
| `call_count` | integer | Total number of tool calls intercepted |

Each dimension supports two thresholds:

- **`soft`**: Emits a `budget_soft_cap_warning` event. The run continues. This is for operational visibility.
- **`hard`**: Emits a `budget_exceeded` event and returns a `kill` decision. The run terminates.

Dimensions are independent. A breach in any single dimension triggers its respective action. There is no composite scoring or weighting across dimensions.

Budget configuration is specified in the policy pack under the `budget` block. All dimensions are optional. An omitted dimension means no cap is applied for that dimension.

Cost estimation uses model pricing tables embedded in the engine binary. These tables are updated with engine releases. The estimated cost may differ from the provider's actual billed amount.

---

## Consequences

**Positive:**
- Protection against multiple failure modes simultaneously.
- Operators can set tight call_count caps even when cost caps are generous.
- Each dimension is independently understandable and configurable.
- Soft caps provide early warning without disrupting healthy runs.

**Negative:**
- More configuration surface for operators. Documentation must provide sensible defaults and guidance for common agent profiles.
- Cost estimation is inherently approximate. Operators must understand this is not a billing control.
- Adding new dimensions in the future requires schema changes (see Migration Path).

---

## Migration Path

New budget dimensions (e.g., `wall_clock_seconds`, `external_api_calls`) can be added by extending the `budget` block in the policy schema. Existing policy files that omit new dimensions remain valid (no cap on the new dimension). This is backward-compatible by design.

Cross-run budget accumulation (e.g., "$100/day across all runs for agent X") is a v2 capability that requires persistent state outside the engine process. The per-run budget model in v1 is independent of cross-run accumulation and will not be replaced by it.
