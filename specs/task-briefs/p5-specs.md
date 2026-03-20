<!-- SPDX-License-Identifier: MIT -->
# Task Brief: P5 -- Remaining Specifications

**Priority:** P5
**Assignee:** `loopstorm-lead-architect` agent (specs are design artifacts, not implementation)
**Branch:** `feat/p5-specs` (from `main` at latest)
**Gate:** P5 Specifications Gate -- RESOLVED by this document
**Blocked by:** P0-P4 (all merged or in progress)
**Blocks:** v1.1 implementation planning, TypeScript shim, MCP proxy implementation, OTel exporter, AI Supervisor implementation
**Date:** 2026-03-20

---

## 1. Objective

Deliver the four remaining specification documents required by the system
prompt and product roadmap. These specs are design artifacts -- they define
interfaces, schemas, and protocols that downstream implementation agents
consume. They do not contain code.

After this task:

1. `specs/behavioral-telemetry.md` defines the 4 behavioral telemetry fields
   to be captured in v1.1 for use by the v2 anomaly detector.
2. `specs/mcp-proxy-mode.md` defines the MCP proxy architecture, protocol
   translation, and deployment model.
3. `specs/otel-span-mapping.md` defines how JSONL events map to
   OpenTelemetry spans for export to Datadog/Grafana/SIEM.
4. `specs/ai-supervisory-interface.md` defines the supervisor tool set
   contract, trigger conditions, execution model, and audit trail schema.

Additionally, two deferred CLI subcommands (`filter` and `import`) are
referenced in the OSS release checklist but were deferred from P2. Their
specs are scoped as optional addenda to this task if time permits.

---

## 2. Constraints

| # | Constraint | Source |
|---|---|---|
| C1 | **Design artifacts only** -- no implementation code, no engine changes, no schema file modifications | Lead architect role |
| C2 | **Mode 0 first** -- every spec must state which parts work air-gapped and which require the hosted tier | Product architecture |
| C3 | **Enforcement/observation plane separation** -- any spec that touches both planes must explicitly identify the boundary | ADR-012 |
| C4 | **SPDX headers** -- `<!-- SPDX-License-Identifier: MIT -->` on all spec files (specs are in the MIT `schemas/` + `specs/` tier) | ADR-013 |
| C5 | **Smallest credible v1.1 scope** -- specs define what ships in v1.1 vs what is deferred to v2. No aspirational features in the v1.1 columns | System prompt |
| C6 | **No vague security claims** -- if a security property is claimed, it must reference a testable condition or be marked "not yet verified" | System prompt |
| C7 | **Schema changes require version bump** -- if any spec proposes new fields in the event schema, it must note that `schema_version` 2 is required and list affected consumers | ADR-003 |
| C8 | **`escalate_to_human` invariant** -- the AI supervisory interface spec must verify this invariant is preserved in the supervisor tool set design | ADR-012 |

---

## 3. Inventory of Existing Artifacts

### 3.1 Specs Already Written

| Spec | Path | Status |
|---|---|---|
| IPC Wire Format | `specs/ipc-wire-format.md` | Authoritative (v1.0, 2026-03-16) |
| args_hash Computation | `specs/args-hash.md` | Normative (v1, 2026-03-15, errata 2026-03-17) |

### 3.2 Specs to Write (This Task)

| Spec | Target Path | ADR Dependencies |
|---|---|---|
| Behavioral Telemetry | `specs/behavioral-telemetry.md` | ADR-007 (budget), ADR-010 (semantic matching, context only) |
| MCP Proxy Mode | `specs/mcp-proxy-mode.md` | ADR-009 (MCP proxy mode) |
| OTel Span Mapping | `specs/otel-span-mapping.md` | ADR-001 (IPC/events), ADR-007 (budget) |
| AI Supervisory Interface | `specs/ai-supervisory-interface.md` | ADR-012 (supervisor architecture), ADR-002 (fail-closed), ADR-008 (agent_role) |

### 3.3 Key Source Documents

| Document | Path | Relevance |
|---|---|---|
| Product Document v1.3 | `LoopStorm_Guard_v1.3_Product_Document.md` | Action 3 (MCP), Action 4 (behavioral telemetry + OTel), supervisor architecture |
| TAD Amendment v1.2 | `tad-amendment-v1_2.md` | Supervisor tool set (Section 8), trigger conditions, v1.1/v2 scope |
| Control Philosophy | `docs/control-philosophy.md` | Five-stage model; specs must align to stages |
| OWASP Mapping | `docs/owasp-agentic-mapping.md` | AA5 (MCP transport), AA8 (audit/OTel), AA3 (supervisor) |
| Deployment Modes | `docs/deployment-modes.md` | Mode constraints per spec |
| Event Schema | `schemas/events/event.schema.json` | Existing fields; new fields must not collide |
| Decision Request/Response | `schemas/ipc/decision-*.schema.json` | MCP proxy must translate to/from these |

---

## 4. Spec Outlines and Scope

### 4.1 Behavioral Telemetry (`specs/behavioral-telemetry.md`)

**Purpose:** Define four telemetry fields to be captured by the engine (or
shim) during v1.1 and stored in the event schema. These fields exist solely
to support the v2 behavioral anomaly detector. The detector itself is out
of scope -- only the data collection schema is specified here.

**Source authority:** Product Document Action 4: "The design decision --
which fields to capture -- must be made in v1.1. The detector itself is a
v2 capability."

**Control philosophy alignment:** Stage 2 (Detect) -- the telemetry feeds
future detection heuristics. The data is captured in the enforcement plane;
the detector will operate on the observation plane.

**Required fields (from system prompt):**

| Field | Type | Description |
|---|---|---|
| `call_seq_fingerprint` | `string` (hex) | Rolling hash of the last N `(tool, args_hash)` tuples. Captures call sequencing patterns without storing raw call history. |
| `inter_call_ms` | `integer` | Milliseconds elapsed since the previous tool call in this run. Captures timing patterns. |
| `token_rate_delta` | `number` | Ratio of this call's token consumption to the run's rolling average. Values >> 1.0 indicate consumption spikes. |
| `param_shape_hash` | `string` (hex) | SHA-256 of the sorted list of object keys in `args` (structure, not values). Captures parameter distribution changes. |

**Outline:**

1. Overview (purpose, v1.1 data capture / v2 detector split)
2. Field Definitions (type, computation algorithm, edge cases)
3. Placement in Event Schema (which `event_type`s carry these fields; likely `policy_decision` only)
4. Schema Version Impact (new optional fields = schema_version 2? or additive optional in v1?)
5. Mode 0 Behavior (fields computed locally, stored in JSONL -- no hosted tier required)
6. Privacy Considerations (fingerprints/hashes, not raw values)
7. Cross-Language Implementation Notes (Rust engine, Python shim, TS shim)
8. Test Vectors (at least 3 vectors for each computed field)
9. Migration Path (how existing v1 JSONL files coexist with v1.1 files containing these fields)

**Open questions to resolve during spec writing:**

- **OQ-BT-1: Schema version bump.** These are new optional fields on
  `policy_decision` events. Under strict ADR-003 compliance, new fields
  require a schema_version bump to 2. However, they are optional and
  additive -- existing consumers ignore them. Decision: should these be
  `schema_version: 1` (additive optional) or `schema_version: 2` (formal
  bump)? **Recommendation:** Keep schema_version 1. Optional additive fields
  do not break consumers. The spec must document this decision explicitly.
- **OQ-BT-2: Where is `call_seq_fingerprint` computed?** The engine sees
  all calls in sequence. The shim does not have cross-call context. This
  must be engine-side. **Recommendation:** All four fields are engine-computed.
- **OQ-BT-3: Rolling window size for `call_seq_fingerprint`.** Product
  document says "call sequence fingerprints" but does not specify window.
  **Recommendation:** Last 5 calls (configurable). Must specify the exact
  rolling hash algorithm.

---

### 4.2 MCP Proxy Mode (`specs/mcp-proxy-mode.md`)

**Purpose:** Define the architecture and protocol for a local MCP proxy
server that intercepts MCP `tools/call` requests and routes them through
the LoopStorm engine for policy enforcement before forwarding to upstream
MCP servers.

**Source authority:** ADR-009, Product Document Action 3.

**Control philosophy alignment:** Stage 1 (Prevent) -- the proxy extends
the enforcement boundary to cover MCP tool calls.

**Scope:**
- v1.1 design deliverable (ADR-009: "design deliverable for v1.1")
- Implementation may extend into v2
- This spec is the design, not the implementation plan

**Outline:**

1. Overview (problem statement: MCP tool calls bypass the shim enforcement boundary)
2. Architecture Diagram (Agent -> LoopStorm MCP Proxy -> Upstream MCP Server(s); Proxy -> Engine via UDS)
3. MCP Protocol Translation
   - 3.1 `tools/call` request -> `DecisionRequest` mapping
   - 3.2 `DecisionResponse` -> MCP response/error mapping
   - 3.3 Decision-to-MCP-error code mapping (`deny` -> MCP error -32603, `kill` -> connection close, `cooldown` -> retry-after, `require_approval` -> pending)
4. Tool Discovery
   - 4.1 Proxy queries upstream for `tools/list` and exposes the same tool list to the agent
   - 4.2 Tool names from upstream are passed through as-is to the engine's `tool` field
   - 4.3 Dynamic tool registration (MCP servers can change their tool list at runtime)
5. Transport
   - 5.1 Agent-to-proxy: MCP standard transports (stdio, SSE, streamable HTTP)
   - 5.2 Proxy-to-engine: UDS IPC (existing protocol, no changes)
   - 5.3 Proxy-to-upstream: MCP standard transports
6. Configuration
   - 6.1 Proxy config file format (upstream server definitions, transport options)
   - 6.2 Policy pack applies identically to MCP-proxied calls
   - 6.3 Budget and loop detection: shared `run_id` context (proxy generates or receives `run_id`)
7. MCP Features Beyond `tools/call`
   - 7.1 Resources: pass-through (no enforcement, logged as system events)
   - 7.2 Prompts: pass-through (no enforcement)
   - 7.3 Sampling: pass-through (no enforcement)
   - 7.4 Notifications: pass-through
   - 7.5 Rationale: v1.1 enforces `tools/call` only. Other MCP capabilities are not blocked but not enforced.
8. Deployment Model
   - 8.1 Mode 0: local proxy binary, no network
   - 8.2 Mode 2/3: proxy + event forwarding to hosted backend
   - 8.3 Proxy lifecycle: started alongside the engine or standalone
9. args_hash for MCP Calls
   - 9.1 MCP `tools/call` sends `arguments` as a JSON object. Same JCS + SHA-256 algorithm as shim.
   - 9.2 If `arguments` is missing, treat as `null` (same as shim spec).
10. Security Considerations
    - 10.1 Proxy runs on localhost only (same as UDS)
    - 10.2 No additional auth between proxy and engine in Mode 0
    - 10.3 MCP transport security is inherited from MCP's own transport layer
11. Latency Impact (additional hop: proxy parse + UDS round-trip + proxy forward)
12. Implementation Language Decision (TypeScript is natural -- MCP SDK is TS-native; but could be Rust)
13. Relationship to Language Shims (additive, not a replacement)

**Open questions to resolve during spec writing:**

- **OQ-MCP-1: Implementation language.** MCP SDK is TypeScript-native
  (`@modelcontextprotocol/sdk`). A TS proxy is the path of least resistance.
  But the engine is Rust, and a Rust MCP proxy would be a single binary.
  **Recommendation:** TypeScript (new package `apps/mcp-proxy/`). MIT licensed.
  The MCP SDK handles transport negotiation; reimplementing it in Rust adds
  months.
- **OQ-MCP-2: run_id generation.** The proxy needs a `run_id` to send in
  `DecisionRequest`. Options: (a) proxy generates it, (b) agent passes it via
  MCP metadata, (c) proxy generates per-connection. **Recommendation:** Proxy
  generates a UUID v7 per connection (each MCP client connection = one run).
  Override via MCP request metadata if the agent provides one.
- **OQ-MCP-3: Seq numbering.** The proxy must track `seq` per run. It is
  the proxy's responsibility, not the upstream server's.
- **OQ-MCP-4: Which MCP spec version?** The MCP spec is evolving. The proxy
  should target MCP 2025-03-26 (latest stable as of March 2026).
  **Recommendation:** Pin to a specific MCP SDK version in the spec.

---

### 4.3 OTel Span Mapping (`specs/otel-span-mapping.md`)

**Purpose:** Define how LoopStorm JSONL events are translated into
OpenTelemetry spans for export to observability backends (Datadog, Grafana
Tempo, Jaeger, SIEM systems).

**Source authority:** Product Document Action 4 (telemetry surface),
Deployment Modes (Mode 3 includes "OTEL event exporter").

**Control philosophy alignment:** Stage 2 (Detect) output format -- OTel
export is an alternative consumption path for enforcement events. It does
not alter enforcement behavior.

**Scope:**
- v1.1 design, Mode 3 feature
- The exporter is a separate process/library that reads JSONL or the event
  store and emits OTel spans. It is NOT in the engine's critical path.
- Mode 0: not applicable (OTel requires a collector endpoint)

**Outline:**

1. Overview (purpose: integrate LoopStorm events into existing observability stacks)
2. OTel Concepts Mapping
   - 2.1 Run -> Trace (`run_id` = `trace_id`)
   - 2.2 Event -> Span (each event becomes a span within the trace)
   - 2.3 Span hierarchy: `run_started` is the root span; `policy_decision` spans are children
3. Event-to-Span Field Mapping Table
   - 3.1 `run_id` -> `trace_id` (deterministic mapping: SHA-128 truncation of UUID or direct if UUIDv7 fits)
   - 3.2 `seq` -> `span_id` (deterministic derivation from run_id + seq)
   - 3.3 `ts` -> span start time
   - 3.4 `event_type` -> `span.name`
   - 3.5 `decision` -> `span.attributes["loopstorm.decision"]`
   - 3.6 `tool` -> `span.attributes["loopstorm.tool"]`
   - 3.7 `rule_id` -> `span.attributes["loopstorm.rule_id"]`
   - 3.8 `budget.*` -> `span.attributes["loopstorm.budget.*"]`
   - 3.9 `args_hash` -> `span.attributes["loopstorm.args_hash"]`
   - 3.10 `latency_ms` -> span duration
   - 3.11 `agent_name` -> `resource.attributes["loopstorm.agent.name"]`
   - 3.12 `agent_role` -> `resource.attributes["loopstorm.agent.role"]`
4. Span Status Mapping
   - 4.1 `allow` -> `SpanStatus.OK`
   - 4.2 `deny` -> `SpanStatus.ERROR` with `StatusMessage` = reason
   - 4.3 `kill` -> `SpanStatus.ERROR` with `StatusMessage` = reason
   - 4.4 `cooldown` -> `SpanStatus.OK` (with attribute marking cooldown)
   - 4.5 `require_approval` -> `SpanStatus.OK` (with attribute marking pending)
5. Span Events (OTel Span Events, not LoopStorm events)
   - 5.1 Budget warnings -> span events on the root span
   - 5.2 Loop detected -> span event on the triggering span
6. Supervisor Spans
   - 6.1 Supervisor runs map to separate traces (different `run_id`)
   - 6.2 `trigger_run_id` creates a span link from supervisor trace to triggering agent trace
   - 6.3 Supervisor spans use `resource.attributes["loopstorm.agent.role"] = "supervisor"`
7. Semantic Conventions
   - 7.1 All LoopStorm-specific attributes use the `loopstorm.` namespace prefix
   - 7.2 Standard OTel attributes used where applicable (`service.name`, `service.version`)
8. Exporter Architecture
   - 8.1 JSONL file reader -> OTel span builder -> OTLP exporter (gRPC or HTTP)
   - 8.2 Event store reader (PostgreSQL) -> OTel span builder -> OTLP exporter
   - 8.3 Exporter runs as a sidecar or batch job, not in the engine process
9. Configuration
   - 9.1 OTLP endpoint URL
   - 9.2 Authentication (API key, bearer token)
   - 9.3 Batch size and flush interval
   - 9.4 Resource attributes (service.name, environment)
10. Limitations
    - 10.1 OTel trace_id is 128 bits; run_id is UUID (128 bits). Direct mapping works.
    - 10.2 OTel span_id is 64 bits; deterministic derivation from (run_id, seq).
    - 10.3 Not all event fields have OTel semantic convention equivalents. Custom attributes are used.
    - 10.4 The exporter does not modify JSONL or engine behavior. It is read-only.

**Open questions to resolve during spec writing:**

- **OQ-OTEL-1: trace_id derivation.** UUID v7 is 128 bits, same as OTel
  trace_id. Direct byte-for-byte mapping? Or hash to avoid version/variant
  bit conflicts? **Recommendation:** Direct byte mapping (strip hyphens,
  hex-encode the 16 bytes). UUIDv7 already has the right bit length.
- **OQ-OTEL-2: span_id derivation.** OTel span_id is 64 bits. We need a
  deterministic mapping from (run_id, seq) -> 64-bit span_id.
  **Recommendation:** First 8 bytes of SHA-256(run_id || seq.to_be_bytes()).
- **OQ-OTEL-3: Span duration.** Events have a single `ts` timestamp, not
  a start+end pair. Options: (a) zero-duration spans, (b) use `latency_ms`
  as duration where available, (c) derive duration as `ts[n+1] - ts[n]`.
  **Recommendation:** Use `latency_ms` as duration where available (present
  on `policy_decision` events). For events without `latency_ms`, use
  zero-duration spans.
- **OQ-OTEL-4: Exporter implementation language.** The exporter could be
  Rust (reads JSONL natively), TypeScript (OTel JS SDK is mature), or Go
  (OTel Go SDK is the reference implementation). **Recommendation:** Defer
  language decision to implementation brief. The spec is language-agnostic.

---

### 4.4 AI Supervisory Interface (`specs/ai-supervisory-interface.md`)

**Purpose:** Define the complete contract for the AI Supervisor Agent: tool
set, trigger conditions, execution model, self-guard configuration, audit
trail schema, and human approval workflow.

**Source authority:** ADR-012 (AI Supervisor architecture), TAD Amendment
v1.2 (Section 8), Product Document (Action 4).

**Control philosophy alignment:** Stage 5 (Adapt) -- the entire supervisor
is Stage 5. This spec is the normative reference for Stage 5 implementation.

**Scope:**
- v1.1 implementation scope: observation-only with proposals and escalations
- v2 scope identified but not specified in detail
- This spec MUST verify the enforcement/observation plane separation
  invariant at every interface point

**Outline:**

1. Overview (the supervisor is a first-class AI agent on the observation plane)
2. Architectural Invariants
   - 2.1 Enforcement/observation plane separation (diagram, with explicit "NO ACCESS" labels)
   - 2.2 `escalate_to_human` is always allowed (never blockable by any policy)
   - 2.3 All proposals require human approval
   - 2.4 Supervisor is self-guarded via `loopstorm.wrap()`
   - 2.5 $2.00/session hard budget cap (configurable)
3. Execution Model
   - 3.1 Long-lived agent on hosted infrastructure (Mode 2/3)
   - 3.2 Triggered by run events (post-run analysis) or mid-run thresholds
   - 3.3 One supervisor session per trigger (not a persistent conversation)
   - 3.4 Model selection: haiku-class by default (cost engineering)
   - 3.5 Mode 0: supervisor does not run (no LLM access). Mode 1: customer-hosted LLM.
4. Tool Set (v1.1 MVP)
   - 4.1 OBSERVATION tools: `read_run_events`, `read_agent_baseline`, `read_policy_pack`, `query_similar_runs`
   - 4.2 INTERPRETATION tools: `compute_risk_score`, `analyze_loop_pattern`, `evaluate_recovery_effectiveness`
   - 4.3 PROPOSAL tools: `propose_budget_adjustment`, `flag_for_review`
   - 4.4 ESCALATION tools: `escalate_to_human`
   - 4.5 LEARNING tools: `record_incident_pattern`, `update_agent_profile`, `record_intervention_outcome`
   - 4.6 For each tool: full type signature, parameter descriptions, return types, policy classification (allow/require_approval), error conditions
5. Supervisor Policy Pack (`supervisor-policy.yaml`)
   - 5.1 Full YAML specification (from TAD amendment)
   - 5.2 Invariant enforcement: no rule in the supervisor policy may deny `escalate_to_human`
   - 5.3 Budget block: $2.00 hard / $1.50 soft cost_usd, 100 hard call_count
   - 5.4 Customers can inspect and (in Mode 1) override this policy
6. Trigger Conditions
   - 6.1 Post-run triggers (Mode A): terminated_budget, terminated_loop, abandoned, deny decisions, cost > 80%
   - 6.2 Mid-run triggers (Mode B, v1.1): budget > 70%, loop detected, deny rate > 3x baseline, same rule 3+ times
   - 6.3 Scheduled triggers (v2, deferred): daily summary, weekly report, pattern scan
7. Audit Trail Schema
   - 7.1 `supervisor_run_started` event fields
   - 7.2 `supervisor_tool_call` event fields
   - 7.3 `supervisor_proposal_created` event fields
   - 7.4 `supervisor_escalation_created` event fields
   - 7.5 All events use the standard hash chain (same `event.schema.json`)
   - 7.6 Supervisor events are in the supervisor's own `run_id` chain, not the triggering agent's chain
8. Human Approval Workflow
   - 8.1 Proposal lifecycle: pending_approval -> approved / rejected
   - 8.2 Escalation lifecycle: open -> acknowledged
   - 8.3 Timeout behavior: configurable per-proposal, default action on timeout
   - 8.4 Approval surfaces: web dashboard, mobile app (v1.1), API
   - 8.5 Approved proposals: applied to deterministic core by a separate human-gated process
9. Data Isolation
   - 9.1 Supervisor reads from the customer's event store (RLS-isolated)
   - 9.2 `query_similar_runs` with `scope="anonymous_aggregate"` requires opt-in
   - 9.3 Supervisor never receives raw (pre-redaction) arguments
   - 9.4 Supervisor's own events are tenant-scoped
10. Security Properties
    - 10.1 The supervisor process has no UDS client connected to the engine
    - 10.2 The supervisor's `loopstorm.wrap()` instance connects to a SEPARATE engine instance (not the customer agent's engine)
    - 10.3 The supervisor's LLM API key is managed by LoopStorm infrastructure (Mode 2/3) or by the customer (Mode 1)
    - 10.4 Cross-customer intelligence data is anonymized before aggregation
11. v2 Expansion Scope (listed for awareness, not specified)
    - 11.1 Policy rule proposals (not just budget adjustments)
    - 11.2 Cross-customer pattern intelligence
    - 11.3 Supervisor configurability (tool scope, aggressiveness, model selection)
    - 11.4 Supervisor performance metrics (proposal acceptance rate, outcome tracking)

**Open questions to resolve during spec writing:**

- **OQ-SUP-1: Supervisor engine instance.** The supervisor wraps itself
  in `loopstorm.wrap()`. Does it connect to the same engine as the customer
  agent, or a separate engine instance? **Recommendation:** Separate engine
  instance on the hosted infrastructure. The customer agent's engine runs on
  the customer's machine; the supervisor's engine runs on LoopStorm's hosted
  infrastructure. This preserves plane separation physically, not just
  logically.
- **OQ-SUP-2: `query_similar_runs` cross-customer scope.** This is a v1.1
  tool, but cross-customer intelligence is v2. **Recommendation:** In v1.1,
  `scope` parameter exists but `anonymous_aggregate` returns an empty result
  with a message "cross-customer intelligence available in v2." The parameter
  is in the interface now to avoid a breaking change later.
- **OQ-SUP-3: How does an approved proposal get applied?** The spec must
  define the interface between "human approves proposal in dashboard" and
  "deterministic core is updated." **Recommendation:** The backend stores
  the approved proposal. The operator manually updates their policy pack
  YAML file. In v1.1, there is no automated policy push. This is intentional
  -- the human remains fully in the loop.
- **OQ-SUP-4: Supervisor model selection.** ADR-012 says haiku-class. The
  TAD amendment says `claude-3-5-haiku-20251001`. The spec should specify a
  model family requirement (haiku-class), not pin a specific model version.
  Operators can configure the model in Mode 1.

---

## 5. Architectural Gates

### 5.1 Gate: Behavioral Telemetry Schema Decision

**Status:** OPEN -- resolved by writing the spec
**Decision needed:** Are the four behavioral telemetry fields added as
optional properties in `event.schema.json` schema_version 1 (additive), or
do they require a schema_version 2 bump?
**Affected consumers:** Engine, Backend (database schema), CLI (verify),
Frontend (event detail display)
**Recommendation:** Additive optional in schema_version 1. Rationale:
- The fields are optional (not `required`)
- Existing consumers ignore unknown/absent optional fields
- A version bump to 2 would force engine + shim updates for no functional reason
- The spec must document this as "schema_version 1, behavioral telemetry extension"
**Risk:** If we later need mandatory behavioral fields, we will need
schema_version 2 anyway. But making them mandatory in v1.1 is not planned.

### 5.2 Gate: MCP Proxy Implementation Language

**Status:** OPEN -- resolved by the spec
**Decision needed:** Is the MCP proxy implemented in TypeScript (natural fit
for MCP SDK) or Rust (single-binary story)?
**Affected consumers:** MCP proxy implementer, CI/CD, release packaging
**Recommendation:** TypeScript. New package at `apps/mcp-proxy/` (MIT).
Rationale: The `@modelcontextprotocol/sdk` TypeScript SDK handles transport
negotiation (stdio, SSE, streamable HTTP). Reimplementing MCP transport in
Rust adds months of work for marginal performance gain (the proxy is not in
the P99 < 5ms path -- the engine decision is).

### 5.3 Gate: OTel Exporter Architecture

**Status:** OPEN -- resolved by the spec
**Decision needed:** Is the OTel exporter a (a) standalone binary that reads
JSONL, (b) a backend service that reads the event store, or (c) both?
**Affected consumers:** OTel exporter implementer, deployment guide
**Recommendation:** Both. The spec defines the mapping abstractly. Two
concrete exporters can exist: (a) a CLI tool that reads JSONL and emits
OTLP (works in Mode 0 with a local collector), and (b) a backend service
that streams from the event store (Mode 2/3). The spec is exporter-agnostic.

### 5.4 Gate: Supervisor Engine Instance Topology

**Status:** OPEN -- resolved by the spec
**Decision needed:** Does the supervisor connect to the customer's engine
or a separate engine instance?
**Affected consumers:** AI Supervisor implementer, hosted infrastructure
**Recommendation:** Separate engine instance. The supervisor runs on
LoopStorm's infrastructure. The customer agent's engine runs on the
customer's infrastructure. They share no IPC channel. This is the
physical realization of the enforcement/observation plane separation.

---

## 6. Cross-Cutting Concerns

### 6.1 Schema Dual-Path Risk

**IMPORTANT:** The repository has two copies of schema files:
- `schemas/` (canonical source)
- `packages/schemas/` (TypeScript types + copies)

The P5 specs may reference or propose changes to `schemas/events/event.schema.json`
(behavioral telemetry fields). Any such changes must be documented as applying
to the canonical `schemas/` path. The dual-path convergence problem is flagged
in memory as an open risk that must be resolved before v1.

### 6.2 Database Schema Impact

The behavioral telemetry spec proposes 4 new optional columns in the events
table. The OTel spec does not change the database. The AI supervisory interface
spec uses existing supervisor tables (from P3). The MCP proxy spec does not
change the database (MCP-proxied events look identical to shim-generated events
from the backend's perspective).

**Backend agent follow-up required:** If behavioral telemetry fields are adopted,
a migration must add the 4 columns to the `events` table. This is a P5.1 follow-up,
not part of this spec task.

### 6.3 OSS Release Checklist Impact

The OSS release checklist (`docs/oss-release-checklist.md`) references two
CLI subcommands not yet implemented:
- `loopstorm filter --event-type <type> <file>` (Section 6)
- `loopstorm import <file> --api-key <key>` (Section 6)

These were deferred from P2. They are **not part of P5** (P5 is specs, not
implementation). However, if time permits, minimal specs for these two
subcommands can be added as appendices to `specs/ipc-wire-format.md` or
as standalone `specs/cli-filter.md` and `specs/cli-import.md`. This is
explicitly optional.

### 6.4 OWASP Mapping Updates

After the MCP proxy spec is written, `docs/owasp-agentic-mapping.md` should
be updated to reflect that AA5 (Insecure Agent Communication) coverage
improves from "Partial" once the MCP proxy is implemented. This update is
deferred to when the MCP proxy is actually implemented -- the spec alone
does not change the coverage level.

---

## 7. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| AC1 | `specs/behavioral-telemetry.md` exists with all 4 field definitions, computation algorithms, and at least 3 test vectors per field | Manual review |
| AC2 | `specs/behavioral-telemetry.md` explicitly states the schema_version decision and lists affected consumers | Manual review |
| AC3 | `specs/mcp-proxy-mode.md` exists with architecture diagram, protocol translation table, and all MCP feature handling decisions | Manual review |
| AC4 | `specs/mcp-proxy-mode.md` specifies the implementation language decision and package location | Manual review |
| AC5 | `specs/otel-span-mapping.md` exists with complete event-to-span field mapping table | Manual review |
| AC6 | `specs/otel-span-mapping.md` specifies trace_id and span_id derivation algorithms | Manual review |
| AC7 | `specs/ai-supervisory-interface.md` exists with complete tool set type signatures | Manual review |
| AC8 | `specs/ai-supervisory-interface.md` includes the `escalate_to_human` invariant with verification method | Manual review |
| AC9 | `specs/ai-supervisory-interface.md` explicitly states enforcement/observation plane separation at every interface point | Manual review |
| AC10 | `specs/ai-supervisory-interface.md` includes the supervisor policy pack YAML specification | Manual review |
| AC11 | All 4 spec files have correct `<!-- SPDX-License-Identifier: MIT -->` headers | CI license check |
| AC12 | No spec proposes modifications to the enforcement plane's critical path | Architectural review |
| AC13 | Every spec identifies Mode 0 behavior (or explicitly states "not applicable in Mode 0") | Manual review |
| AC14 | Every open question (OQ-*) listed in this brief is resolved in the corresponding spec with a documented decision | Manual review |

---

## 8. Out of Scope (Explicitly Deferred)

| Feature | Deferred To | Reason |
|---|---|---|
| Behavioral anomaly detector implementation | v2 | Only the telemetry schema is v1.1 |
| MCP proxy implementation | v1.1 or v2 | Only the design spec is v1.1 (ADR-009) |
| OTel exporter implementation | v1.1 | Only the span mapping spec is P5 |
| Supervisor agent implementation | v1.1 | Only the interface spec is P5 |
| Cross-customer intelligence implementation | v2 | Interface stub only in v1.1 |
| `filter` and `import` CLI specs | Optional addendum | Not blocking v1; listed in release checklist |
| TypeScript shim spec | Separate task | Already has IPC wire format spec as foundation |
| Semantic matching spec | v2 | ADR-010 explicitly defers this |
| `event.schema.json` modifications | P5.1 | Specs define fields; schema file changes are a separate PR |

---

## 9. Implementation Order

The specs should be written in this order due to dependency flow:

1. **Behavioral Telemetry** -- self-contained, resolves the schema_version
   gate. No dependency on other P5 specs.
2. **OTel Span Mapping** -- depends on understanding the event schema
   (informed by behavioral telemetry decisions). Self-contained otherwise.
3. **MCP Proxy Mode** -- depends on understanding the IPC protocol (already
   specified). References but does not depend on OTel or behavioral telemetry.
4. **AI Supervisory Interface** -- the most complex spec. Benefits from all
   three prior specs being written (behavioral telemetry informs what the
   supervisor sees; OTel informs how supervisor events are exported; MCP
   proxy informs whether MCP-originated events are visible to the supervisor).

---

## 10. Relationship to Control Philosophy Stages

| Spec | Primary Stage | Relationship |
|---|---|---|
| Behavioral Telemetry | Stage 2 (Detect) | Data captured during detection, consumed by v2 detector |
| MCP Proxy Mode | Stage 1 (Prevent) | Extends the enforcement boundary to MCP tool calls |
| OTel Span Mapping | Stages 1-4 (all enforcement) | Export format for enforcement events |
| AI Supervisory Interface | Stage 5 (Adapt) | The entire supervisor IS Stage 5 |

All four specs respect the enforcement/observation plane separation:
- Behavioral telemetry is enforcement-plane data (computed by the engine)
- MCP proxy is enforcement-plane infrastructure (a new transport adapter)
- OTel export is a read-only consumer of enforcement-plane data (no write-back)
- AI Supervisor is observation-plane only (reads events, proposes changes, requires human approval)
