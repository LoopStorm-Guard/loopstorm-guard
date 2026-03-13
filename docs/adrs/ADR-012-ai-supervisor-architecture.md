<!-- SPDX-License-Identifier: MIT -->
# ADR-012: AI Supervisor Agent Architecture

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

Platform vendors (AWS Bedrock Guardrails, Azure AI Safety, GCP Vertex controls) will ship functionally equivalent deterministic enforcement as a bundled feature by late 2026. A product whose moat is "rules + budget caps + audit trail" cannot win that race.

The commercial moat must shift from "hosted control plane" to "AI Supervisor Agent + cross-customer intelligence network effects." The AI Supervisor Agent is the product's survival mechanism and its primary commercial differentiation.

At the same time, the product's deepest architectural truth is that enforcement integrity must not depend on AI reliability. The deterministic enforcement core (Stages 1-4) must remain completely independent of the AI Supervisor (Stage 5).

---

## Decision

The AI Supervisor Agent is a first-class AI agent that runs on the **observation plane only**. It is the product's commercial moat and its adaptive intelligence layer.

### Plane Separation (Inviolable)

```
ENFORCEMENT PLANE (P99 < 5ms, deterministic):
  [Agent] -> [Shim] -> [Engine] -> [Decision] -> [JSONL]

  The supervisor has NO access to this plane.
  The supervisor CANNOT intercept, modify, or delay decisions.

OBSERVATION PLANE (async, seconds-to-minutes, AI-assisted):
  [JSONL / Event Store] -> [Supervisor Tools] -> [Supervisor Agent]
                                                      |
                          [Risk Narratives / Proposals / Escalations]
                                                      |
                                          [Human Approval Queue]
                                                      |
                              [Deterministic Core Update (if approved)]
```

The enforcement plane and observation plane separation is **permanent and inviolable**. The supervisor has no access to the enforcement plane's IPC channel. It cannot call it regardless of policy configuration. Merging them is explicitly out of scope in all versions.

### Self-Guarded Execution

The supervisor runs through `loopstorm.wrap()` with its own policy pack (`supervisor-policy.yaml`) and its own JSONL audit trail. It is itself guarded by the same deterministic enforcement core it observes. This is the product's recursive trust proposition.

### Budget Cap

The supervisor has a **$2.00/session hard budget cap** (configurable). It uses a haiku-class model by default for cost efficiency.

### Tool Set (v1.1 MVP)

| Category | Tools | Policy |
|---|---|---|
| OBSERVATION | `read_run_events`, `read_agent_baseline`, `read_policy_pack`, `query_similar_runs` | Always allowed |
| INTERPRETATION | `compute_risk_score`, `analyze_loop_pattern`, `evaluate_recovery_effectiveness` | Always allowed |
| PROPOSAL | `propose_budget_adjustment`, `flag_for_review` | `require_approval` (human must approve) |
| ESCALATION | `escalate_to_human` | **Always allowed — NEVER blocked by any policy rule** |
| LEARNING | `record_incident_pattern`, `update_agent_profile`, `record_intervention_outcome` | Always allowed |

### escalate_to_human Invariant

`escalate_to_human` must **never** be blocked by any policy rule — not the supervisor's policy, not any future policy configuration, not any administrative override. If the supervisor cannot escalate, the human-in-the-loop guarantee breaks. This invariant must be enforced in:

1. The policy schema (validation rejects any rule that would deny `escalate_to_human`).
2. The engine (hardcoded allow for `escalate_to_human` regardless of policy evaluation).
3. CI tests (fixture test that verifies `escalate_to_human` is allowed under every policy configuration).

### Proposals Require Human Approval

All supervisor proposals (budget adjustments, policy changes) require human approval before taking effect. The supervisor cannot autonomously modify any policy, budget, or enforcement rule. Approved proposals are applied to the deterministic core by a separate, human-gated process.

### Supervisor Audit Trail

Every supervisor action is a first-class JSONL event in the standard event schema. Supervisor event types:
- `supervisor_run_started`
- `supervisor_tool_call`
- `supervisor_proposal_created`
- `supervisor_escalation_created`

The supervisor's run is auditable with the same chain verification as any other run.

### Trigger Conditions

**Post-run (Mode A):** Run terminates with budget breach, loop detection, abandonment, deny decisions, or cost > 80% of cap.

**Mid-run (Mode B, v1.1):** Budget crosses 70% of hard cap, loop detection fires, deny rate exceeds 3x agent baseline, same rule fires 3+ times.

---

## Consequences

**Positive:**
- The commercial moat compounds with data. Every run feeds patterns that make the supervisor smarter.
- The recursive trust story is the product's deepest selling point: the supervisor eats its own cooking.
- Enforcement integrity is never dependent on AI reliability.
- The supervisor is visible, auditable, and constrained — addressing enterprise trust concerns.

**Negative:**
- Supervisor LLM costs at scale require careful management. Mitigated by $2.00/session cap and trigger-based activation (not every run).
- The observation plane introduces latency between incident detection and human notification. This is acceptable because the enforcement plane has already handled the immediate threat.
- Complexity of maintaining two planes with clean separation requires ongoing architectural discipline.

---

## Migration Path

The supervisor's tool set will expand in v2 (cross-customer intelligence, policy proposals, configurability). The plane separation is permanent — expansions add tools to the observation plane, never to the enforcement plane.

If the supervisor architecture needs to change (e.g., different LLM, different trigger model), the change is contained to the observation plane. The enforcement core is unaffected.
