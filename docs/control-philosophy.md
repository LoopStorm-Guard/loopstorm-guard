<!-- SPDX-License-Identifier: MIT -->
# LoopStorm Guard -- Control Philosophy

**Version:** 1.0
**Date:** 2026-03-13

---

## Overview

LoopStorm Guard applies a five-stage control model to every guarded agent run. The first four stages are deterministic and operate on the enforcement plane. The fifth stage is AI-assisted and operates on the observation plane. This separation is permanent and inviolable.

The product is a control-systems solution, not an AI solution. It bounds the damage when agents fail, preserves evidence of what happened, and provides the information teams need to understand and fix failures. It does not attempt to make agents smarter or correct their reasoning.

---

## The Five Stages

### Stage 1 -- Prevent [Deterministic]

**What it does:** Policy enforcement at the call interception boundary.

Before any tool call executes, the policy evaluator checks it against explicit rules defined in a YAML policy pack. Calls that violate defined boundaries are blocked immediately. The evaluator is fail-closed: if the policy pack cannot be loaded, parsed, or contains no rules, the run does not start. Rules are evaluated in priority order; the first match wins.

**Properties:**
- Deterministic -- the policy either matches or it does not.
- No probabilistic scoring, no LLM involvement, no ambiguity.
- Binary outcome: allow or deny.
- P99 latency target: < 1ms for policy evaluation.

**What it catches:** Known-bad tool calls, environment boundary violations, unauthorized tool access, SSRF patterns, cloud metadata access.

**What it does not catch:** Novel tool calls not anticipated by the policy author. Unknown-bad patterns require Stage 5 (Adapt) to identify and propose new rules.

---

### Stage 2 -- Detect [Deterministic]

**What it does:** Loop-detection heuristics running within a run.

Once a call has been permitted, the loop detector monitors the run's call history. Two heuristics (v1) and three heuristics (v1.1) answer the question: is the agent making forward progress?

| Heuristic | Description | Version |
|---|---|---|
| Identical call fingerprint | Same tool + same args_hash within a rolling time window | v1 |
| Identical error response | Same error response without intervening success | v1 |
| Agent state stagnation | Agent state not changing despite tool calls executing | v1.1 |

**Properties:**
- Deterministic -- same inputs produce same detection decisions.
- Operates on observable call patterns, not internal agent state.
- Configurable thresholds (window size, repeat count).

**What it catches:** Retry loops, error loops, stuck agents repeating the same operation.

**What it does not catch:** Agents looping in internal logic without producing repeated outbound tool calls. Cross-run loop behavior (same agent looping across multiple runs) is a v2 capability.

---

### Stage 3 -- Recover [Deterministic]

**What it does:** Bounded recovery through cooldown and corrective context injection.

When non-progress is detected, the guard does not immediately terminate. It intervenes first:

1. A **cooldown pause** is applied (default: 5 seconds, configurable).
2. A **corrective context message** is injected into the agent's context, informing it that a loop was detected and suggesting alternative actions.
3. The agent gets a chance to self-correct.

Recovery is bounded: if the intervention does not change the behavior, the next trigger escalates to Stage 4.

**Properties:**
- First trigger: cooldown + corrective context.
- Second trigger for the same rule: termination (Stage 4).
- Recovery does not guarantee the agent will fix itself. It guarantees the agent gets one chance before termination.

---

### Stage 4 -- Contain [Deterministic]

**What it does:** Safe termination with evidence preservation.

If recovery attempts fail (Stage 3 did not change behavior) or if a hard budget cap is breached, the run is terminated cleanly:

1. The engine returns a `kill` decision.
2. The shim raises `TerminateRunError`.
3. **Safe partial output** is captured where the adapter supports it (adapter-dependent checkpointed state).
4. **Evidence is always preserved** regardless of whether recoverable business output exists. The event log up to the termination point is complete.
5. A `run_ended` event with the appropriate termination reason is written.

**Properties:**
- Termination is clean, not a process kill. The shim handles the shutdown.
- Evidence preservation is unconditional.
- Business output preservation is adapter-dependent (see product document Section 8.2).

---

### Stage 5 -- Adapt [AI-Assisted, Advisory Only, Human Approval Required, Self-Guarded]

**What it does:** AI Supervisor Agent operating on the observation plane.

After runs reach a terminal state (or asynchronously during runs that cross risk thresholds), the AI Supervisor reads the event log and produces structured output:

- **Risk assessments** -- scoring and narrative for completed or in-progress runs.
- **Pattern records** -- incident families and behavioral baselines.
- **Intervention evaluations** -- was the recovery effective? Should the threshold be adjusted?
- **Policy proposals** -- suggested rule changes based on observed patterns. **Require human approval.**
- **Escalations** -- immediate human attention requests. **Always allowed, never blockable.**

**Properties:**
- Runs on the observation plane only. No access to the enforcement plane IPC channel.
- Cannot make hard enforcement decisions (allow/deny/kill).
- Cannot modify the deterministic guard core without human approval.
- Self-guarded: runs through `loopstorm.wrap()` with its own policy pack.
- Budget-capped: $2.00/session hard cap (configurable).
- Full audit trail as first-class JSONL events.

**What the five stages look like together:**

```
Stage 1 -- Prevent   [deterministic] Policy enforcement at the call interception boundary
Stage 2 -- Detect    [deterministic] Loop-detection heuristics running within a run
Stage 3 -- Recover   [deterministic] Bounded recovery: cooldown + corrective context injection
Stage 4 -- Contain   [deterministic] Safe termination with evidence preservation
Stage 5 -- Adapt     [AI-assisted]   Supervisor agent: interpret, propose, escalate, learn
                     ^ advisory only, human approval required, self-guarded
```

The deterministic core handles Stages 1-4 completely. The AI Supervisor operates exclusively in Stage 5. This separation is the architectural guarantee that enforcement integrity does not depend on AI reliability.

---

## Why This Order Matters

The stages are applied in sequence, and each stage handles what the previous stage could not:

1. **Prevent** stops known-bad calls before they execute.
2. **Detect** identifies non-progress that the policy could not anticipate.
3. **Recover** gives the agent a chance to self-correct before termination.
4. **Contain** limits damage when all else fails.
5. **Adapt** learns from the run to improve future enforcement.

No stage depends on a later stage. Stages 1-4 work without Stage 5. Stage 5 enhances the system's calibration over time but is never in the critical path.
