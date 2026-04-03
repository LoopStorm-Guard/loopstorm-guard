<!-- SPDX-License-Identifier: MIT -->
# Specification: Risk Score Algorithm (v1.1)

**Spec version:** 1
**Date:** 2026-04-02
**Status:** Normative
**Consumers:** AI Supervisor (`compute_risk_score` tool), Backend (risk score display), Frontend (risk tier badges)
**ADR dependencies:** ADR-014 (Gate 5), ADR-012 (AI Supervisor architecture)

---

## 1. Overview

The risk score algorithm is a deterministic, weighted linear model that
produces a numeric risk assessment for a single agent run. It is computed
by the `compute_risk_score` tool in the AI Supervisor, NOT by the LLM.
The LLM reasons about the score and its component signals but does not
compute them.

**Design principles:**
1. **Deterministic.** Same inputs always produce the same score.
2. **Interpretable.** Each signal has a named weight and evidence string.
   The supervisor can explain exactly why a score is what it is.
3. **Bounded.** Score is 0-100. Tier is derived from score.
4. **Conservative.** Weights are calibrated so that a single serious
   signal (budget_exceeded, high_deny_rate) puts the score in MEDIUM or
   HIGH territory, prompting analysis. Two or more serious signals push
   into CRITICAL.

---

## 2. Signals

### 2.1 Signal Definitions

| ID | Signal name | Weight | Condition | Evidence template |
|---|---|---|---|---|
| S1 | `high_deny_rate` | 25 | `deny_count / total_decisions > 2 * agent_baseline.avg_deny_rate` AND `deny_count >= 3` | "{deny_count} denies out of {total_decisions} decisions ({deny_rate:.1%}), baseline is {baseline_rate:.1%}" |
| S2 | `budget_near_cap` | 20 | `run.total_cost_usd > 0.80 * budget.cost_usd.hard` | "Cost ${cost:.2f} exceeds 80% of ${hard_cap:.2f} hard cap" |
| S3 | `budget_exceeded` | 30 | `run.status == "terminated_budget"` | "Run terminated by budget breach on {dimension}" |
| S4 | `loop_detected` | 20 | Any `loop_detected` event exists in run | "{loop_count} loop detection(s) fired" |
| S5 | `loop_unrecovered` | 15 | `loop_detected` event exists AND no behavioral change observed after cooldown | "Loop detected at seq {seq} but behavior did not change after cooldown" |
| S6 | `rapid_fire` | 10 | Median `inter_call_ms` across all policy_decision events < 100 | "Median inter-call time {median_ms}ms (< 100ms threshold)" |
| S7 | `structural_drift` | 10 | For any single tool used 3+ times, >3 distinct `param_shape_hash` values | "Tool {tool} used {count} times with {distinct_shapes} distinct parameter structures" |
| S8 | `abnormal_token_spike` | 15 | Any `token_rate_delta > 5.0` in the run's events | "Token spike of {max_delta:.1f}x detected at seq {seq}" |

### 2.2 Signal Dependencies

| Signal | Requires |
|---|---|
| S1 (`high_deny_rate`) | Agent baseline (from `read_agent_baseline`). If baseline unavailable, use absolute threshold: deny_rate > 30%. |
| S2 (`budget_near_cap`) | Budget configuration from run events. If no budget config, signal cannot fire. |
| S3 (`budget_exceeded`) | Run status field. |
| S4 (`loop_detected`) | Events of type `loop_detected`. |
| S5 (`loop_unrecovered`) | S4 must fire first. Then check if `call_seq_fingerprint` changed after the cooldown event. If BT fields absent (v1.0 data), skip this signal. |
| S6 (`rapid_fire`) | `inter_call_ms` fields on policy_decision events. If BT fields absent, skip this signal. |
| S7 (`structural_drift`) | `param_shape_hash` fields on policy_decision events. If BT fields absent, skip this signal. |
| S8 (`abnormal_token_spike`) | `token_rate_delta` fields on policy_decision events. If BT fields absent, skip this signal. |

### 2.3 Maximum Possible Score

If all 8 signals fire: 25 + 20 + 30 + 20 + 15 + 10 + 10 + 15 = **145**,
capped at **100**.

---

## 3. Scoring Algorithm

```
FUNCTION compute_risk_score(run: Run, events: Event[], baseline: AgentBaseline | null) -> RiskAssessment:

    signals = []

    // S1: high_deny_rate
    deny_count = COUNT(events WHERE decision == "deny")
    total_decisions = COUNT(events WHERE event_type == "policy_decision")
    IF total_decisions > 0:
        deny_rate = deny_count / total_decisions
        IF baseline IS NOT NULL AND baseline.run_count >= 3:
            threshold = MAX(2 * baseline.avg_deny_rate, 0.10)  // at least 10%
        ELSE:
            threshold = 0.30  // absolute fallback
        IF deny_rate > threshold AND deny_count >= 3:
            signals.APPEND(RiskSignal("high_deny_rate", 25, evidence))

    // S2: budget_near_cap
    // Find the last budget_update or policy_decision event with budget data
    IF run.total_cost_usd IS NOT NULL AND budget_hard_cap IS NOT NULL:
        IF run.total_cost_usd > 0.80 * budget_hard_cap:
            signals.APPEND(RiskSignal("budget_near_cap", 20, evidence))

    // S3: budget_exceeded
    IF run.status == "terminated_budget":
        signals.APPEND(RiskSignal("budget_exceeded", 30, evidence))

    // S4: loop_detected
    loop_events = FILTER(events WHERE event_type == "loop_detected")
    IF LEN(loop_events) > 0:
        signals.APPEND(RiskSignal("loop_detected", 20, evidence))

    // S5: loop_unrecovered (requires S4)
    IF "loop_detected" IN signals:
        FOR EACH loop_event IN loop_events:
            // Check if call_seq_fingerprint changed after the cooldown
            post_cooldown_events = FILTER(events WHERE seq > loop_event.seq
                                          AND event_type == "policy_decision")
            IF LEN(post_cooldown_events) > 0:
                pre_fingerprint = LAST(events WHERE seq < loop_event.seq
                                       AND call_seq_fingerprint IS NOT NULL).call_seq_fingerprint
                post_fingerprint = post_cooldown_events[0].call_seq_fingerprint
                IF pre_fingerprint IS NOT NULL AND post_fingerprint IS NOT NULL:
                    IF pre_fingerprint == post_fingerprint:
                        signals.APPEND(RiskSignal("loop_unrecovered", 15, evidence))
                        BREAK  // Only count once

    // S6: rapid_fire (requires BT fields)
    inter_call_values = [e.inter_call_ms FOR e IN events
                         WHERE e.inter_call_ms IS NOT NULL AND e.inter_call_ms > 0]
    IF LEN(inter_call_values) >= 3:
        median_ms = MEDIAN(inter_call_values)
        IF median_ms < 100:
            signals.APPEND(RiskSignal("rapid_fire", 10, evidence))

    // S7: structural_drift (requires BT fields)
    tool_shapes = GROUP_BY(events, key=tool, value=param_shape_hash)
    FOR EACH (tool, shapes) IN tool_shapes:
        IF LEN(shapes) >= 3 AND COUNT_DISTINCT(shapes) > 3:
            signals.APPEND(RiskSignal("structural_drift", 10, evidence))
            BREAK  // Only count once across all tools

    // S8: abnormal_token_spike (requires BT fields)
    max_delta_event = MAX_BY(events, key=token_rate_delta)
    IF max_delta_event IS NOT NULL AND max_delta_event.token_rate_delta > 5.0:
        signals.APPEND(RiskSignal("abnormal_token_spike", 15, evidence))

    // Compute raw score
    raw_score = SUM(s.weight FOR s IN signals)
    score = MIN(raw_score, 100)

    // Determine tier
    IF score <= 25:
        tier = "LOW"
    ELSE IF score <= 50:
        tier = "MEDIUM"
    ELSE IF score <= 75:
        tier = "HIGH"
    ELSE:
        tier = "CRITICAL"

    // Compute confidence
    event_factor = MIN(1.0, LEN(events) / 10)
    IF baseline IS NOT NULL AND baseline.run_count >= 10:
        baseline_factor = 1.0
    ELSE IF baseline IS NOT NULL AND baseline.run_count >= 3:
        baseline_factor = 0.7
    ELSE:
        baseline_factor = 0.4
    confidence = ROUND(event_factor * baseline_factor, 2)

    // Build narrative
    narrative = build_narrative(score, tier, signals, confidence)

    RETURN RiskAssessment(
        run_id = run.run_id,
        score = score,
        tier = tier,
        signals = signals,
        narrative = narrative,
        confidence = confidence
    )
```

---

## 4. Narrative Generation

The narrative is a deterministic string built from the signals. It is NOT
generated by the LLM. The LLM may produce its own reasoning, but the
`narrative` field in the `RiskAssessment` is algorithmic.

**Template:**

```
"Risk assessment: {tier} ({score}/100, confidence {confidence}).
{signal_count} risk signal(s) detected: {signal_names}.
{signal_details}"
```

Where `signal_details` is a newline-separated list of each signal's
evidence string.

---

## 5. Test Vectors

### Vector RS-1: Clean run (no signals)

**Input:** Run completed normally, no denies, no loops, within budget,
no BT anomalies.

**Expected:** score=0, tier=LOW, signals=[], confidence varies by
baseline.

### Vector RS-2: Budget exceeded only

**Input:** Run terminated by budget, status="terminated_budget".

**Expected:** score=30, tier=MEDIUM, signals=[budget_exceeded(30)].

### Vector RS-3: Budget exceeded + high deny rate

**Input:** Run terminated by budget, 10 denies out of 15 decisions
(66.7%), baseline deny rate is 5%.

**Expected:** score=55 (30+25), tier=HIGH,
signals=[budget_exceeded(30), high_deny_rate(25)].

### Vector RS-4: Full critical scenario

**Input:** Run terminated by budget, high deny rate, loop detected with
no recovery, rapid-fire calls, token spike.

**Expected:** score=100 (capped), tier=CRITICAL, at least 5 signals.

### Vector RS-5: BT fields absent (v1.0 data)

**Input:** Run with denies and loop detection but no BT fields on events.

**Expected:** Signals S5, S6, S7, S8 are skipped. Only S1-S4 evaluated.
Score = SUM of applicable signals. Confidence reduced by missing data.

---

## 6. Future Considerations

- **v1.2:** Weights may be tuned based on observed supervisor proposal
  approval/rejection rates. If most MEDIUM proposals are rejected by
  operators, the weights producing MEDIUM scores may be too sensitive.
- **v2:** Machine-learned weights per tenant, trained on historical
  approval patterns. The linear model structure remains; only the weight
  values change.
- **Configurable weights (v2):** Operators may want to adjust weights
  (e.g., increase loop_detected weight for latency-sensitive workloads).
  This is a Mode 1 feature.
