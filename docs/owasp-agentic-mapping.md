<!-- SPDX-License-Identifier: MIT -->
# OWASP Top 10 for Agentic Applications -- LoopStorm Guard Coverage Mapping

**Version:** 1.1
**Date:** 2026-03-26
**Status:** Peer-reviewed (2026-03-26). Pre-pilot deliverable (required before first enterprise security conversation)

---

## Purpose

This document maps LoopStorm Guard's enforcement capabilities to the OWASP Top 10 for Agentic Applications (2025). It states both what LoopStorm covers and what it does not. Overstated coverage fails security review. Every coverage claim must have a passing test behind it or is explicitly marked as "not yet verified."

---

## Coverage Summary

| OWASP ID | Risk | LoopStorm Coverage | Status |
|---|---|---|---|
| AA1 | Agentic Identity and Access Mismanagement | **Not covered** | Out of scope |
| AA2 | Tool/Function Call Injection | **Covered** | Verified |
| AA3 | Excessive Agency / Uncontrolled Actions | **Covered** | Verified |
| AA4 | Unchecked Tool/Function Return Values | **Partial** | Design-level |
| AA5 | Insecure Agent Communication | **Partial** | Transport-level |
| AA6 | Unconstrained Resource Consumption | **Covered** | Verified |
| AA7 | Memory / Context Manipulation | **Partial** | Indirect |
| AA8 | Lack of Audit and Accountability | **Covered** | Verified |
| AA9 | Agent Collusion / Multi-Agent Exploitation | **Not covered** | Out of scope |
| AA10 | Insufficient Error Handling and Recovery | **Covered** | Verified |

---

## Detailed Mapping

### AA1: Agentic Identity and Access Mismanagement

**Coverage: Not covered.**

LoopStorm Guard does not manage agent identities, credentials, or access control to external systems. The `agent_role` field (ADR-008, v1.1) provides a flat tag for policy scoping, but this is not an identity management system. LoopStorm does not issue credentials, rotate secrets, or enforce least-privilege access to external APIs.

**What would be needed:** Integration with an identity provider, credential vaulting, and per-tool credential scoping. This is outside LoopStorm's architectural scope.

---

### AA2: Tool/Function Call Injection

**Coverage: Covered.**

LoopStorm's policy evaluator intercepts every tool call routed through the integration boundary and evaluates it against explicit allow/deny rules before execution. SSRF patterns, cloud metadata endpoints, and private IP ranges can be denied by policy. The redaction engine prevents sensitive data from leaking into logs.

**What is covered:**
- Tool calls matching deny rules are blocked before execution (Stage 1 Prevent).
- URL pattern matching catches known injection targets (cloud metadata, private ranges).
- Args are fingerprinted (SHA-256 of canonical JSON) for tamper detection.

**What is not covered:**
- Calls that bypass the shim (agent calls the API directly).
- Novel injection patterns not anticipated by the policy author. Stage 5 Adapt (v1.1, not yet implemented) will propose new rules based on observed patterns.
- Content-level injection within tool arguments that does not match any configured pattern.

**Verification:** Case Study 1 (SSRF blocked by policy) is a mandatory pre-ship test.

---

### AA3: Excessive Agency / Uncontrolled Actions

**Coverage: Covered.**

This is LoopStorm Guard's primary design target. The policy evaluator enforces which tools an agent can call, under what conditions, and in which environment. The budget engine caps resource consumption. The loop detector stops non-progress behavior.

**What is covered:**
- Explicit allow/deny rules scope what the agent can do (Stage 1).
- Budget hard caps terminate runs that exceed cost, token, or call-count limits (Stage 4).
- Loop detection identifies and stops repetitive non-progress behavior (Stages 2-3).
- `require_approval` decisions hold sensitive calls for human review (v1, tested in evaluator).
- `agent_role` enables per-role scoping of allowed tools via policy conditions (v1, ADR-008).

**What is not covered:**
- Actions taken outside the LoopStorm integration boundary.
- Semantic understanding of whether an action is "excessive" in context (requires human judgment or AI assessment via Stage 5).

**Verification:** Case Studies 1-3 are mandatory pre-ship tests covering policy deny, budget kill, and loop termination.

---

### AA4: Unchecked Tool/Function Return Values

**Coverage: Partial.**

LoopStorm Guard intercepts tool calls before execution and records decisions, but it does not currently inspect or validate tool return values. The hash chain records what the agent attempted and what decisions were made, but not what tools returned.

**What is covered:**
- The redaction engine processes arguments before logging (input-side protection).
- The event log records the full decision sequence, enabling post-incident analysis of what was attempted.

**What is not covered:**
- Validation of tool return values against expected schemas.
- Detection of poisoned return data that could influence subsequent agent behavior.
- Return-value-based policy rules (e.g., "deny if the previous tool returned sensitive data").

**What would be needed:** A return-value interception point in the shim, with configurable validation rules. This is a potential v2 enhancement.

---

### AA5: Insecure Agent Communication

**Coverage: Partial.**

LoopStorm provides transport-level security for the enforcement plane but does not govern agent-to-agent communication.

**What is covered:**
- Engine-to-shim communication uses a Unix Domain Socket at mode 0600, providing OS-level access control on the same host.
- Engine-to-backend communication uses TLS with API key authentication.
- Event payloads are redacted before transmission to the backend.

**What is not covered:**
- Agent-to-agent communication channels (LoopStorm guards individual agents, not multi-agent topologies).
- MCP transport security (the MCP proxy mode in v1.1/v2 will route through the policy engine but does not add transport-layer protections beyond what MCP provides).
- Encryption of the local JSONL file at rest.

---

### AA6: Unconstrained Resource Consumption

**Coverage: Covered.**

This is directly addressed by the multi-dimensional budget engine (ADR-007).

**What is covered:**
- Hard caps on cost_usd, input_tokens, output_tokens, and call_count per run (Stage 4).
- Soft caps that emit warning events for operational visibility.
- Budget state tracked in every policy_decision event.
- Run termination with safe partial output when any hard cap is breached.
- Loop detection stops repetitive calls that consume resources without progress (Stages 2-3).

**What is not covered:**
- Cross-run budget accumulation (e.g., "$100/day across all runs"). This is a v2 capability.
- Actual provider billing reconciliation. LoopStorm tracks estimated cost, not verified billing.

**Verification:** Case Study 2 (budget hard cap terminates runaway cost) is a mandatory pre-ship test.

---

### AA7: Memory / Context Manipulation

**Coverage: Partial.**

LoopStorm provides indirect protection through its enforcement and audit capabilities but does not directly protect agent memory or context.

**What is covered:**
- The args_hash field records a fingerprint of tool call arguments, enabling detection of argument changes between calls.
- The corrective context injection during loop recovery (Stage 3) is a controlled modification of the agent's context.
- The JSONL audit trail provides evidence of all intercepted calls, supporting post-incident analysis of context manipulation.

**What is not covered:**
- Direct protection of agent memory stores.
- Detection of prompt injection attacks that modify the agent's context through tool return values.
- Verification that the agent's internal context has not been manipulated between calls.

---

### AA8: Lack of Audit and Accountability

**Coverage: Covered.**

This is a core LoopStorm capability.

**What is covered:**
- Every intercepted tool call is recorded in the JSONL event log with a SHA-256 hash chain (Section 8.4 of the product document).
- Events include: tool name, decision, rule ID, budget state, timestamps, args_hash, redacted args.
- The hash chain detects accidental corruption and unsophisticated modification.
- The replay CLI verifies chain integrity locally.
- The hosted backend provides a secondary integrity path with append-only INSERT permissions.
- (v1.1 planned) The AI Supervisor's actions will be audited as first-class events (ADR-012). Not yet implemented.

**What is not covered:**
- Forensic-grade tamper evidence against a motivated adversary with host access. The hash chain alone does not prevent recomputation (see Section 8.4). Signed checkpoint anchoring (v1.1 commercial) strengthens this.
- Audit of calls that bypass the shim.

**Verification:** Case Study 4 (hash chain supports audit review) is a mandatory pre-ship test.

---

### AA9: Agent Collusion / Multi-Agent Exploitation

**Coverage: Not covered.**

LoopStorm Guard operates at the individual agent level. It does not model or detect coordination between multiple agents acting in concert.

**What would be needed:** Cross-agent correlation of tool call patterns, detection of coordinated resource consumption, and multi-agent policy rules. This is outside the current architecture and would require significant design work.

---

### AA10: Insufficient Error Handling and Recovery

**Coverage: Covered.**

LoopStorm Guard's control philosophy (Stages 2-4) directly addresses error handling and recovery.

**What is covered:**
- Loop detection identifies error-retry patterns (Heuristic 2: identical error responses, implemented in `loop_detector.rs`) (Stage 2).
- Cooldown with corrective context injection gives the agent a recovery opportunity (Stage 3).
- Safe termination preserves evidence and partial output when recovery fails (Stage 4).
- Defined failure behaviors for every engine failure scenario (Section 7.3 of the product document).
- Fail-closed on policy evaluation errors (ADR-002).
- Fail-closed on JSONL write failures (ADR-005).
- Configurable fail-open/fail-closed on engine unavailability.

**What is not covered:**
- Application-level error handling within the agent's own code.
- Retry strategies for tool calls (LoopStorm detects bad retries but does not provide good retry logic).

**Verification:** Case Study 3 (looping agent detected and terminated) is a mandatory pre-ship test.

---

## Summary of Gaps

| Gap | Priority | Path to Address |
|---|---|---|
| AA1 (Identity management) | Low -- outside scope | Would require identity provider integration. Not planned. |
| AA4 (Return value validation) | Medium | Potential v2 enhancement: return-value interception in shim. |
| AA5 (Inter-agent communication) | Medium | MCP proxy mode (v1.1/v2) partially addresses MCP transport. |
| AA7 (Context manipulation) | Medium | Indirect coverage through audit trail. Direct protection would require agent-internal instrumentation. |
| AA9 (Agent collusion) | Low -- outside scope | Would require cross-agent correlation. Not planned for v1/v2. |

---

## Honest Limitations Statement

LoopStorm Guard is a runtime enforcement layer for cooperative systems. It enforces controls on calls routed through its integration boundary, on a host that has not been compromised, with a healthy engine process. It is not a security perimeter against adversarial agents. It does not replace identity management, network security, or application-level input validation. Its coverage claims apply within its documented trust boundary (product document Section 7).

Features marked "(v1.1)" in this document are designed and specified but not yet implemented. Coverage claims for those features become valid only after implementation and test verification.
