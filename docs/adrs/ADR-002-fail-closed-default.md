<!-- SPDX-License-Identifier: MIT -->
# ADR-002: Fail-Closed Default for Policy Evaluation

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

The policy evaluator in the Rust engine must handle several ambiguous states:

1. The policy pack file cannot be loaded or parsed.
2. The policy pack loads but contains no rules.
3. A tool call does not match any rule in the policy pack.
4. A rule's condition references a field that does not exist in the request.
5. The policy schema version is unrecognized.

The question is: when the evaluator cannot produce a definitive allow/deny decision, what is the default?

---

## Decision

**The policy evaluator is fail-closed.** Any ambiguity in policy evaluation results in denial.

Specifically:

| Condition | Behavior |
|---|---|
| Policy pack file cannot be loaded | Engine refuses to start the run. Error returned to shim. |
| Policy pack file fails schema validation | Engine refuses to start the run. Error returned to shim. |
| Policy pack contains zero rules | Engine refuses to start the run (empty policy is a misconfiguration). |
| Tool call matches no rule | Decision is `deny`. |
| Rule condition references a missing field | Rule does not match; evaluation continues to next rule. If no rule matches, decision is `deny`. |
| Policy schema version is unsupported | Engine refuses to start the run. |

The fail-closed default applies only to the policy evaluator. The shim's behavior when the engine is unavailable (fail-open vs. fail-closed) is a separate, operator-configured choice (see Section 11.8 of the product document). These are distinct decisions because the threat profiles differ: a missing policy is a configuration error that should halt the run; a crashed engine may be a transient infrastructure issue where continuing unguarded is the lesser harm.

---

## Consequences

**Positive:**
- No silent misconfiguration. A missing or broken policy file is caught before any tool call executes.
- Defense in depth: a tool call that was not anticipated by the policy author is denied rather than silently allowed.
- Security reviewers can verify the fail-closed property by testing with an empty policy pack.

**Negative:**
- Operators who expect a permissive default (allow unless explicitly denied) will experience unexpected denials. This must be documented clearly.
- Policy authoring requires explicit allow rules for every tool the agent needs. This is intentional friction but increases integration effort.

---

## Migration Path

This is a foundational security property. It must not be changed to fail-open. If a future version introduces a "permissive mode" for development/testing, it must be explicitly opted into via a configuration flag that is not the default, and it must emit a warning event on every run indicating that fail-closed is disabled.
