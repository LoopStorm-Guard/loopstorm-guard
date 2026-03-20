<!-- SPDX-License-Identifier: MIT -->
# Specification: AI Supervisory Interface

**Spec version:** 1
**Date:** 2026-03-20
**Status:** Normative
**Consumers:** AI Supervisor implementation agent, Backend (tRPC routers, database schema), Frontend (dashboard, approval workflow), Mobile app (approval queue), OTel exporter (supervisor spans)
**Control philosophy stage:** Stage 5 (Adapt) -- the entire supervisor IS Stage 5
**Deployment modes:** Mode 0 (not applicable), Mode 1 (customer-hosted), Mode 2 (observation only), Mode 3 (full supervisor)
**ADR dependencies:** ADR-012 (AI Supervisor architecture), ADR-002 (fail-closed), ADR-008 (agent_role)
**Source authority:** ADR-012, TAD Amendment v1.2 Section 8, Product Document Action 4

---

## 1. Overview

The AI Supervisor Agent is a first-class AI agent that runs on the
**observation plane only**. It reads completed or in-progress run data,
produces structured analysis (risk assessments, pattern records, intervention
evaluations), creates proposals that require human approval, and escalates
urgent situations to human operators.

**What the supervisor is:**
- A running agent with tools, constraints, a budget, an audit trail, and its
  own policy pack
- Itself guarded by the same deterministic enforcement core it observes
  (recursive trust)
- The normative implementation of Stage 5 (Adapt) of the control philosophy

**What the supervisor is NOT:**
- A component of the enforcement plane
- An autonomous policy modifier
- A chatbot, dashboard widget, or async LLM annotation layer

**Scope of this specification:**
- v1.1 MVP: observation-only with proposals and escalations
- v2 items are identified but not specified in detail (Section 11)

**Plane assignment.** The supervisor operates exclusively on the observation
plane. It has no access to the enforcement plane's IPC channel. It cannot
intercept, modify, or delay enforcement decisions. This separation is
permanent and inviolable (ADR-012).

---

## 2. Architectural Invariants

This section defines the invariants that every implementation MUST satisfy.
Violation of any invariant is a blocking defect.

### 2.1 Enforcement/Observation Plane Separation

```
ENFORCEMENT PLANE (P99 < 5ms, deterministic, Stages 1-4):
  [Agent] --> [Shim] --> [Engine] --> [Decision] --> [JSONL]

     |                                                  |
     |   NO ACCESS   <--  BOUNDARY  -->   NO ACCESS     |
     |   from observation plane          from supervisor |
     v                                                  v

OBSERVATION PLANE (async, seconds-to-minutes, AI-assisted, Stage 5):
  [JSONL / Event Store] --> [Supervisor Tools] --> [Supervisor Agent]
                                                        |
                            [Risk Narratives / Proposals / Escalations]
                                                        |
                                            [Human Approval Queue]
                                                        |
                                [Deterministic Core Update (if approved)]
```

**Physical separation.** The supervisor process has no UDS client connected
to the customer agent's engine instance. There is no code path, no
configuration option, and no administrative override that connects them.
The supervisor's `loopstorm.wrap()` instance connects to a SEPARATE engine
instance on LoopStorm's hosted infrastructure (see Section 10.2).

**NO ACCESS labels (normative):**
- The supervisor CANNOT send `DecisionRequest` messages to the customer's engine.
- The supervisor CANNOT read from the customer's UDS socket.
- The supervisor CANNOT write to the customer's JSONL audit log.
- The supervisor CANNOT modify the customer engine's in-memory policy state.
- The supervisor CANNOT intercept, delay, or modify any enforcement decision.

**Verification method.** Integration tests MUST verify that no network path
exists between the supervisor process and the customer engine's UDS socket.
The supervisor's deployment configuration MUST NOT include the customer
engine's socket path in any environment variable, config file, or secret.

### 2.2 `escalate_to_human` Is Always Allowed

The `escalate_to_human` tool MUST NEVER be blocked by any policy rule --
not the supervisor's policy, not any future policy configuration, not any
administrative override. If the supervisor cannot escalate, the
human-in-the-loop guarantee breaks.

**Enforcement points (all three MUST be implemented):**

1. **Policy schema validation.** The policy schema validator (engine +
   backend `policies.create` tRPC handler) MUST reject any policy pack
   that contains a `deny` rule with `tool: "escalate_to_human"` or a
   `tool_pattern` that matches `"escalate_to_human"`. Specifically:
   - Exact match: `tool: "escalate_to_human"` with `action: "deny"` = REJECT
   - Pattern match: any `tool_pattern` where the glob would match
     `"escalate_to_human"` with `action: "deny"` = REJECT (e.g., `"escalate_*"`,
     `"*"`, `"escalate_to_*"`)

2. **Engine hardcoded allow.** The engine MUST hardcode an allow decision
   for `tool == "escalate_to_human"` that fires BEFORE policy evaluation.
   This is a built-in rule with `rule_id: "__builtin_escalate_to_human_allow"`.
   It cannot be overridden by policy. It is not configurable.

3. **CI test fixture.** A CI test MUST verify that `escalate_to_human` is
   allowed under a policy pack that contains a catch-all deny rule
   (`tool_pattern: "*"`, `action: "deny"`). The test MUST assert
   `decision == "allow"` and `rule_id == "__builtin_escalate_to_human_allow"`.

**Testable verification method:**

```
TEST: escalate_to_human_never_blocked
  GIVEN a policy pack with a single rule:
    - name: deny-everything
      action: deny
      tool_pattern: "*"
  WHEN a DecisionRequest with tool="escalate_to_human" is sent
  THEN the DecisionResponse MUST have:
    - decision: "allow"
    - rule_id: "__builtin_escalate_to_human_allow"
```

### 2.3 All Proposals Require Human Approval

The supervisor CANNOT autonomously modify any policy, budget, or enforcement
rule. Every proposal enters the human approval queue and remains in
`pending_approval` status until a human acts on it.

There is no auto-approve mechanism. There is no escalation path that bypasses
human approval for proposals. There is no "trusted supervisor" configuration
that allows autonomous policy modification.

The `propose_*` tools in the supervisor policy pack use
`action: require_approval`. The engine enforces this -- even if the policy
were misconfigured to `allow` these tools, the backend's proposal insertion
logic creates the proposal in `pending_approval` status regardless of the
engine's decision. Defense in depth.

### 2.4 Supervisor Is Self-Guarded via `loopstorm.wrap()`

The supervisor runs through a `loopstorm.wrap()` instance with its own
policy pack (`supervisor-policy.yaml`) and its own JSONL audit trail. Its
tool calls are intercepted by the enforcement core, evaluated against its
policy, recorded in the hash chain, and subject to budget enforcement and
loop detection.

The supervisor's `loopstorm.wrap()` connects to a dedicated engine instance
on LoopStorm's hosted infrastructure. This engine instance uses the
`supervisor-policy.yaml` policy pack.

### 2.5 Budget Cap

The supervisor has a **$2.00/session hard budget cap** (configurable per
tenant in Mode 1). Default budget configuration:

| Dimension | Soft cap | Hard cap |
|---|---|---|
| `cost_usd` | $1.50 | $2.00 |
| `call_count` | (none) | 100 |

If the supervisor exceeds its hard budget cap, the enforcement core kills
its session. This is identical to how any agent run is terminated on budget
breach.

The budget applies per supervisor session (one trigger = one session).

---

## 3. Execution Model

### 3.1 Long-Lived Agent on Hosted Infrastructure

The supervisor runs as a long-lived agent process on LoopStorm's hosted
infrastructure (Mode 2/3). Each trigger creates a new supervisor session
with its own `run_id`, budget, and audit trail.

The supervisor is NOT a persistent conversation. Each session is stateless
relative to previous sessions. Cross-session context comes from the learning
store (read via `read_agent_baseline`, `query_similar_runs`), not from
conversation history.

### 3.2 Trigger-Based Activation

The supervisor is activated by specific trigger conditions (Section 6), NOT
on every run. Clean runs that complete within budget without deny decisions
do not trigger the supervisor. This is a cost engineering decision: the
haiku-class model is inexpensive, but running it on every clean run adds
unnecessary cost and latency.

### 3.3 One Session Per Trigger

Each trigger creates exactly one supervisor session. If multiple triggers
fire for the same run (e.g., budget warning AND loop detection), they
create separate supervisor sessions. Each session receives the full trigger
context and independently analyzes the situation.

The supervisor runtime MAY deduplicate triggers for the same run within a
configurable window (default: 60 seconds). If deduplication is applied, only
the highest-severity trigger is activated.

### 3.4 Model Selection (OQ-SUP-4 Resolved)

**Decision:** The spec requires a haiku-class model family, not a pinned
model version.

**Default:** The supervisor uses the most cost-effective model in the
`claude-haiku` family available at deployment time (e.g.,
`claude-3-5-haiku-20251001` as of this writing). The specific model version
is a deployment configuration value, not a specification constant.

**Rationale:** Model versions are deprecated and replaced on a faster
cadence than specification versions. Pinning to a specific version creates
maintenance burden with no safety benefit. The supervisor's tool set is
well-defined and does not require frontier-class reasoning.

**Configurability (Mode 1 only):** Operators running a self-hosted
deployment (Mode 1) may configure any LLM provider and model. The
supervisor's tool schemas are provider-agnostic -- they define the tool
interface, not the LLM API. The deployment MUST verify that the configured
model supports tool use (function calling).

### 3.5 Deployment Mode Behavior

| Mode | Supervisor behavior |
|---|---|
| **Mode 0** | Supervisor does **NOT** run. No LLM access, no hosted infrastructure. All five-stage control properties of Stages 1-4 are fully available. Stage 5 is not available. |
| **Mode 1** | Supervisor runs on the customer's infrastructure against a customer-specified LLM provider. Cross-customer intelligence is not available (no data leaves customer infrastructure). The customer provides and manages the LLM API key. |
| **Mode 2** | Supervisor is available in observation-only mode. It reads from the customer's event store. It does NOT produce proposals or escalations in Mode 2 (those require Mode 3). It produces risk narratives that appear in the dashboard. |
| **Mode 3** | Full supervisor: observation, interpretation, proposals, escalations, learning. All tools available. Mobile approval app active. Cross-customer intelligence available (opt-in). |

**Mode 0 is complete without the supervisor.** The enforcement plane
(Stages 1-4) provides full policy enforcement, budget caps, loop detection,
and audit logging without any AI involvement. The supervisor (Stage 5)
enhances calibration over time but is never required for safety.

---

## 4. Tool Set (v1.1 MVP)

This section defines every tool available to the supervisor. Each tool has:
a category, full type signature, parameter descriptions, return type, policy
classification, error conditions, and v1.1 implementation notes.

### 4.1 OBSERVATION Tools (Policy: `allow`)

These tools provide read-only access to the customer's event store and
derived data. They never modify state. They return post-redaction data only
(the supervisor never sees raw, pre-redaction arguments).

---

#### `read_run_events`

Reads the event log for a specific run.

```typescript
function read_run_events(params: {
  /** The run_id to read events for. UUID v7 format. */
  run_id: string;
  /** Maximum number of events to return. Capped at 1000. */
  limit?: number;       // default: 500, max: 1000
  /** Start reading from this sequence number (inclusive). */
  offset_seq?: number;  // default: 1
  /** Filter by event_type(s). If omitted, all event types are returned. */
  event_types?: string[];
}): Promise<ReadRunEventsResult>;

interface ReadRunEventsResult {
  /** The events, ordered by seq ascending. */
  events: Event[];
  /** Total number of events in this run. */
  total_count: number;
  /** Whether more events exist beyond the returned set. */
  has_more: boolean;
}
```

**Policy classification:** `allow` (reading never causes harm)

**Data isolation:** Only returns events where `tenant_id` matches the
supervisor's tenant context (RLS-enforced). The supervisor CANNOT read
events from other tenants.

**Redaction:** `args_redacted` is returned (post-redaction). The
pre-redaction `args` are never available to the supervisor. `args_hash` is
available (it is a one-way hash, not reversible to raw args).

**Error conditions:**
- `RUN_NOT_FOUND`: The `run_id` does not exist or does not belong to the
  supervisor's tenant.
- `INVALID_PARAMETER`: `limit` exceeds 1000, or `offset_seq` < 1.

---

#### `read_agent_baseline`

Reads statistical baseline data for an agent.

```typescript
function read_agent_baseline(params: {
  /** The agent name to look up. */
  agent_name: string;
  /** Number of days to include in the baseline window. */
  lookback_days?: number;  // default: 30, max: 90
}): Promise<AgentBaseline>;

interface AgentBaseline {
  agent_name: string;
  /** Number of runs in the lookback window. */
  run_count: number;
  /** Average cost per run in USD. */
  avg_cost_usd: number;
  /** Median cost per run in USD. */
  median_cost_usd: number;
  /** 95th percentile cost per run in USD. */
  p95_cost_usd: number;
  /** Average call count per run. */
  avg_call_count: number;
  /** Average input tokens per run. */
  avg_input_tokens: number;
  /** Average output tokens per run. */
  avg_output_tokens: number;
  /** Total deny decisions in the lookback window. */
  total_deny_count: number;
  /** Average deny rate per run (denies / total decisions). */
  avg_deny_rate: number;
  /** Number of runs terminated by budget breach. */
  budget_termination_count: number;
  /** Number of runs terminated by loop detection. */
  loop_termination_count: number;
  /** Most frequently denied tools. */
  top_denied_tools: Array<{ tool: string; count: number }>;
  /** Most frequently used tools. */
  top_tools: Array<{ tool: string; count: number }>;
}
```

**Policy classification:** `allow`

**Data isolation:** Baseline is computed from runs where `tenant_id` matches
the supervisor's tenant context. Cross-tenant data is never included.

**Error conditions:**
- `AGENT_NOT_FOUND`: No runs exist for this `agent_name` within the tenant.
- `INSUFFICIENT_DATA`: Fewer than 3 runs exist in the lookback window.
  Returns partial baseline with a `warning` field.

---

#### `read_policy_pack`

Reads the active policy pack configuration.

```typescript
function read_policy_pack(params: {
  /** The policy pack identifier. */
  pack_id: string;
}): Promise<PolicyPackResult>;

interface PolicyPackResult {
  pack_id: string;
  name: string;
  description: string | null;
  agent_role: string | null;
  schema_version: number;
  rules: PolicyRule[];
  budget: BudgetConfig | null;
  loop_detection: LoopDetectionConfig | null;
}
```

**Policy classification:** `allow`

**Data isolation:** Only returns policy packs where `tenant_id` matches.

**Error conditions:**
- `PACK_NOT_FOUND`: The `pack_id` does not exist or does not belong to
  the supervisor's tenant.

---

#### `query_similar_runs`

Finds runs with similar behavioral patterns.

```typescript
function query_similar_runs(params: {
  /** A call_seq_fingerprint from the triggering run's events. */
  fingerprint: string;
  /** Number of similar runs to return. */
  top_k?: number;         // default: 5, max: 20
  /** Search scope. */
  scope?: "customer" | "anonymous_aggregate";  // default: "customer"
}): Promise<SimilarRunsResult>;

interface SimilarRunsResult {
  runs: SimilarRun[];
  /** Message if the requested scope is not available. */
  scope_message: string | null;
}

interface SimilarRun {
  run_id: string;
  agent_name: string;
  similarity_score: number;  // 0.0 to 1.0
  status: string;            // run_status enum value
  total_cost_usd: number;
  total_call_count: number;
  /** Summary of how this run ended. */
  outcome_summary: string;
}
```

**Policy classification:** `allow`

**v1.1 scope limitation (OQ-SUP-2 resolved):** In v1.1:
- `scope="customer"`: searches within the tenant's own runs. This is
  functional in v1.1 using a basic fingerprint prefix match against the
  `events` table.
- `scope="anonymous_aggregate"`: **returns an empty result** with
  `scope_message: "Cross-customer intelligence is available in v2.
  This query returned results from your own runs only."` The parameter
  exists in the v1.1 interface to avoid a breaking change when v2
  implements cross-customer intelligence.

**Data isolation:** `scope="customer"` returns only the tenant's runs
(RLS-enforced). `scope="anonymous_aggregate"` in v2 will return
anonymized, aggregated data with no tenant-identifying information.

**Error conditions:**
- `INVALID_FINGERPRINT`: `fingerprint` does not match the expected
  SHA-256 hex pattern.

---

### 4.2 INTERPRETATION Tools (Policy: `allow`)

These tools compute structured analysis from run data. They do not modify
state. Their outputs are deterministic given the same inputs (no LLM calls
within the tool itself -- the LLM reasons about the tool outputs, not
within them).

---

#### `compute_risk_score`

Computes a risk assessment for a run.

```typescript
function compute_risk_score(params: {
  /** The run_id to assess. */
  run_id: string;
}): Promise<RiskAssessment>;

interface RiskAssessment {
  run_id: string;
  /** Risk score from 0 (no risk) to 100 (critical). */
  score: number;
  /** Risk tier derived from score. */
  tier: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** Individual risk signals that contributed to the score. */
  signals: RiskSignal[];
  /** Human-readable narrative explaining the assessment. */
  narrative: string;
  /** Confidence in the assessment (0.0 to 1.0). */
  confidence: number;
}

interface RiskSignal {
  /** Signal name (e.g., "high_deny_rate", "budget_near_cap", "loop_detected"). */
  name: string;
  /** Contribution to the overall score (0-100). */
  weight: number;
  /** Evidence supporting this signal. */
  evidence: string;
}
```

**Scoring thresholds:**

| Score range | Tier | Meaning |
|---|---|---|
| 0-25 | LOW | Normal operation |
| 26-50 | MEDIUM | Elevated risk, worth monitoring |
| 51-75 | HIGH | Active risk, human attention recommended |
| 76-100 | CRITICAL | Immediate human attention required |

**Policy classification:** `allow`

**Error conditions:**
- `RUN_NOT_FOUND`: The `run_id` does not exist or does not belong to
  the tenant.

---

#### `analyze_loop_pattern`

Analyzes loop behavior in a run.

```typescript
function analyze_loop_pattern(params: {
  /** The run_id to analyze. */
  run_id: string;
}): Promise<LoopAnalysis>;

interface LoopAnalysis {
  run_id: string;
  /** Whether a loop pattern was detected. */
  detected: boolean;
  /** Which heuristic fired (if detected). */
  heuristic: string | null;
  /** The events that form the loop pattern. */
  pattern_events: Event[];
  /** Whether recovery was attempted (cooldown applied). */
  recovery_attempted: boolean;
  /** Whether recovery was effective (behavior changed after cooldown). */
  recovery_effective: boolean | null;
  /** Human-readable narrative of the loop analysis. */
  narrative: string;
}
```

**Policy classification:** `allow`

**Error conditions:**
- `RUN_NOT_FOUND`: The `run_id` does not exist or does not belong to
  the tenant.

---

#### `evaluate_recovery_effectiveness`

Evaluates whether a specific recovery intervention was effective.

```typescript
function evaluate_recovery_effectiveness(params: {
  /** The run_id containing the intervention. */
  run_id: string;
  /** The seq number of the cooldown/intervention event. */
  intervention_seq: number;
}): Promise<RecoveryEvaluation>;

interface RecoveryEvaluation {
  run_id: string;
  intervention_seq: number;
  /** Whether the intervention changed the agent's behavior. */
  effective: boolean;
  /** Evidence supporting the effectiveness determination. */
  evidence: string;
  /** Recommended next action based on the evaluation. */
  recommended_next_action: string;
}
```

**Policy classification:** `allow`

**Error conditions:**
- `RUN_NOT_FOUND`: The `run_id` does not exist or does not belong to
  the tenant.
- `EVENT_NOT_FOUND`: No event exists at the given `intervention_seq` in
  the run, or the event is not a cooldown/loop_detected event.

---

### 4.3 PROPOSAL Tools (Policy: `require_approval`)

These tools create proposals in the human approval queue. They do NOT
directly modify any policy, budget, or enforcement rule. The proposal
enters `pending_approval` status and waits for human action.

---

#### `propose_budget_adjustment`

Creates a proposal to adjust a budget cap.

```typescript
function propose_budget_adjustment(params: {
  /** Whether the target is a specific run type or an agent. */
  target: "run" | "agent";
  /** The run_id (if target="run") or agent_name (if target="agent"). */
  target_id: string;
  /** The budget dimension to adjust. */
  dimension: "cost_usd" | "input_tokens" | "output_tokens" | "call_count";
  /** The current cap value. */
  current_value: number;
  /** The proposed new cap value. */
  proposed_value: number;
  /** Human-readable explanation for why this adjustment is proposed. */
  rationale: string;
  /** Supervisor's confidence in this proposal (0.0 to 1.0). */
  confidence: number;
  /** Run IDs that support this proposal (evidence). */
  supporting_runs: string[];
}): Promise<Proposal>;

interface Proposal {
  proposal_id: string;   // format: "prop_" + 8 hex chars
  status: "pending_approval";
  created_at: string;    // ISO 8601
}
```

**Policy classification:** `require_approval` (with `timeout: 86400`,
`timeout_action: deny`)

**Behavior:** The engine evaluates this tool call against the supervisor
policy and returns `decision: "require_approval"`. The supervisor runtime
then creates the proposal record in the `supervisor_proposals` table and
emits a `supervisor_proposal_created` event in the supervisor's audit trail.

**What happens after approval (OQ-SUP-3 resolved):** In v1.1, an approved
proposal does NOT automatically modify the enforcement core. The operator
receives a notification that a proposal was approved. The operator MUST
manually update their policy YAML file (Mode 0) or the policy pack in the
dashboard (Mode 2/3) to apply the change. This is intentional: the human
remains fully in the loop. Automated policy push from approved proposals
is a v2 capability.

**Error conditions:**
- `INVALID_DIMENSION`: The `dimension` value is not a recognized budget
  dimension.
- `INVALID_TARGET`: The `target_id` does not exist within the tenant.
- `DUPLICATE_PROPOSAL`: An active (non-expired, non-rejected) proposal
  for the same `target_id` + `dimension` already exists.

---

#### `flag_for_review`

Flags a run for human attention without proposing a specific action.

```typescript
function flag_for_review(params: {
  /** The run_id to flag. */
  run_id: string;
  /** Severity of the flag. */
  severity: "low" | "medium" | "high" | "critical";
  /** Human-readable notes explaining why this run needs review. */
  notes: string;
}): Promise<ReviewFlag>;

interface ReviewFlag {
  proposal_id: string;          // format: "prop_" + 8 hex chars
  proposal_type: "flag_for_review";
  status: "pending_approval";
  created_at: string;           // ISO 8601
}
```

**Policy classification:** `allow` (lower stakes than a budget proposal;
flagging for review is a notification, not a change request)

**Note:** `flag_for_review` is classified as `allow` in the supervisor
policy despite being in the PROPOSAL category. It creates a proposal record
for tracking purposes but does not propose any enforcement change.

**Error conditions:**
- `RUN_NOT_FOUND`: The `run_id` does not exist or does not belong to
  the tenant.

---

### 4.4 ESCALATION Tools (Policy: `allow` -- NEVER blockable)

---

#### `escalate_to_human`

Triggers an immediate human attention request with push notification.

```typescript
function escalate_to_human(params: {
  /** The run_id that this escalation concerns. */
  run_id: string;
  /** Severity of the escalation. "low" is excluded; escalations are for medium+ severity. */
  severity: "medium" | "high" | "critical";
  /** Supervisor's recommended course of action. */
  recommendation: string;
  /** Human-readable context explaining the escalation. */
  context: string;
  /** Time in seconds for the human to respond. */
  timeout_seconds: number;       // min: 60, max: 86400
  /** Action to take if the human does not respond within the timeout. */
  timeout_action: "deny" | "allow" | "kill";
}): Promise<Escalation>;

interface Escalation {
  escalation_id: string;    // format: "esc_" + 8 hex chars
  status: "open";
  created_at: string;       // ISO 8601
}
```

**Policy classification:** `allow` -- **ALWAYS ALLOWED. This tool MUST
NEVER be blocked by any policy rule.** See Section 2.2 for the invariant
definition and enforcement points.

**Behavior:** The escalation is immediately written to the
`supervisor_escalations` table and a `supervisor_escalation_created` event
is emitted. If a mobile app or real-time dashboard is connected (Mode 3),
a push notification is sent. The escalation appears in the approval queue
alongside proposals.

**Timeout behavior:** If the human does not acknowledge the escalation
within `timeout_seconds`, the `timeout_action` is logged as a
`system_event` in the supervisor's audit trail. The `timeout_action` is
advisory in v1.1 -- it does not directly execute an enforcement action
because the supervisor has no access to the enforcement plane. In Mode 3,
the `timeout_action` may trigger an automated policy adjustment via the
backend (e.g., killing a still-running run), but this is a backend-side
action, not a supervisor-initiated enforcement action.

**Error conditions:**
- `RUN_NOT_FOUND`: The `run_id` does not exist or does not belong to
  the tenant.
- `INVALID_TIMEOUT`: `timeout_seconds` is less than 60 or greater than
  86400.

---

### 4.5 LEARNING Tools (Policy: `allow`)

These tools write to the supervisor's learning store. They capture
patterns, profiles, and outcomes that improve future supervisor sessions.
They do NOT modify the enforcement core.

---

#### `record_incident_pattern`

Records a recurring incident pattern for future reference.

```typescript
function record_incident_pattern(params: {
  /** Name for this incident pattern (e.g., "extraction-loop-variant-a"). */
  name: string;
  /** Description of the pattern. */
  description: string;
  /** Run IDs that exhibit this pattern. */
  run_ids: string[];
  /** Outcome description (e.g., "terminated by budget kill"). */
  outcome: string;
  /** Notes on how to prevent or mitigate this pattern. */
  prevention_notes: string;
}): Promise<IncidentPattern>;

interface IncidentPattern {
  pattern_id: string;
  name: string;
  created_at: string;
}
```

**Policy classification:** `allow`

**Storage:** Written to a supervisor-scoped knowledge store within the
tenant's data. In v1.1, this is stored as a JSONB document in the
`supervisor_proposals` table with `proposal_type: "incident_pattern"`.
A dedicated learning store table is a v2 consideration.

**Error conditions:**
- `INVALID_RUN_IDS`: One or more `run_ids` do not exist within the tenant.

---

#### `update_agent_profile`

Updates the supervisor's behavioral profile for an agent.

```typescript
function update_agent_profile(params: {
  /** The agent name to update the profile for. */
  agent_name: string;
  /** Human-readable behavioral notes. */
  behavioral_notes: string;
  /** Structured risk profile update. */
  risk_profile_update: {
    /** Updated risk tier for this agent. */
    risk_tier?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    /** Updated typical cost range. */
    typical_cost_range?: { min_usd: number; max_usd: number };
    /** Behavioral tags (e.g., ["high-cost", "loop-prone", "well-calibrated"]). */
    tags?: string[];
  };
}): Promise<AgentProfile>;

interface AgentProfile {
  agent_name: string;
  updated_at: string;
}
```

**Policy classification:** `allow`

**Storage:** Same as `record_incident_pattern` -- stored as a JSONB
document in the supervisor's tenant-scoped knowledge area.

**Error conditions:**
- `AGENT_NOT_FOUND`: No runs exist for this `agent_name` within the tenant.

---

#### `record_intervention_outcome`

Records the observed outcome of a recovery intervention.

```typescript
function record_intervention_outcome(params: {
  /** The seq number of the intervention event in the triggering run. */
  intervention_seq: number;
  /** The run_id containing the intervention. */
  run_id: string;
  /** Whether the intervention was effective. */
  outcome: "effective" | "ineffective" | "partial";
  /** Evidence supporting the outcome determination. */
  evidence: string;
}): Promise<InterventionRecord>;

interface InterventionRecord {
  record_id: string;
  created_at: string;
}
```

**Policy classification:** `allow`

**Error conditions:**
- `RUN_NOT_FOUND`: The `run_id` does not exist within the tenant.
- `EVENT_NOT_FOUND`: No event exists at `intervention_seq` in the run.

---

### 4.6 Tool Set Summary

| Category | Tool | Policy | Modifies state? |
|---|---|---|---|
| OBSERVATION | `read_run_events` | `allow` | No |
| OBSERVATION | `read_agent_baseline` | `allow` | No |
| OBSERVATION | `read_policy_pack` | `allow` | No |
| OBSERVATION | `query_similar_runs` | `allow` | No |
| INTERPRETATION | `compute_risk_score` | `allow` | No |
| INTERPRETATION | `analyze_loop_pattern` | `allow` | No |
| INTERPRETATION | `evaluate_recovery_effectiveness` | `allow` | No |
| PROPOSAL | `propose_budget_adjustment` | `require_approval` | Creates proposal record |
| PROPOSAL | `flag_for_review` | `allow` | Creates proposal record |
| ESCALATION | `escalate_to_human` | `allow` (NEVER blockable) | Creates escalation record |
| LEARNING | `record_incident_pattern` | `allow` | Writes to learning store |
| LEARNING | `update_agent_profile` | `allow` | Writes to learning store |
| LEARNING | `record_intervention_outcome` | `allow` | Writes to learning store |

**Total:** 13 tools (4 observation + 3 interpretation + 2 proposal +
1 escalation + 3 learning).

---

## 5. Supervisor Policy Pack

The supervisor's policy pack is a standard LoopStorm policy YAML file
that conforms to `schemas/policy/policy.schema.json`. It uses the same
schema as any agent's policy pack.

### 5.1 Complete YAML Specification

```yaml
# supervisor-policy.yaml
# LoopStorm's own policy pack for its AI Supervisor Agent.
# Customers can inspect this file. Self-hosted (Mode 1) operators
# can override it.
#
# SPDX-License-Identifier: MIT

schema_version: 1
name: loopstorm-supervisor-policy
description: >-
  Policy pack for the LoopStorm AI Supervisor Agent. Enforces
  observation-plane constraints: read tools allowed, proposals
  require human approval, escalation always allowed, production
  execution denied.
agent_role: supervisor

rules:
  # --- ESCALATION: always allowed, listed first for clarity ---
  # This rule MUST NOT be removed. It is the human-in-the-loop guarantee.
  - name: allow-escalation
    action: allow
    tool: escalate_to_human

  # --- OBSERVATION: reading never causes harm ---
  - name: allow-read-run-events
    action: allow
    tool: read_run_events

  - name: allow-read-agent-baseline
    action: allow
    tool: read_agent_baseline

  - name: allow-read-policy-pack
    action: allow
    tool: read_policy_pack

  - name: allow-query-similar-runs
    action: allow
    tool: query_similar_runs

  # --- INTERPRETATION: analysis never causes harm ---
  - name: allow-compute-risk-score
    action: allow
    tool: compute_risk_score

  - name: allow-analyze-loop-pattern
    action: allow
    tool: analyze_loop_pattern

  - name: allow-evaluate-recovery
    action: allow
    tool: evaluate_recovery_effectiveness

  # --- FLAGGING: low-stakes attention request ---
  - name: allow-flag-for-review
    action: allow
    tool: flag_for_review

  # --- PROPOSALS: require human approval ---
  - name: require-approval-proposals
    action: require_approval
    tool_pattern: "propose_*"
    timeout: 86400
    timeout_action: deny

  # --- LEARNING: audited writes to supervisor knowledge store ---
  - name: allow-record-incident-pattern
    action: allow
    tool: record_incident_pattern

  - name: allow-update-agent-profile
    action: allow
    tool: update_agent_profile

  - name: allow-record-intervention-outcome
    action: allow
    tool: record_intervention_outcome

  # --- HARD DENY: supervisor cannot touch production infrastructure ---
  - name: deny-production-execution
    action: deny
    tool_pattern: "execute_*"
    reason: "Supervisor cannot execute production operations"

  - name: deny-write-operations
    action: deny
    tool_pattern: "write_*"
    reason: "Supervisor cannot perform write operations on customer infrastructure"

  - name: deny-delete-operations
    action: deny
    tool_pattern: "delete_*"
    reason: "Supervisor cannot perform delete operations"

  - name: deny-modify-operations
    action: deny
    tool_pattern: "modify_*"
    reason: "Supervisor cannot modify customer infrastructure directly"

  # --- HARD DENY: supervisor cannot call external APIs except LLM providers ---
  - name: deny-unauthorized-http
    action: deny
    tool: http.request
    conditions:
      - field: url
        operator: not_matches
        pattern: "https://(api.anthropic.com|api.openai.com)/.*"
    reason: "Supervisor cannot access unauthorized external APIs"

budget:
  cost_usd:
    soft: 1.50
    hard: 2.00
  call_count:
    hard: 100
```

### 5.2 Invariant Enforcement in the Policy Pack

The policy pack above satisfies the `escalate_to_human` invariant because:

1. `escalate_to_human` has an explicit `allow` rule at the top of the rule
   list (first-match-wins evaluation order).
2. No `deny` rule in the pack has `tool: "escalate_to_human"` or a
   `tool_pattern` that matches `"escalate_to_human"`.
3. Even if the policy were somehow misconfigured, the engine's hardcoded
   `__builtin_escalate_to_human_allow` rule fires before policy evaluation
   (Section 2.2).

### 5.3 Customer Inspectability

The supervisor policy pack is:
- Published in the LoopStorm repository at `examples/supervisor-policy.yaml`
- Visible in the web dashboard (Mode 2/3) under the supervisor's agent tile
- Readable via the `read_policy_pack` tool by the supervisor itself
  (recursive inspectability)
- Overridable by Mode 1 operators who deploy their own supervisor instance

---

## 6. Trigger Conditions

### 6.1 Post-Run Triggers (Mode A)

Post-run triggers fire after a run reaches a terminal state. The supervisor
analyzes the completed run.

| Trigger | Condition | Supervisor receives |
|---|---|---|
| `terminated_budget` | Run status transitions to `terminated_budget` | `trigger: "terminated_budget"`, `trigger_run_id: <run_id>` |
| `terminated_loop` | Run status transitions to `terminated_loop` | `trigger: "terminated_loop"`, `trigger_run_id: <run_id>` |
| `abandoned` | Run status transitions to `abandoned` | `trigger: "abandoned"`, `trigger_run_id: <run_id>` |
| `deny_decisions` | Run completes with 1 or more `deny` decisions | `trigger: "deny_decisions"`, `trigger_run_id: <run_id>` |
| `high_cost` | Run completes with `total_cost_usd > 0.80 * budget.cost_usd.hard` | `trigger: "high_cost"`, `trigger_run_id: <run_id>` |

**Evaluation timing.** Post-run triggers are evaluated when a `run_ended`
event is ingested by the backend. The backend inspects the run's final
state and queues supervisor activation if any trigger condition matches.

### 6.2 Mid-Run Triggers (Mode B, v1.1)

Mid-run triggers fire during an active run when risk thresholds are crossed.
The supervisor analyzes the in-progress run and may escalate in real time.

| Trigger | Condition | Supervisor receives |
|---|---|---|
| `budget_warning` | Budget crosses 70% of hard cap on any dimension | `trigger: "budget_warning"`, `trigger_run_id: <run_id>` |
| `loop_detected` | Loop detection fires (cooldown applied) | `trigger: "loop_detected"`, `trigger_run_id: <run_id>` |
| `deny_spike` | Deny rate for current run exceeds 3x the agent's baseline deny rate | `trigger: "deny_spike"`, `trigger_run_id: <run_id>` |
| `repeated_rule` | Same enforcement rule fires 3 or more times in one run | `trigger: "repeated_rule"`, `trigger_run_id: <run_id>` |

**Evaluation timing.** Mid-run triggers are evaluated on each event
ingestion. The backend maintains running counters per active run and
checks trigger conditions after each event is stored.

**Mid-run vs. post-run priority.** If a mid-run trigger fires and the run
subsequently ends, the post-run trigger MAY be suppressed if a supervisor
session for this run is already active or recently completed (within the
deduplication window of 60 seconds).

### 6.3 Scheduled Triggers (v2, Deferred)

The following triggers are identified for v2 but are NOT implemented in
v1.1:

- **Daily summary:** Supervisor runs once per day, summarizing all agent
  runs across the tenant.
- **Weekly report:** Supervisor produces a weekly policy effectiveness
  report.
- **Pattern scan:** Supervisor scans for new incident patterns across
  recent runs.

---

## 7. Audit Trail Schema

Every supervisor action is a first-class JSONL event using the standard
event schema (`schemas/events/event.schema.json`). The supervisor's events
form their own hash chain (own `run_id`, own `seq` sequence, own
`hash`/`hash_prev` chain).

**Chain isolation.** The supervisor's events are in the supervisor's own
`run_id` chain, NOT the triggering agent's chain. This maintains the
integrity of both chains independently.

### 7.1 `supervisor_run_started`

Emitted when a supervisor session begins.

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | integer | Yes | Always `1` |
| `event_type` | string | Yes | `"supervisor_run_started"` |
| `run_id` | string (UUID) | Yes | The supervisor session's own run_id |
| `seq` | integer | Yes | Always `1` (first event in session) |
| `hash` | string | Yes | SHA-256 of this event's payload |
| `hash_prev` | null | Yes | Null (first event in chain) |
| `ts` | string (ISO 8601) | Yes | Timestamp of session start |
| `supervisor_run_id` | string | Yes | Same as `run_id` for supervisor events. Format: `"sup_"` + 8 hex chars |
| `trigger` | string | Yes | The trigger that activated this session (e.g., `"terminated_budget"`, `"loop_detected"`, `"deny_spike"`) |
| `trigger_run_id` | string | Yes | The `run_id` of the agent run that caused the trigger |
| `agent_name` | string | Yes | `"loopstorm-supervisor"` |
| `agent_role` | string | Yes | `"supervisor"` |
| `model` | string | Yes | LLM model identifier (e.g., `"claude-3-5-haiku-20251001"`) |
| `policy_pack_id` | string | Yes | `"supervisor-policy-v1"` (or current version) |
| `budget` | object | Yes | Budget state at session start |
| `run_status` | string | Yes | `"started"` |

### 7.2 `supervisor_tool_call`

Emitted for every tool call the supervisor makes.

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | integer | Yes | Always `1` |
| `event_type` | string | Yes | `"supervisor_tool_call"` |
| `run_id` | string (UUID) | Yes | The supervisor session's run_id |
| `seq` | integer | Yes | Monotonically increasing within the session |
| `hash` | string | Yes | SHA-256 of this event's payload |
| `hash_prev` | string | Yes | Hash of the previous event |
| `ts` | string (ISO 8601) | Yes | Timestamp of the tool call |
| `supervisor_run_id` | string | Yes | Same as the session's `supervisor_run_id` |
| `tool` | string | Yes | Tool name (e.g., `"read_run_events"`, `"compute_risk_score"`) |
| `args_hash` | string | Yes | SHA-256 of JCS canonical tool arguments |
| `args_redacted` | object | No | Redacted tool arguments |
| `decision` | string | Yes | The enforcement decision for this call (`"allow"` or `"require_approval"`) |
| `rule_id` | string | Yes | The policy rule that matched |
| `latency_ms` | number | No | Engine processing latency |
| `budget` | object | No | Budget state after this call |

### 7.3 `supervisor_proposal_created`

Emitted when the supervisor creates a proposal.

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | integer | Yes | Always `1` |
| `event_type` | string | Yes | `"supervisor_proposal_created"` |
| `run_id` | string (UUID) | Yes | The supervisor session's run_id |
| `seq` | integer | Yes | Monotonically increasing |
| `hash` | string | Yes | SHA-256 of this event's payload |
| `hash_prev` | string | Yes | Hash of the previous event |
| `ts` | string (ISO 8601) | Yes | Timestamp |
| `supervisor_run_id` | string | Yes | Same as the session's `supervisor_run_id` |
| `proposal_id` | string | Yes | Unique proposal identifier. Format: `"prop_"` + 8 hex chars |
| `proposal_type` | string | Yes | `"budget_adjustment"` or `"flag_for_review"` |
| `target_agent` | string | No | The agent targeted by the proposal (if applicable) |
| `rationale` | string | Yes | Human-readable rationale |
| `confidence` | number | No | Supervisor confidence (0.0 to 1.0) |
| `supporting_runs` | string[] | No | Run IDs supporting the proposal |
| `status` | string | Yes | `"pending_approval"` at creation time |

### 7.4 `supervisor_escalation_created`

Emitted when the supervisor creates an escalation.

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | integer | Yes | Always `1` |
| `event_type` | string | Yes | `"supervisor_escalation_created"` |
| `run_id` | string (UUID) | Yes | The supervisor session's run_id |
| `seq` | integer | Yes | Monotonically increasing |
| `hash` | string | Yes | SHA-256 of this event's payload |
| `hash_prev` | string | Yes | Hash of the previous event |
| `ts` | string (ISO 8601) | Yes | Timestamp |
| `supervisor_run_id` | string | Yes | Same as the session's `supervisor_run_id` |
| `escalation_id` | string | Yes | Unique escalation identifier. Format: `"esc_"` + 8 hex chars |
| `severity` | string | Yes | `"medium"`, `"high"`, or `"critical"` |
| `rationale` | string | Yes | Why the escalation was created |
| `recommendation` | string | Yes | Supervisor's recommended action |
| `confidence` | number | No | Supervisor confidence (0.0 to 1.0) |
| `supporting_runs` | string[] | No | Run IDs providing evidence |
| `timeout_seconds` | integer | Yes | Time for human to respond |
| `timeout_action` | string | Yes | `"deny"`, `"allow"`, or `"kill"` |
| `status` | string | Yes | `"open"` at creation time |

### 7.5 Chain Verification

All supervisor events use the standard hash chain algorithm:
1. Remove `hash` and `hash_prev` from the event JSON
2. Serialize the remaining fields as canonical JSON (matching the engine's
   serialization order)
3. Compute SHA-256 of the serialized bytes = `hash`
4. `hash_prev` = SHA-256 of the full previous event line (including its
   `hash` and `hash_prev`)

The CLI commands `loopstorm verify` and `loopstorm replay` work on
supervisor audit logs identically to agent audit logs.

### 7.6 Supervisor Events in the Event Store

When supervisor events are ingested into the backend (Mode 2/3), they are
stored in the same `events` table as agent events. The `event_type` prefix
`supervisor_*` distinguishes them. RLS policies scope them to the
supervisor's tenant (which is the same tenant as the customer whose run
triggered the supervisor).

---

## 8. Human Approval Workflow

### 8.1 Proposal Lifecycle

```
                     propose_budget_adjustment()
                     flag_for_review()
                              |
                              v
                     +------------------+
                     | pending_approval |
                     +------------------+
                       /       |       \
                      v        v        v
              +---------+  +----------+  +---------+
              | approved|  | rejected |  | expired |
              +---------+  +----------+  +---------+
                   |
                   v
           (Operator manually applies change)
```

**States:**

| State | Meaning | Transitions to |
|---|---|---|
| `pending_approval` | Waiting for human review | `approved`, `rejected`, `expired` |
| `approved` | Human approved the proposal | Terminal |
| `rejected` | Human rejected the proposal | Terminal |
| `expired` | Timeout elapsed without human action | Terminal |

**Approval behavior:**
- **Who can approve:** Any user with the `admin` or `operator` role within
  the tenant. The `reviewed_by` field records the user ID.
- **Review notes:** The reviewer MAY add notes explaining their decision.
  Stored in the `review_notes` column.
- **Expiration:** Proposals expire after the `timeout` defined in the
  policy rule (default: 86400 seconds / 24 hours). The `timeout_action`
  from the policy rule determines the effective outcome -- for
  `propose_*` tools, the `timeout_action` is `deny`, meaning expired
  proposals are treated as rejected.

**What happens after approval (v1.1):** See OQ-SUP-3 resolution in
Section 4.3 (`propose_budget_adjustment`). The operator manually applies
the change. No automated policy push.

**Database alignment:** The `supervisor_proposals` table in
`packages/backend/src/db/schema.ts` stores proposals with these exact
status values and has columns for `reviewed_by`, `reviewed_at`,
`review_notes`, and `proposed_changes`.

### 8.2 Escalation Lifecycle

```
                     escalate_to_human()
                              |
                              v
                        +------+
                        | open |
                        +------+
                       /       \
                      v         v
            +--------------+  +---------+
            | acknowledged |  | expired |
            +--------------+  +---------+
                   |
                   v
             +-----------+
             | resolved  |
             +-----------+
```

**States:**

| State | Meaning | Transitions to |
|---|---|---|
| `open` | Awaiting human acknowledgment | `acknowledged`, `expired` |
| `acknowledged` | Human has seen and acknowledged the escalation | `resolved` |
| `resolved` | Human has taken action and closed the escalation | Terminal |
| `expired` | `timeout_seconds` elapsed without acknowledgment | Terminal |

**Acknowledgment behavior:**
- **Who can acknowledge:** Any user within the tenant. The
  `acknowledged_by` field records the user ID.
- **Push notifications:** In Mode 3, escalation creation triggers a push
  notification to the mobile app and a real-time update to the web
  dashboard (via Supabase Realtime when available, polling otherwise).
- **Resolution notes:** The acknowledger MAY add `resolution_notes`
  describing the action taken.

### 8.3 Timeout Behavior

**Proposals:**
- Timeout is defined by the `timeout` field on the `require_approval` rule
  in the supervisor policy (default: 86400 seconds = 24 hours).
- On timeout, the proposal transitions to `expired` status.
- The `timeout_action: deny` means the proposal is effectively rejected.
- A `system_event` is emitted in the supervisor's audit trail recording
  the expiration.

**Escalations:**
- Timeout is defined by the `timeout_seconds` parameter passed by the
  supervisor when calling `escalate_to_human`.
- On timeout, the escalation transitions to `expired` status.
- The `timeout_action` (as specified by the supervisor) is logged as advisory.
  In v1.1, the backend does NOT automatically execute the `timeout_action`
  against the triggering run because the supervisor has no enforcement
  plane access. In Mode 3, the backend MAY implement `timeout_action`
  execution as a separate backend-side process that is NOT part of the
  supervisor's execution context.
- A `system_event` is emitted in the supervisor's audit trail recording
  the timeout.

**Timeout evaluation:** The backend runs a periodic job (every 60 seconds)
that checks for expired proposals and escalations. When an item expires,
it updates the status and emits the corresponding `system_event`.

### 8.4 Approval Surfaces

| Surface | Mode | Capabilities |
|---|---|---|
| Web dashboard | Mode 2/3 | View proposals/escalations, approve/reject proposals, acknowledge/resolve escalations, add notes |
| Mobile app (Expo) | Mode 3 | Push notifications, approve/reject proposals, acknowledge escalations |
| tRPC API | Mode 2/3 | Programmatic approval/rejection via `supervisor.approveProposal`, `supervisor.rejectProposal`, `supervisor.acknowledgeEscalation` |

---

## 9. Data Isolation

### 9.1 Tenant Scoping

All supervisor data access is tenant-scoped via PostgreSQL RLS policies.
The supervisor runs in the context of a specific tenant (the tenant whose
run triggered it). RLS ensures:

- `read_run_events` returns only events with matching `tenant_id`
- `read_agent_baseline` computes baselines from runs with matching `tenant_id`
- `read_policy_pack` returns only packs with matching `tenant_id`
- `query_similar_runs` with `scope="customer"` returns only the tenant's runs

The supervisor's own events are also stored with the tenant's `tenant_id`.

### 9.2 Cross-Customer Intelligence Isolation

`query_similar_runs` with `scope="anonymous_aggregate"`:

- **v1.1:** Returns empty results (see OQ-SUP-2 resolution in Section 4.1).
- **v2 (planned):** Will return anonymized, aggregated data. Anonymization
  requirements:
  - No `run_id`, `agent_name`, `agent_role`, or `tenant_id` in results
  - Only aggregate patterns (fingerprint similarity scores, outcome
    categories, cost ranges)
  - Customer MUST opt in explicitly via tenant settings
  - Customers can opt out at any time; their data is removed from the
    aggregate within 24 hours

### 9.3 Redacted Arguments Only

The supervisor NEVER receives raw (pre-redaction) tool arguments. All tools
that return event data return `args_redacted` (the post-redaction form).
The `args_hash` is available as a one-way hash for pattern matching, but
it cannot be reversed to recover raw arguments.

This applies to:
- `read_run_events`: Events contain `args_redacted`, not raw args
- `compute_risk_score`: Risk signals reference `args_hash`, not raw args
- `analyze_loop_pattern`: Pattern events contain `args_redacted`
- All other tools that surface event data

### 9.4 Supervisor Events Are Tenant-Scoped

The supervisor's own events (its audit trail) are stored with the same
`tenant_id` as the customer whose run triggered the supervisor session.
This means:
- The customer can see the supervisor's audit trail in their dashboard
- The customer can verify the supervisor's hash chain
- The customer can inspect what the supervisor did and why
- No other tenant can see the supervisor's actions on behalf of this tenant

---

## 10. Security Properties

### 10.1 No UDS Connection to Customer Engine

The supervisor process has no UDS client connected to the customer agent's
engine instance. The customer engine's UDS socket path is never configured
in the supervisor's environment. There is no code path that connects them.

### 10.2 Separate Engine Instance (OQ-SUP-1 Resolved)

**Decision:** The supervisor's `loopstorm.wrap()` connects to a SEPARATE
engine instance on LoopStorm's hosted infrastructure.

```
CUSTOMER INFRASTRUCTURE:
  [Customer Agent] --> [Customer Shim] --> [Customer Engine] --> [JSONL]
                                              (UDS: /tmp/loopstorm-engine.sock)

LOOPSTORM HOSTED INFRASTRUCTURE:
  [Supervisor Agent] --> [Supervisor Shim] --> [Supervisor Engine] --> [JSONL]
                                                  (UDS: /tmp/loopstorm-supervisor.sock)
                              |
                              |  (reads via API, not UDS)
                              v
                        [Event Store (PostgreSQL)]
```

**Rationale:** Physical separation makes the enforcement/observation plane
boundary concrete, not just logical. The customer engine runs on the
customer's machine. The supervisor engine runs on LoopStorm's
infrastructure. They share no IPC channel, no file system, and no process
space.

**Mode 1 variant:** In self-hosted deployments (Mode 1), the customer
deploys both the agent engine and the supervisor engine on their own
infrastructure. The two engine instances MUST use different UDS socket paths
and different policy packs. They MUST NOT share an IPC channel.

### 10.3 LLM API Key Management

| Mode | Key management |
|---|---|
| Mode 2/3 | LoopStorm manages the LLM API key. The key is stored in LoopStorm's infrastructure secrets (not in the customer's event store or configuration). The customer never sees the key. |
| Mode 1 | The customer provides and manages their own LLM API key. LoopStorm has no access to it. |

The LLM API key is used only by the supervisor agent process. It is not
passed to any tool, not stored in any event, and not logged in the audit
trail.

### 10.4 Cross-Customer Intelligence Anonymization (v2)

When cross-customer intelligence is implemented (v2), data shared across
customers MUST be anonymized before aggregation:

- All tenant-identifying fields stripped (`tenant_id`, `agent_name`,
  `agent_role`, `run_id`)
- Only structural patterns retained (fingerprint hashes, outcome
  categories, cost ranges)
- Aggregation is one-way: individual runs cannot be reconstructed from
  aggregate data
- Not yet verified -- this is a v2 security requirement, not a v1.1
  claim

---

## 11. v2 Expansion Scope

The following capabilities are identified for v2 awareness. They are NOT
specified in detail and are NOT part of the v1.1 implementation scope.

### 11.1 Policy Rule Proposals

v1.1 supports only budget adjustment proposals. v2 will add:
- `propose_policy_rule(pack_id, rule, rationale, confidence, supporting_runs) -> Proposal`
- `propose_new_policy_pack(name, rules, rationale) -> Proposal`

These tools will also use `require_approval` policy classification.

### 11.2 Cross-Customer Pattern Intelligence

v2 will implement `scope="anonymous_aggregate"` in `query_similar_runs`
with actual cross-customer data. This requires:
- Anonymization pipeline
- Opt-in tenant settings
- Aggregate pattern store (separate from per-tenant event store)
- Privacy audit and compliance review

### 11.3 Supervisor Configurability

v2 will allow operators to configure:
- Tool scope (which tool categories the supervisor can use)
- Aggressiveness level (trigger thresholds, proposal frequency)
- Escalation thresholds (minimum severity for different notification channels)
- Model selection (beyond Mode 1's full override)

### 11.4 Supervisor Performance Metrics

v2 will track:
- Proposal acceptance rate (approved / total proposals)
- Outcome tracking (were approved proposals effective?)
- Self-improvement loop (supervisor adjusts its own confidence calibration
  based on historical approval/rejection patterns)

### 11.5 Automated Policy Push

v2 will optionally allow approved proposals to be automatically applied to
the enforcement core without manual operator intervention. This capability
will be:
- Opt-in only (never default)
- Configurable per proposal type (e.g., auto-apply budget tightening but
  require manual application for budget loosening)
- Auditable (a `policy_update_applied` event is emitted)
- Reversible (an undo mechanism within a configurable window)

---

## Appendix A: Open Question Resolutions

| ID | Question | Decision | Rationale |
|---|---|---|---|
| OQ-SUP-1 | Supervisor engine instance: same as customer or separate? | **Separate engine instance** on LoopStorm hosted infrastructure. | Physical plane separation. The customer engine is on the customer machine; the supervisor engine is on LoopStorm infrastructure. No shared IPC channel. (Section 10.2) |
| OQ-SUP-2 | `query_similar_runs` cross-customer scope in v1.1? | `scope="anonymous_aggregate"` **returns empty** with a message. Parameter exists to avoid future breaking change. | Cross-customer intelligence is v2. The interface is forward-compatible. (Section 4.1, `query_similar_runs`) |
| OQ-SUP-3 | How does an approved proposal get applied? | **Manual operator update** in v1.1. The operator updates their policy YAML file or dashboard policy pack. No automated policy push. | Human remains fully in the loop. Automated push is a v2 capability. (Section 4.3, `propose_budget_adjustment` and Section 8.1) |
| OQ-SUP-4 | Supervisor model selection: pinned version or family? | **Haiku-class model family**, not a pinned version. Deployment configuration selects the specific model. Mode 1 operators can use any LLM with tool support. | Model versions deprecate faster than spec versions. Family requirement is stable; version is deployment config. (Section 3.4) |

---

## Appendix B: Relationship to Existing Backend Tables

This spec's data model aligns with the existing Drizzle ORM schema in
`packages/backend/src/db/schema.ts`. No schema changes are required for
v1.1 supervisor support.

| Spec concept | Backend table | Key columns |
|---|---|---|
| Supervisor audit events | `events` | `event_type` prefixed `supervisor_*`, `supervisor_run_id`, `trigger`, `trigger_run_id`, etc. |
| Proposals | `supervisor_proposals` | `proposal_id`, `status` (`pending` / `approved` / `rejected` / `expired`), `reviewed_by`, `reviewed_at`, `proposed_changes` |
| Escalations | `supervisor_escalations` | `escalation_id`, `status` (`open` / `acknowledged` / `resolved` / `expired`), `acknowledged_by`, `acknowledged_at`, `resolution_notes` |
| Policy packs | `policy_packs` | `content` (JSONB of full policy YAML as JSON), `agent_role` |

**Status value mapping:** The `supervisor_proposals.status` column uses
`"pending"` (not `"pending_approval"`). The event schema uses
`"pending_approval"`. The backend tRPC handler maps between these values
on ingest and query. This is a known minor inconsistency from P3 that does
not affect correctness.

---

## Appendix C: OTel Span Mapping Consistency

Supervisor events map to OTel spans as defined in
`specs/otel-span-mapping.md` Section 6:

- Supervisor sessions are separate OTel traces (own `run_id` = own `trace_id`)
- `trigger_run_id` creates a span link from the supervisor trace to the
  triggering agent trace
- Supervisor spans use `resource.attributes["loopstorm.agent.role"] = "supervisor"`
- Supervisor spans use `service.name = "loopstorm-supervisor"`
- All supervisor-specific fields map to `loopstorm.supervisor.*` attributes

---

## Appendix D: Behavioral Telemetry Visibility

The supervisor can read behavioral telemetry fields
(`call_seq_fingerprint`, `inter_call_ms`, `token_rate_delta`,
`param_shape_hash`) from events returned by `read_run_events`. These
fields are computed by the engine and appear on `policy_decision` events
in the JSONL audit log and event store.

The supervisor uses these fields to:
- Assess behavioral anomalies in `compute_risk_score`
- Identify loop patterns in `analyze_loop_pattern`
- Find similar runs in `query_similar_runs` (via `call_seq_fingerprint`)

The supervisor does NOT compute these fields. It consumes them read-only.

---

## Appendix E: What This Spec Does NOT Define

- The supervisor agent's system prompt or reasoning strategy
- The internal implementation of interpretation tools (e.g., how
  `compute_risk_score` weights individual signals)
- The LLM API integration layer (provider-specific request/response mapping)
- Dashboard UI design for the supervisor tile, proposal review, or
  escalation acknowledgment
- Mobile app push notification infrastructure
- The v2 cross-customer intelligence pipeline
- The v2 automated policy push mechanism
- Supervisor performance benchmarks or SLAs
- The exact model version (see Section 3.4)
