# LoopStorm Guard — TAD Amendment v1.2
## Open Core Model + AI Supervisor Agent Architecture

**Amends:** TAD v1.1  
**Status:** ADOPTED  
**Decision authority:** Ricardo (Founder / Principal Architect)  
**Triggered by:** Strategic decision to go full open-core with AI supervisor as primary commercial moat  

---

## Why This Amendment Exists

TAD v1.1 defined the product as a deterministic enforcement engine with a hosted control plane as the commercial layer. That architecture has a structural survival problem: platform vendors (AWS Bedrock Guardrails, Azure AI Safety, GCP Vertex controls) will ship functionally equivalent deterministic enforcement as a bundled feature by late 2026. A product whose moat is "rules + budget caps + audit trail" cannot win that race.

This amendment makes two foundational changes:

**Change 1:** The commercial moat shifts from "hosted control plane" to "AI Supervisor Agent + cross-customer intelligence network effects." The hosted control plane becomes the delivery mechanism, not the value proposition.

**Change 2:** The AI Supervisor Agent moves from v2 (vague future consideration) to v1.1 (committed MVP with full architecture specification). This is not a feature addition — it is the product's survival mechanism.

The open-core model was already declared in Driver 8. This amendment completes and operationalizes it.

---

## Section 3 — Roadmap (Amended)

### Distribution Philosophy (new subsection, replaces implicit assumptions)

LoopStorm Guard is open-core. This is a distribution strategy, not just a licensing decision.

The open-source enforcement core is the acquisition channel. Engineers discover it, integrate it, trust it, and evangelize it because it is transparent, auditable, and genuinely useful without an account. The commercial layer captures value from the teams that need intelligence, collaboration, and adaptive supervision — capabilities that cannot be replicated by a platform vendor without years of run data.

The model follows the Kafka/Confluent pattern precisely:
- The protocol and enforcement core are open. Platform vendors can implement it. That is fine.
- The intelligence layer compounds with data. Platform vendors starting from zero cannot replicate it in 12 months.
- The community builds the adapter ecosystem (LangChain, TypeScript, Go, AutoGen, CrewAI). LoopStorm maintains the core and the supervisor.

**The moat is not the code. The moat is the accumulated patterns across every guarded run ever executed.**

---

### v1 — Enforcement Foundation (unchanged scope, amended framing)

All technical scope from v1 remains intact. The framing changes:

v1 ships as an OSS-first product. The primary artifact is the open-source release:
- `loopstorm-engine` binary (MIT)
- `loopstorm-py` Python shim (MIT)
- JSONL schema specification (MIT)
- Policy YAML schema specification (MIT)
- Replay / verify CLI (MIT)
- Example policy packs (MIT)
- Local-only deployment mode (fully functional, no account)

The hosted control plane ships simultaneously as the commercial tier, but the OSS release is the lead distribution artifact. GitHub stars, PyPI downloads, and developer integrations are the v1 growth metrics — not paid seats.

---

### v1.1 — AI Supervisor Agent MVP (amended — moved from v2, now committed)

**This is the product's commercial differentiation.**

The AI Supervisor Agent is a first-class AI agent that runs on the LoopStorm observation plane. It is not a dashboard feature, not a chatbot widget, not an async LLM call that appends text to a run page. It is a running agent with tools, constraints, a budget, an audit trail, and its own policy pack. It is itself guarded by the deterministic enforcement core.

**v1.1 AI Supervisor scope:**

Core capability:
- Supervisor runs as a long-lived agent on the LoopStorm hosted infrastructure
- Triggered by: run completion, mid-run risk thresholds (budget > 70%, loop detected, deny spike)
- Reads customer event store via read-only tools (never touches customer infrastructure directly)
- Produces: risk narratives, intervention assessments, policy proposals, escalations
- All supervisor actions are first-class events in the JSONL schema with their own audit trail
- Supervisor is itself wrapped in `loopstorm.wrap()` — same enforcement, same budget caps, same chain

v1.1 supervisor tool set (see ADR-012 for full specification):
```
OBSERVATION:   read_run_events · read_agent_baseline · read_policy_pack · query_similar_runs
INTERPRETATION: compute_risk_score · analyze_loop_pattern · evaluate_recovery_effectiveness
PROPOSAL:      propose_budget_adjustment · flag_for_review (require_approval in policy)
ESCALATION:    escalate_to_human (always allowed — never blocked by policy)
LEARNING:      record_incident_pattern · update_agent_profile · record_intervention_outcome
```

v1.1 supervisor constraints (non-negotiable, see ADR-012):
- Cannot make hard enforcement decisions (allow/deny/kill)
- Cannot modify the deterministic guard core
- Cannot access customer production infrastructure
- All proposals require human approval before execution
- Self-guarded: runs through its own shim instance with its own policy pack
- Budget capped per analysis session ($2.00 default, configurable)
- Full audit trail as first-class JSONL events

**The recursive trust statement (product's deepest architectural truth):**
> The AI Supervisor that watches your agents is itself guarded by the same open-source enforcement core you can inspect on GitHub. Its tool calls are audited. Its budget is capped. Its policy pack is readable. The root of trust is your human-authored YAML file, not our promises.

Additional v1.1 scope (unchanged from TAD v1.1):
- Human-in-the-loop approval workflow (require_approval decisions)
- Supabase Realtime for live approval queue
- Mobile approval app (Expo SDK 52)
- TypeScript shim (Claude Code, Cursor, ADK coverage)
- Agent role identity field in policy YAML
- MCP proxy architecture design (implementation v1.1 or v2)
- LangChain adapter
- Third loop heuristic (agent state stagnation)
- Model degradation action on soft cap

---

### v2 — Cross-Run Intelligence + Platform Scale (amended)

The v2 AI supervisor additions:
- Cross-run knowledge store: vector similarity search over anonymized run corpus
- Cross-customer pattern intelligence: opt-in aggregate incident families, tool/model risk profiles, policy effectiveness data
- Full supervisor tool set: policy rule proposals, new policy pack proposals, agent profile management
- Supervisor performance metrics: proposal acceptance rate, outcome tracking, self-improvement loop
- Supervisor configurability: operators can set tool scope, aggressiveness level, escalation thresholds, model selection
- Behavioral anomaly detection layer: ML over call sequencing and token consumption patterns (augments, never replaces heuristics)

The cross-customer intelligence layer is the compounding moat. Every run that any customer executes feeds (anonymized, opt-in) into aggregate pattern recognition that makes every supervisor smarter. A new customer on day one gets the benefit of every prior incident family ever seen. This cannot be replicated by a vendor starting from zero run data.

Other v2 scope (unchanged from TAD v1.1):
- Cross-run budget accumulation with time-window semantics
- Enterprise self-hosted packaging
- Go and other runtime shims
- Network-level sidecar / proxy mode
- Policy editor in UI with version control
- RBAC and SSO
- Multi-region deployment

---

## Section 4 — Deployment Modes (Amended)

Replace the three existing modes with four modes. Mode 0 is new and must be supported from v1.

---

**Mode 0 — Pure OSS, Air-Gapped (new, v1)**

Engine binary + Python shim + JSONL file + replay CLI. No backend. No network. No account. No telemetry. Nothing leaves the machine.

This is a complete, production-grade deployment for:
- Individual developers evaluating LoopStorm before committing to the commercial tier
- Security engineers running pre-production audits without sharing data
- Air-gapped environments where no external network calls are permissible
- Open-source contributors building adapters and integrations
- Enterprise POC phases before procurement approval

Everything in the OSS tier is fully functional in Mode 0. Enforcement is real. Budget caps are real. Loop detection is real. Hash chain integrity is real. The replay CLI works. Policy packs work.

Mode 0 is the product's primary distribution mechanism. GitHub stars come from Mode 0. Word-of-mouth comes from Mode 0. Enterprise pilots start in Mode 0 and graduate to Mode 2.

---

**Mode 1 — OSS Local + Self-Hosted Control Plane (v2, Enterprise)**

OSS components run on customer infrastructure. The full control plane — Hono API, Supabase, Next.js UI — is also deployed within the customer's own infrastructure. No event data reaches LoopStorm's cloud.

The architecture is designed for this from the start. No code changes required to support self-hosting. Mode 1 requires packaging, deployment documentation, and operational support commitments.

The AI Supervisor Agent in self-hosted Mode 1 runs on the customer's infrastructure against a customer-specified LLM provider. Cross-customer intelligence is not available (no data leaves customer infrastructure).

---

**Mode 2 — OSS Local Engine + Hosted Control Plane (v1 Commercial)**

Engine binary and shim run on the customer's infrastructure. Events are forwarded to the LoopStorm-hosted backend via the HTTP batch sink. The web UI provides run timeline, hash chain verification, and (in v1.1) AI supervisor output.

The JSONL file remains the ground truth. The hosted backend is a secondary storage and viewing layer. The AI Supervisor runs on LoopStorm's infrastructure, reading the customer's event store. Cross-customer intelligence is available if the customer opts in.

This is the primary commercial offering in v1/v1.1.

---

**Mode 3 — Full Stack with AI Supervisor (v1.1 Commercial Tier 2)**

Mode 2 plus: AI Supervisor Agent active, mobile approval app, real-time approval queue, cross-customer intelligence (opt-in), alert rules, OTEL exporter.

The AI Supervisor runs as a live agent on LoopStorm's hosted infrastructure, watching the customer's agents continuously. The supervisor is visible in the control plane as a first-class agent tile with its own run log, budget, and chain.

---

## Section 5 — Architecture Drivers (Amendments)

**Driver 4 — Determinism First, AI Supervision Second (replaces current Driver 4 text)**

All enforcement decisions in the critical runtime path are produced by deterministic logic. AI is never in the P99 < 5ms enforcement path. The AI Supervisor operates on the observation plane — asynchronously, after calls have been decided by the deterministic core. This separation is architectural, not just operational: the supervisor has no write access to the enforcement path. It can propose changes via the proposal mechanism, which require human approval before the deterministic core is updated.

**Driver 8 — Open-Core Viability (amended)**

The enforcement core (engine, shims, JSONL schema, policy YAML schema, replay CLI) is MIT-licensed and must remain genuinely useful as a standalone offline tool. The commercial moat is the AI Supervisor Agent and the cross-customer intelligence network effects that compound with scale — not the enforcement core itself, and not the hosted control plane alone.

This means:
1. OSS components must never be deliberately hobbled or made backend-dependent
2. The AI Supervisor must never be partially open-sourced in a way that degrades the OSS experience
3. The boundary between OSS and commercial must be principled and defensible, not arbitrary

The principled boundary: **OSS gives you "did it enforce correctly?"** The commercial tier gives you **"why did it fail, what will fail next, and how should you configure it differently?"**

**Driver 10 — Recursive Integrity (new)**

The AI Supervisor Agent is itself subject to the same enforcement constraints it applies to customer agents. It runs through a `loopstorm.wrap()` instance. Its tool calls are intercepted, evaluated against its policy pack, and recorded in a JSONL audit trail. Its budget is capped. This is not a limitation imposed for safety theater — it is the product's deepest trust proposition. The system eats its own cooking. Every claim LoopStorm makes about agent safety applies to its own supervisor.

---

## Section 6 — Control Philosophy (Amended)

**Add Stage 5 — Adapt (new)**

**Technical expression:** AI Supervisor Agent operating on the observation plane.

After every run reaches a terminal state, and asynchronously during runs that cross risk thresholds, the supervisor agent reads the event log and produces structured output: risk assessments, pattern records, intervention evaluations, policy proposals, and escalations. Over time, the deterministic guard becomes more accurately calibrated to each agent's actual behavior — without requiring manual policy tuning by the operator.

The supervisor is not autonomous in v1.1. Every action it proposes requires human approval. It has no write access to the enforcement path. It is the mechanism by which human judgment is assisted, not replaced.

The supervisor's output feeds back into the system via three channels:
1. **Immediate escalation:** high-severity signals during a running run → human approval queue
2. **Policy proposals:** post-run pattern analysis → proposed policy rule → human approval → deterministic core update
3. **Learning store:** incident patterns, agent profiles, intervention outcomes → accumulated context for future supervisor runs

**What the five stages look like together:**

```
Stage 1 — Prevent   [deterministic] Policy enforcement at the call interception boundary
Stage 2 — Detect    [deterministic] Loop-detection heuristics running within a run
Stage 3 — Recover   [deterministic] Bounded recovery: cooldown + corrective context injection
Stage 4 — Contain   [deterministic] Safe termination with evidence preservation
Stage 5 — Adapt     [AI-assisted]   Supervisor agent: interpret · propose · escalate · learn
                    ↑ advisory only · human approval required · self-guarded
```

The deterministic core handles Stages 1-4 completely. The AI Supervisor operates exclusively in Stage 5. This separation is the architectural guarantee that enforcement integrity does not depend on AI reliability.

---

## Section 7 — New: Open-Core Boundary Specification

This section defines exactly what is OSS and what is commercial. The boundary must be principled, stable, and publicly communicated. Developers must never be surprised by which tier a capability falls in.

### OSS Tier (MIT License)

Everything a developer needs to run LoopStorm Guard in production without an account:

**Core enforcement:**
- `loopstorm-engine` — Rust binary: redactor, policy evaluator, budget engine, loop detector, hash chain builder
- `loopstorm-py` — Python shim: OpenAI adapter, generic tool wrapper, UDS IPC client
- `loopstorm-ts` — TypeScript shim (v1.1): same IPC protocol, MCP-native agent support

**Schema specifications (public standards):**
- JSONL event schema
- Policy YAML schema (including `agent_role` field, v1.1)
- DecisionRequest / DecisionResponse IPC schema

**Developer tooling:**
- `loopstorm` CLI: replay, verify, filter, import JSONL, chain check
- Example policy packs (deny-cloud-metadata, deny-private-ranges, etc.)
- Docker image for local engine deployment

**Loop detection:**
- Heuristic 1: repeated identical call fingerprint
- Heuristic 2: repeated identical error response
- Heuristic 3 (v1.1): agent state stagnation

**Deployment mode:**
- Mode 0: fully functional offline, no account, no telemetry

---

### Commercial Tier (Proprietary)

Everything that requires the hosted infrastructure or the AI Supervisor:

**AI Supervisor Agent:**
- Supervisor agent runtime and tool set
- Risk narrative generation
- Policy proposal engine
- Escalation workflow
- Learning store (incident patterns, agent profiles)
- Cross-customer pattern intelligence (opt-in)

**Hosted Control Plane:**
- Next.js web UI
- Hono API (Cloudflare Workers event ingest)
- Supabase hosted deployment (multi-tenant, RLS isolation)

**Operational features:**
- Human-in-the-loop approval workflow (UI + mobile)
- Mobile approval app (Expo)
- Real-time approval queue (Supabase Realtime)
- Alert rules with email/webhook notifications
- OTEL event exporter (Datadog, Grafana, SIEM integration)
- Signed checkpoint anchoring (KMS-backed)

**Enterprise features (v2):**
- Self-hosted packaging with full control plane
- RBAC and SSO
- Cross-run budget accumulation
- Supervisor configurability
- Multi-region deployment

---

### Why This Boundary Is Defensible

The OSS tier gives you: **"Is my agent guarded right now? Did the guard fire correctly? Is the audit log intact?"**

The commercial tier gives you: **"Why is my agent in danger? What will happen next? What should I change? What have similar agents done in this situation?"**

A platform vendor can implement the OSS tier. They cannot replicate the commercial tier without years of cross-customer run data and a purpose-built supervisor agent trained on agent safety patterns. The moat compounds over time. The OSS tier is the distribution mechanism that builds the data flywheel.

---

## Section 8 — New: AI Supervisor Agent Architecture

See ADR-012 for the full architecture decision record. This section captures the normative specification.

### Supervisor Execution Model

The supervisor is a long-lived AI agent running on the LoopStorm hosted infrastructure (Mode 2/3). It operates on the **observation plane** — a read-only view of the customer's event store, completely separate from the enforcement critical path.

```
ENFORCEMENT PLANE (P99 < 5ms, deterministic):
  [Agent] → [Shim] → [Engine] → [Decision] → [JSONL]
  
  The supervisor has NO access to this plane.
  The supervisor CANNOT intercept, modify, or delay decisions.
  
OBSERVATION PLANE (async, seconds-to-minutes, AI-assisted):
  [JSONL / Event Store] → [Supervisor Tools] → [Supervisor Agent]
                                                      ↓
                          [Risk Narratives · Proposals · Escalations]
                                                      ↓
                                          [Human Approval Queue]
                                                      ↓
                              [Deterministic Core Update (if approved)]
```

The supervisor never touches the enforcement plane. It reads from the event store via read-only tools. It writes to the proposal queue, the escalation queue, and its own learning store. Approved proposals are applied to the deterministic core by a separate, human-gated process.

### Supervisor as First-Class Agent

The supervisor is visible in the control plane as an agent tile identical in structure to any customer agent:

```
loopstorm-supervisor
Agent role: supervisor · system
Model: claude-3-5-haiku (cheapest capable model — cost engineering matters)
Budget: $2.00/session · Policy: supervisor-policy.yaml
Chain: ● VALID · [n] events this session
Last action: PROPOSAL — budget adjustment for data-processor-v2
```

This is not cosmetic. It is the product's trust architecture made visible. The supervisor has a budget cap. If it tries to exceed it, the enforcement core kills it. The customer can inspect its policy pack. They can see every tool call it made. They can verify its chain. They can tighten its budget. They are in control of the supervisor's scope.

### Supervisor Tool Set (v1.1 MVP)

**OBSERVATION tools (always allowed):**
```python
read_run_events(run_id: str, limit: int = 500) → List[Event]
  # Read event log for a specific run. Read-only. Never returns raw PII (already redacted).

read_agent_baseline(agent_name: str, lookback_days: int = 30) → AgentBaseline
  # Read statistical baseline: avg cost/run, typical call patterns, historical denials.

read_policy_pack(pack_id: str) → PolicyPack
  # Read the active policy rules for an agent. Read-only.

query_similar_runs(
    fingerprint: str,
    top_k: int = 5,
    scope: Literal["customer", "anonymous_aggregate"] = "customer"
) → List[SimilarRun]
  # Find runs with similar call fingerprint patterns. 
  # scope="customer": customer's own runs only (always available)
  # scope="anonymous_aggregate": cross-customer patterns (opt-in only)
```

**INTERPRETATION tools (always allowed, produce structured output):**
```python
compute_risk_score(run_id: str) → RiskAssessment
  # Returns: score (0-100), tier (LOW/MEDIUM/HIGH/CRITICAL),
  #          signals: List[RiskSignal], narrative: str, confidence: float

analyze_loop_pattern(run_id: str) → LoopAnalysis
  # Returns: detected (bool), heuristic (str), pattern_events: List[Event],
  #          recovery_attempted (bool), recovery_effective (bool),
  #          narrative: str

evaluate_recovery_effectiveness(
    run_id: str,
    intervention_event_id: str
) → RecoveryEvaluation
  # Returns: effective (bool), evidence: str, recommended_next_action: str
```

**PROPOSAL tools (require_approval in supervisor policy):**
```python
propose_budget_adjustment(
    target: Literal["run", "agent"],
    target_id: str,
    dimension: str,          # "cost_usd" | "call_count" | etc.
    current_value: float,
    proposed_value: float,
    rationale: str,
    confidence: float,
    supporting_runs: List[str]
) → Proposal
  # Creates a proposal in the human approval queue.
  # Does NOT modify the budget. Human must approve.

flag_for_review(
    run_id: str,
    severity: Literal["low", "medium", "high", "critical"],
    notes: str
) → ReviewFlag
  # Flags a run for human attention without proposing specific action.
  # Always allowed (lower stakes than a proposal).
```

**ESCALATION tools (always allowed — never blocked by policy):**
```python
escalate_to_human(
    run_id: str,
    severity: Literal["medium", "high", "critical"],
    recommendation: str,
    context: str,
    timeout_seconds: int,
    timeout_action: Literal["deny", "allow", "kill"]
) → Escalation
  # Triggers immediate human approval queue entry with push notification.
  # timeout_action executes if human doesn't respond within timeout_seconds.
  # ALWAYS ALLOWED. This tool must never be blocked by the supervisor's policy.
  # If the supervisor can't escalate, the human-in-the-loop guarantee breaks.
```

**LEARNING tools (always allowed, write to supervisor knowledge store):**
```python
record_incident_pattern(
    name: str,
    description: str,
    run_ids: List[str],
    outcome: str,
    prevention_notes: str
) → IncidentPattern

update_agent_profile(
    agent_name: str,
    behavioral_notes: str,
    risk_profile_update: Dict
) → AgentProfile

record_intervention_outcome(
    intervention_event_id: str,
    outcome: Literal["effective", "ineffective", "partial"],
    evidence: str
) → InterventionRecord
```

### Supervisor Policy Pack (readable by customers, hardened)

```yaml
# supervisor-policy.yaml
# This is LoopStorm's own policy pack for its own supervisor.
# Customers can inspect this. They can also override it for their
# self-hosted deployment.

agent_role: supervisor

rules:
  # Observation is always allowed — reading never causes harm
  - name: allow-observation-tools
    action: allow
    tool_pattern: "read_*|query_*"

  # Interpretation is always allowed — analysis never causes harm
  - name: allow-interpretation-tools
    action: allow
    tool_pattern: "compute_*|analyze_*|evaluate_*"

  # Flagging is always allowed — low-stakes attention request
  - name: allow-flag-for-review
    action: allow
    tool: flag_for_review

  # Escalation is ALWAYS ALLOWED — never block the human escalation path
  # This rule must be listed before any catch-all deny rules
  - name: allow-escalation
    action: allow
    tool: escalate_to_human

  # Proposals require human approval — supervisor cannot act unilaterally
  - name: require-approval-proposals
    action: require_approval
    tool_pattern: "propose_*"
    timeout: 86400        # 24 hours; if no human response, proposal auto-denied
    timeout_action: deny

  # Learning writes are allowed and audited
  - name: allow-learning-tools
    action: allow
    tool_pattern: "record_*|update_*"

  # Hard deny: supervisor cannot touch production infrastructure
  - name: deny-production-execution
    action: deny
    tool_pattern: "execute_*|write_*|delete_*|modify_*"

  # Hard deny: supervisor cannot call external APIs except approved providers
  - name: deny-external-calls
    action: deny
    tool: http.request
    conditions:
      - field: url
        operator: not_matches
        pattern: "https://(api.anthropic.com|api.openai.com)/.*"

budget:
  cost_usd:
    hard: 2.00     # supervisor killed if it spends more than $2 per session
    soft: 1.50     # warning event emitted at $1.50
  call_count:
    hard: 100      # supervisor killed if it makes more than 100 tool calls per session
```

### Supervisor Trigger Conditions

**Post-run triggers (Mode A — analysis):**
- Run transitions to `terminated_budget`
- Run transitions to `terminated_loop`
- Run transitions to `abandoned`
- Run completes with 1+ DENY decisions
- Run completes with cost > 80% of budget cap

**Mid-run triggers (Mode B — live monitoring, v1.1):**
- Budget crosses 70% of hard cap mid-run
- Loop detection fires (cooldown applied)
- Deny rate for current run exceeds 3× agent baseline
- Same enforcement rule fires 3+ times in one run

**Scheduled triggers (v2):**
- Daily summary across all agents
- Weekly policy effectiveness report
- Cross-run pattern scan (new incidents)

### Supervisor Audit Trail Schema

Every supervisor action is a first-class JSONL event. The supervisor's run is auditable with the same chain verification as any other run.

```jsonc
// supervisor_run_started
{
  "event_type": "supervisor_run_started",
  "supervisor_run_id": "sup_8f2a1c9e",
  "trigger": "run_completed",
  "trigger_run_id": "a4d9e7f2",
  "agent_name": "loopstorm-supervisor",
  "agent_role": "supervisor",
  "model": "claude-3-5-haiku-20251001",
  "policy_pack_id": "supervisor-policy-v2",
  "budget": { "cost_usd": { "hard": 2.00, "soft": 1.50 } },
  "seq": 1,
  "hash": "0x...",
  "hash_prev": null,
  "ts": "2026-03-11T14:25:01Z"
}

// supervisor_tool_call
{
  "event_type": "supervisor_tool_call",
  "supervisor_run_id": "sup_8f2a1c9e",
  "tool": "analyze_loop_pattern",
  "args_hash": "0xf2a1c8...",     // args fingerprint, not raw args
  "decision": "allow",
  "latency_ms": 89,
  "seq": 4,
  "hash": "0x...",
  "hash_prev": "0x...",
  "ts": "2026-03-11T14:25:05Z"
}

// supervisor_proposal_created
{
  "event_type": "supervisor_proposal_created",
  "supervisor_run_id": "sup_8f2a1c9e",
  "proposal_id": "prop_2c8a4f1b",
  "proposal_type": "budget_adjustment",
  "target_agent": "data-processor-v2",
  "rationale": "30-day average cost is $2.84/run. Current cap is $5.00. Tightening to $3.50 reduces blast radius without impacting normal operation.",
  "confidence": 0.87,
  "supporting_runs": ["a4d9e7f2", "b7c3f1a9", "c2e8d4b6"],
  "status": "pending_approval",
  "seq": 7,
  "hash": "0x...",
  "hash_prev": "0x...",
  "ts": "2026-03-11T14:25:09Z"
}

// supervisor_escalation_created
{
  "event_type": "supervisor_escalation_created",
  "supervisor_run_id": "sup_8f2a1c9e",
  "escalation_id": "esc_9d3b7e2a",
  "run_id": "a4d9e7f2",
  "severity": "high",
  "recommendation": "This run has spent $4.21 of its $5.00 cap in the last 3 minutes. The call pattern matches a known extraction loop. Consider terminating manually or reducing the budget cap.",
  "timeout_seconds": 300,
  "timeout_action": "deny",
  "seq": 3,
  "hash": "0x...",
  "hash_prev": "0x...",
  "ts": "2026-03-11T14:24:02Z"
}
```

---

## Section 4 — Architectural Principles (Amendments)

**Principle 4 — amended:**

~~"Determinism first, AI assistance later. All v1 enforcement decisions are produced by deterministic logic. AI is not in the v1 decision path. AI supervisory capability is a v2 consideration."~~

**Replacement:**

Determinism in the enforcement path. AI supervision on the observation plane.

All enforcement decisions (allow/deny/kill/cooldown) are produced by deterministic logic in the Rust engine. AI is never in the P99 < 5ms enforcement critical path in any version.

The AI Supervisor operates exclusively on the observation plane — asynchronously, after decisions have been made, reading the event store. It cannot modify enforcement decisions. It can propose changes to the deterministic core that require human approval before taking effect. The architectural separation between the enforcement plane and the observation plane is permanent and inviolable. Merging them — allowing the AI supervisor to make real-time enforcement decisions — is explicitly out of scope in all versions.

**Principle 11 — new:**

The supervisor eats its own cooking. The AI Supervisor Agent runs through a `loopstorm.wrap()` instance. Its tool calls are intercepted by the enforcement core. Its budget is enforced. Its audit trail uses the same JSONL schema as any customer agent. Any claim LoopStorm makes about the safety properties of its enforcement system applies to its own supervisor, visibly and verifiably.

---

## Impact on v1 Deliverables

v1 ships unchanged technically. The amendments to v1 are:

1. **OSS release is the primary artifact.** GitHub repository, PyPI package, and documentation are launch deliverables, not afterthoughts. The launch announcement is "LoopStorm Guard is open source" not "LoopStorm Guard is available."

2. **Supervisor infrastructure scaffolding ships in v1.** The supervisor agent tile exists in the UI. The supervisor JSONL schema is defined and reserved. The supervisor policy pack schema is published. The supervisor does not yet make proposals or escalations in v1 — it runs in observation-only mode, producing risk narratives. Full proposal and escalation capability ships in v1.1.

3. **Mode 0 is the documented primary deployment mode.** Documentation, README, and onboarding flow lead with the no-account local deployment. The hosted control plane is presented as "what you get when you're ready for a team."

---

## Risks and Mitigations

**Risk 1 — Supervisor scope creep.** Giving the supervisor a rich tool set creates pressure to add more tools over time, blurring the enforcement/observation boundary.
Mitigation: The boundary is architectural, not configurable. The enforcement plane's IPC channel is not exposed to the supervisor process. It cannot call it regardless of policy configuration.

**Risk 2 — Supervisor cost.** A supervisor that runs after every run could generate significant LLM costs at scale.
Mitigation: $2.00/session hard budget cap. Supervisor is triggered only on runs that cross thresholds (not on every clean completion). The haiku-class model is used by default. Cost per customer is bounded and predictable.

**Risk 3 — Customers don't trust an AI that watches their agents.** Enterprise buyers may be skeptical of an AI running on their data.
Mitigation: The supervisor's policy pack is readable. Its tool calls are audited. Its budget is capped. It cannot access customer infrastructure. The entire trust story is verifiable, not promised. Self-hosted Mode 1 removes LoopStorm's infrastructure from the picture entirely.

**Risk 4 — OSS contributors modify the enforcement core in ways that break the trust model.**
Mitigation: The enforcement core is MIT-licensed but the canonical implementation is the LoopStorm-maintained binary. The JSONL schema and policy schema are specifications — third-party implementations are fine. The supervisor's read-only tools validate event chain integrity before reading — if a modified engine breaks the chain, the supervisor surfaces it.

**Risk 5 — Platform vendors fork the OSS core and offer managed LoopStorm.**
Mitigation: This is explicitly acceptable. The enforcement core is MIT for this reason. Platform vendors hosting the enforcement core expands the LoopStorm event schema as a standard, which makes the supervisor more valuable (more data, more patterns). Their managed offering will lack the supervisor and the cross-customer intelligence. That's the moat.
