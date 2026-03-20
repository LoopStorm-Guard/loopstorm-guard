<!-- SPDX-License-Identifier: MIT -->
# Specification: OpenTelemetry Span Mapping

**Spec version:** 1
**Date:** 2026-03-20
**Status:** Normative
**Consumers:** OTel exporter (any language), Backend (event store reader), CLI (JSONL reader)
**Control philosophy stage:** Stages 1-4 (all enforcement stages) -- export format for enforcement events
**Deployment modes:** Mode 0 (JSONL reader + local collector), Mode 2/3 (event store reader + hosted collector)
**ADR dependencies:** ADR-001 (IPC/events), ADR-007 (budget)

---

## 1. Overview

This specification defines how LoopStorm JSONL audit events are translated
into OpenTelemetry (OTel) spans for export to observability backends such as
Datadog, Grafana Tempo, Jaeger, Honeycomb, and SIEM systems.

**Problem.** LoopStorm produces a tamper-evident JSONL hash-chain audit log.
This log is the ground truth, but it is not natively consumable by standard
observability tooling. Organizations that already operate OTel-based
monitoring stacks need LoopStorm data to flow into their existing dashboards,
alerting rules, and incident response workflows without building custom
integrations.

**Solution.** An exporter process reads LoopStorm events (from the JSONL
file or the event store) and emits OTel spans via the OTLP protocol. The
mapping defined in this spec is deterministic: the same event always
produces the same span. The exporter is a read-only consumer of the audit
trail -- it never modifies JSONL files, never writes to the event store,
and never participates in the enforcement path.

**Plane assignment.** The OTel exporter operates outside both the
enforcement plane and the observation plane. It is a telemetry consumer
with read-only access to enforcement data. It has no feedback path into
either plane.

**Non-goals.** This spec does not define:
- An OTel-based replacement for the JSONL audit log
- Metrics or log export (only traces/spans)
- Distributed tracing across the agent's own LLM API calls (that is the
  agent framework's responsibility)
- Real-time streaming of spans during enforcement (the exporter is
  asynchronous)

---

## 2. OTel Concepts Mapping

### 2.1 Run = Trace

Each LoopStorm run (identified by `run_id`) maps to one OTel trace. All
events within a run share the same `trace_id`.

### 2.2 Event = Span

Each LoopStorm event becomes one OTel span within the trace. The span
carries the event's fields as attributes.

### 2.3 Span Hierarchy

```
Trace (run_id)
  |
  +-- run_started               [root span]
       |
       +-- policy_decision      [child span, seq=1]
       +-- policy_decision      [child span, seq=2]
       +-- budget_update        [child span, seq=3]
       +-- loop_detected        [child span, seq=4]
       +-- policy_decision      [child span, seq=5]
       +-- run_ended            [child span, seq=N]
```

- `run_started` is the **root span**. Its `span_id` is derived from
  `seq=0` (a synthetic sequence number; the actual event has `seq=1`, but
  the root span uses `seq=0` to distinguish it from child spans).
- All other events are **child spans** of the root span. Their `span_id`
  values are derived from their actual `seq` values.
- `budget_update`, `budget_soft_cap_warning`, `budget_exceeded`,
  `loop_detected`, and `system_event` are child spans that represent
  internal engine events, not tool calls.
- `run_ended` is a child span that closes the trace.

### 2.4 Why Not Span Events?

An alternative design would model `budget_soft_cap_warning` and
`loop_detected` as OTel Span Events attached to existing spans rather than
standalone spans. This spec uses standalone spans because:

1. Each LoopStorm event has its own `seq`, `hash`, and `hash_prev` --
   it is a first-class audit record, not an annotation.
2. Standalone spans are filterable and searchable in all OTel backends.
   Span events are not universally queryable.
3. The one-event-to-one-span mapping is simpler to implement and verify.

Budget warnings and loop detections are additionally attached as OTel
Span Events on the root span for convenience (see Section 5).

---

## 3. Identifier Derivation

### 3.1 trace_id Derivation (OQ-OTEL-1 Resolved)

**Decision:** Direct byte mapping from `run_id` to `trace_id`.

OTel `trace_id` is 128 bits (16 bytes, 32 hex characters). UUID v7 is
also 128 bits (16 bytes). The mapping is:

```
FUNCTION trace_id(run_id: UUID) -> OTelTraceId:
    // Strip hyphens from the UUID string representation.
    // The resulting 32 hex characters ARE the trace_id.
    RETURN remove_hyphens(lowercase_hex(run_id))
```

**Example:**

| Field | Value |
|---|---|
| `run_id` | `01960e07-d0e9-7ad0-8621-5614ec0dbd54` |
| `trace_id` | `01960e07d0e97ad086215614ec0dbd54` |

**Rationale:** UUID v7 and OTel trace_id have identical bit widths.
Hashing would destroy the temporal ordering inherent in UUID v7 (the
first 48 bits encode a Unix timestamp in milliseconds). Direct mapping
preserves this property, which means trace_ids sort chronologically in
OTel backends -- a significant operational advantage.

**Version and variant bits.** UUID v7 has version bits (bits 48-51 =
`0111`) and variant bits (bits 64-65 = `10`). OTel trace_id has no
such constraints; it only requires the value to be non-zero. Since any
valid UUID v7 is non-zero, the direct mapping always produces a valid
trace_id.

**UUID v4 fallback.** ADR-004 recommends UUID v7 but the Python shim
falls back to UUID v4 when `uuid7()` is unavailable. UUID v4 is also
128 bits. The same direct byte mapping applies. The only difference is
that UUID v4 trace_ids will not sort chronologically.

### 3.2 span_id Derivation (OQ-OTEL-2 Resolved)

**Decision:** First 8 bytes of SHA-256(run_id_bytes || seq_be_bytes).

OTel `span_id` is 64 bits (8 bytes, 16 hex characters). The mapping is:

```
FUNCTION span_id(run_id: UUID, seq: integer) -> OTelSpanId:
    // run_id_bytes: the 16 raw bytes of the UUID (hyphens stripped,
    //               hex-decoded to bytes).
    // seq_be_bytes: the seq value encoded as a big-endian unsigned
    //               64-bit integer (8 bytes).

    payload = run_id_bytes || seq_be_bytes   // 24 bytes total
    digest  = SHA-256(payload)               // 32 bytes
    RETURN hex_lower(digest[0..8])           // first 8 bytes = 16 hex chars
```

**Root span.** The `run_started` event uses `seq=0` (synthetic) for
span_id derivation, even though its event `seq` field is 1. This ensures
the root span has a distinct span_id from the first child span.

**All other events.** Use their actual `seq` value from the event.

**Test vectors:**

| `run_id` (hex, no hyphens) | `seq` | SHA-256 of (run_id \|\| seq) | `span_id` |
|---|---|---|---|
| `01960e07d0e97ad086215614ec0dbd54` | 0 | `bbb16c9cc3271f929c5056ce767bfcc6a9158bcf1d8e66e1b8df09573b85b0e5` | `bbb16c9cc3271f92` |
| `01960e07d0e97ad086215614ec0dbd54` | 1 | `3eb8b9ba7c1e4abe9daee266e7103e80327aaf897a20a93b373dea9f2575ae1f` | `3eb8b9ba7c1e4abe` |
| `01960e07d0e97ad086215614ec0dbd54` | 2 | `0801329b2ca54dbfad27aaa531ea255e1dd031ea339f32a9b74644a182a481a3` | `0801329b2ca54dbf` |
| `01960e07d0e97ad086215614ec0dbd54` | 5 | `68271a005fb672138c7bbcd9f3a4c3d2dc9dcd1959c2a2d04fc47060d20e4942` | `68271a005fb67213` |

**Properties:**
- **Deterministic.** The same (run_id, seq) pair always produces the same
  span_id. This means re-exporting the same events produces identical spans
  (idempotent).
- **Collision-resistant.** SHA-256 truncated to 64 bits provides ~2^32
  collision resistance (birthday bound). For a single run, collisions are
  astronomically unlikely with seq values in the thousands.
- **Non-zero guarantee.** OTel requires span_id to be non-zero. SHA-256
  output being all-zero for 8 bytes is probability ~2^-64. If an
  implementation encounters this case, it MUST set the least significant
  bit to 1.

### 3.3 parent_span_id

All child spans (seq >= 1) set `parent_span_id` to the root span's
span_id (derived from seq=0). This creates a flat hierarchy: root span
with all other spans as direct children.

A flat hierarchy is chosen over a sequential chain (each span parented to
the previous) because:

1. LoopStorm events are not causally linked in the OTel sense -- each
   tool call is an independent enforcement decision.
2. A flat hierarchy renders correctly in all OTel backends. Deep chains
   are hard to navigate and imply false causal dependencies.
3. The `seq` field provides canonical ordering within the trace.

---

## 4. Event-to-Span Field Mapping Table

This table maps every field in `schemas/events/event.schema.json` (v1)
plus the four behavioral telemetry fields from `specs/behavioral-telemetry.md`
to OTel span constructs.

### 4.1 Identity and Ordering Fields

| Event field | OTel construct | OTel field/attribute | Notes |
|---|---|---|---|
| `run_id` | Trace identity | `trace_id` | Direct byte mapping (Section 3.1) |
| `seq` | Span identity | `span_id` | SHA-256 derivation (Section 3.2) |
| `hash` | Span attribute | `loopstorm.hash` | The event's hash-chain hash |
| `hash_prev` | Span attribute | `loopstorm.hash_prev` | Previous hash in chain. `null` becomes empty string |
| `schema_version` | Span attribute | `loopstorm.schema_version` | Integer |
| `ts` | Span start time | `start_time` | ISO 8601 parsed to OTel Timestamp |

### 4.2 Event Classification Fields

| Event field | OTel construct | OTel field/attribute | Notes |
|---|---|---|---|
| `event_type` | Span name | `span.name` | e.g. `"loopstorm.policy_decision"` (namespaced) |
| `run_status` | Span attribute | `loopstorm.run_status` | Present on `run_started` and `run_ended` |
| `system_event_type` | Span attribute | `loopstorm.system_event_type` | Present on `system_event` |

### 4.3 Enforcement Decision Fields

| Event field | OTel construct | OTel field/attribute | Notes |
|---|---|---|---|
| `decision` | Span attribute + SpanStatus | `loopstorm.decision` | Also drives SpanStatus (Section 4.8) |
| `rule_id` | Span attribute | `loopstorm.rule_id` | The policy rule that fired |
| `reason` | Span attribute | `loopstorm.reason` | Human-readable reason |
| `tool` | Span attribute | `loopstorm.tool` | Tool name |
| `args_hash` | Span attribute | `loopstorm.args_hash` | SHA-256 of JCS canonical args |
| `args_redacted` | Span attribute | `loopstorm.args_redacted` | JSON-serialized string of the redacted args object |

### 4.4 Budget Fields

| Event field | OTel construct | OTel field/attribute | Notes |
|---|---|---|---|
| `budget.cost_usd.current` | Span attribute | `loopstorm.budget.cost_usd.current` | float |
| `budget.cost_usd.soft` | Span attribute | `loopstorm.budget.cost_usd.soft` | float |
| `budget.cost_usd.hard` | Span attribute | `loopstorm.budget.cost_usd.hard` | float |
| `budget.input_tokens.current` | Span attribute | `loopstorm.budget.input_tokens.current` | integer |
| `budget.input_tokens.soft` | Span attribute | `loopstorm.budget.input_tokens.soft` | integer |
| `budget.input_tokens.hard` | Span attribute | `loopstorm.budget.input_tokens.hard` | integer |
| `budget.output_tokens.current` | Span attribute | `loopstorm.budget.output_tokens.current` | integer |
| `budget.output_tokens.soft` | Span attribute | `loopstorm.budget.output_tokens.soft` | integer |
| `budget.output_tokens.hard` | Span attribute | `loopstorm.budget.output_tokens.hard` | integer |
| `budget.call_count.current` | Span attribute | `loopstorm.budget.call_count.current` | integer |
| `budget.call_count.soft` | Span attribute | `loopstorm.budget.call_count.soft` | integer |
| `budget.call_count.hard` | Span attribute | `loopstorm.budget.call_count.hard` | integer |
| `dimension` | Span attribute | `loopstorm.budget.dimension` | Which dimension triggered the event |

### 4.5 Token and Cost Fields

| Event field | OTel construct | OTel field/attribute | Notes |
|---|---|---|---|
| `model` | Span attribute | `loopstorm.model` | LLM model identifier |
| `input_tokens` | Span attribute | `loopstorm.input_tokens` | Per-call input tokens |
| `output_tokens` | Span attribute | `loopstorm.output_tokens` | Per-call output tokens |
| `estimated_cost_usd` | Span attribute | `loopstorm.estimated_cost_usd` | Per-call estimated cost |

### 4.6 Loop Detection Fields

| Event field | OTel construct | OTel field/attribute | Notes |
|---|---|---|---|
| `loop_rule` | Span attribute | `loopstorm.loop_rule` | The loop detection rule that fired |
| `loop_action` | Span attribute | `loopstorm.loop_action` | `"cooldown"` or `"kill"` |
| `cooldown_ms` | Span attribute | `loopstorm.cooldown_ms` | Cooldown duration in ms |

### 4.7 Agent and Environment Fields

| Event field | OTel construct | OTel field/attribute | Notes |
|---|---|---|---|
| `agent_name` | Resource attribute | `loopstorm.agent.name` | Set on the OTel Resource, not per-span |
| `agent_role` | Resource attribute | `loopstorm.agent.role` | Set on the OTel Resource, not per-span |
| `policy_pack_id` | Resource attribute | `loopstorm.policy_pack_id` | Set on the OTel Resource |
| `environment` | Resource attribute | `deployment.environment.name` | Standard OTel semantic convention |

### 4.8 Span Duration and Latency

| Event field | OTel construct | OTel field/attribute | Notes |
|---|---|---|---|
| `latency_ms` | Span duration + attribute | `end_time` = `start_time` + `latency_ms`; also `loopstorm.latency_ms` | See Section 4.8.1 |

#### 4.8.1 Span Duration Strategy (OQ-OTEL-3 Resolved)

**Decision:** Use `latency_ms` as span duration where available. Use
zero-duration spans for events without `latency_ms`.

- **`policy_decision` events** have `latency_ms` (engine processing time).
  Span duration = `latency_ms` milliseconds. `end_time` = `start_time` +
  `latency_ms`.
- **All other event types** (`run_started`, `budget_update`,
  `budget_soft_cap_warning`, `budget_exceeded`, `loop_detected`,
  `run_ended`, `system_event`) do not have a meaningful duration.
  `end_time` = `start_time` (zero-duration span).
- **Root span exception.** The root span (`run_started`) receives special
  treatment: its `end_time` is set to the `ts` of the `run_ended` event.
  This makes the root span's duration equal to the total run duration.
  If no `run_ended` event exists (incomplete run), the root span has
  zero duration.

### 4.9 Behavioral Telemetry Fields (v1.1)

These fields are defined in `specs/behavioral-telemetry.md`. They are
optional on `policy_decision` events. When present, they are mapped as
span attributes.

| Event field | OTel attribute | Type | Notes |
|---|---|---|---|
| `call_seq_fingerprint` | `loopstorm.telemetry.call_seq_fingerprint` | string | SHA-256 hex of last N tool call tuples |
| `inter_call_ms` | `loopstorm.telemetry.inter_call_ms` | integer | Milliseconds since previous call |
| `token_rate_delta` | `loopstorm.telemetry.token_rate_delta` | double | Ratio to rolling token average |
| `param_shape_hash` | `loopstorm.telemetry.param_shape_hash` | string | SHA-256 hex of arg key structure |

Behavioral telemetry attributes use the `loopstorm.telemetry.` sub-namespace
to distinguish them from enforcement attributes.

### 4.10 Supervisor Fields

Supervisor event fields are mapped in Section 6 (Supervisor Spans).

---

## 5. SpanStatus Mapping

OTel SpanStatus has three values: `UNSET`, `OK`, and `ERROR`. The mapping
from LoopStorm decision types is:

| `decision` | OTel SpanStatus | StatusMessage | Rationale |
|---|---|---|---|
| `allow` | `OK` | (empty) | Call permitted; no error |
| `deny` | `ERROR` | Content of `reason` field | Call blocked by policy; this is an enforcement action, surfaced as an error for alerting |
| `cooldown` | `OK` | (empty) | Loop detected but recovery attempted; not a terminal error. Attribute `loopstorm.decision=cooldown` distinguishes from `allow` |
| `kill` | `ERROR` | Content of `reason` field | Run terminated; terminal error |
| `require_approval` | `UNSET` | (empty) | Pending human action; outcome unknown at span creation time |

### 5.1 SpanStatus for Non-Decision Events

| `event_type` | OTel SpanStatus | Rationale |
|---|---|---|
| `run_started` | `UNSET` | Outcome not yet known |
| `run_ended` (status `completed`) | `OK` | Successful completion |
| `run_ended` (status `terminated_*`, `error`) | `ERROR` | Abnormal termination |
| `run_ended` (status `abandoned`) | `ERROR` | Abnormal termination |
| `budget_update` | `UNSET` | Informational |
| `budget_soft_cap_warning` | `UNSET` | Warning, not error |
| `budget_exceeded` | `ERROR` | Budget breach; terminal |
| `loop_detected` | `UNSET` | Detection event; the action (cooldown or kill) determines severity |
| `system_event` | `UNSET` | Informational |

### 5.2 Root Span Final Status

The root span's status is updated when the `run_ended` event is processed:

- If `run_ended.run_status` is `completed`: root span status = `OK`
- If `run_ended.run_status` is `terminated_budget`, `terminated_loop`,
  `terminated_policy`, `error`, or `abandoned`: root span status = `ERROR`
  with the `reason` as the StatusMessage
- If no `run_ended` event exists: root span status remains `UNSET`

---

## 6. Supervisor Spans

### 6.1 Separate Traces

Supervisor runs map to **separate OTel traces**. A supervisor run has its
own `run_id` (and therefore its own `trace_id`), distinct from the
triggering agent's `run_id`.

This is a direct consequence of the enforcement/observation plane
separation: the supervisor's audit trail is in its own hash chain,
not the triggering agent's chain.

### 6.2 Span Links

The `supervisor_run_started` event contains a `trigger_run_id` field
identifying the agent run that triggered the supervisor. This relationship
is expressed as an **OTel Span Link** from the supervisor's root span
to the triggering agent's root span.

```
FUNCTION supervisor_span_link(trigger_run_id: UUID) -> OTelLink:
    RETURN Link(
        trace_id = trace_id(trigger_run_id),   // Section 3.1
        span_id  = span_id(trigger_run_id, 0), // Root span of triggering run
        attributes = {
            "loopstorm.link_type": "supervisor_trigger"
        }
    )
```

This allows OTel backends to navigate from a supervisor trace to the
agent trace that triggered it, and vice versa.

### 6.3 Supervisor Resource Attributes

Supervisor spans use the same resource attribute scheme but with distinct
values:

| Resource attribute | Value |
|---|---|
| `service.name` | `loopstorm-supervisor` |
| `loopstorm.agent.role` | `supervisor` |
| `loopstorm.agent.name` | (supervisor agent name, if configured) |

### 6.4 Supervisor Event Field Mapping

| Event field | OTel attribute | Present on |
|---|---|---|
| `supervisor_run_id` | `loopstorm.supervisor.run_id` | All `supervisor_*` events |
| `trigger` | `loopstorm.supervisor.trigger` | `supervisor_run_started` |
| `trigger_run_id` | `loopstorm.supervisor.trigger_run_id` | `supervisor_run_started` |
| `proposal_id` | `loopstorm.supervisor.proposal_id` | `supervisor_proposal_created` |
| `proposal_type` | `loopstorm.supervisor.proposal_type` | `supervisor_proposal_created` |
| `target_agent` | `loopstorm.supervisor.target_agent` | `supervisor_proposal_created` |
| `rationale` | `loopstorm.supervisor.rationale` | `supervisor_proposal_created` |
| `confidence` | `loopstorm.supervisor.confidence` | `supervisor_proposal_created`, `supervisor_escalation_created` |
| `supporting_runs` | `loopstorm.supervisor.supporting_runs` | `supervisor_proposal_created` (JSON array serialized as string) |
| `status` | `loopstorm.supervisor.status` | `supervisor_proposal_created`, `supervisor_escalation_created` |
| `escalation_id` | `loopstorm.supervisor.escalation_id` | `supervisor_escalation_created` |
| `severity` | `loopstorm.supervisor.severity` | `supervisor_escalation_created` |
| `recommendation` | `loopstorm.supervisor.recommendation` | `supervisor_escalation_created` |
| `timeout_seconds` | `loopstorm.supervisor.timeout_seconds` | `supervisor_escalation_created` |
| `timeout_action` | `loopstorm.supervisor.timeout_action` | `supervisor_escalation_created` |

### 6.5 Supervisor SpanStatus

| `event_type` | SpanStatus | Rationale |
|---|---|---|
| `supervisor_run_started` | `UNSET` | Outcome not yet known |
| `supervisor_tool_call` | `OK` | Supervisor tool executed |
| `supervisor_proposal_created` | `OK` | Proposal emitted successfully |
| `supervisor_escalation_created` | `OK` | Escalation emitted successfully |

---

## 7. Semantic Conventions

### 7.1 Namespace

All LoopStorm-specific attributes use the `loopstorm.` prefix. This
avoids collision with OTel semantic conventions and third-party
instrumentation.

Sub-namespaces:

| Prefix | Content |
|---|---|
| `loopstorm.` | Core enforcement attributes |
| `loopstorm.budget.` | Budget state attributes |
| `loopstorm.telemetry.` | Behavioral telemetry attributes (v1.1) |
| `loopstorm.supervisor.` | Supervisor-specific attributes |
| `loopstorm.agent.` | Agent identity (resource-level) |

### 7.2 Standard OTel Attributes

The following standard OTel semantic convention attributes are set on the
Resource:

| OTel attribute | Source | Notes |
|---|---|---|
| `service.name` | Configuration | `"loopstorm-engine"` for agent runs, `"loopstorm-supervisor"` for supervisor runs |
| `service.version` | Engine version | e.g. `"1.1.0"` |
| `deployment.environment.name` | `environment` event field | e.g. `"production"`, `"staging"` |

### 7.3 Attribute Types

OTel attributes have typed values. The mapping from LoopStorm event JSON
types is:

| JSON type | OTel attribute type | Notes |
|---|---|---|
| `string` | `STRING` | Direct mapping |
| `integer` | `INT64` | Direct mapping |
| `number` (float) | `DOUBLE` | Direct mapping |
| `boolean` | `BOOL` | Direct mapping |
| `object` | `STRING` | JSON-serialized (e.g. `args_redacted`, `budget`) |
| `array` | `STRING` | JSON-serialized (e.g. `supporting_runs`) |
| `null` | (omitted) | Null fields are not set as attributes |

---

## 8. Exporter Architecture

### 8.1 Design Principle

The exporter is a **read-only**, **asynchronous** process. It is NOT in
the engine's critical path. It adds zero latency to enforcement decisions.

```
ENFORCEMENT PLANE (P99 < 5ms, synchronous):
  [Agent] -> [Shim] -> [Engine] -> [Decision] -> [JSONL]

EXPORTER (async, seconds-to-minutes):
  [JSONL / Event Store] -> [Exporter] -> [OTLP] -> [OTel Backend]
```

### 8.2 Input Sources

Two input sources are defined. Implementations MAY support one or both.

#### 8.2.1 JSONL File Reader

Reads the local JSONL audit log file, parses events, builds OTel spans,
and emits them via OTLP.

- **Applicable modes:** Mode 0 (with a local OTel collector), Mode 2/3
- **Behavior:** Tail-follows the JSONL file. Processes new lines as they
  are appended. Maintains a cursor (last processed line number or byte
  offset) for crash recovery.
- **Batching:** Accumulates spans and flushes when a run completes
  (`run_ended` event) or when a configurable flush interval elapses.

#### 8.2.2 Event Store Reader

Reads from the PostgreSQL event store (the `events` table), builds OTel
spans, and emits them via OTLP.

- **Applicable modes:** Mode 2/3
- **Behavior:** Polls the event store for new events (by `seq` or `ts`
  cursor). Processes events in order.
- **Batching:** Same as JSONL reader. Additionally, can process completed
  runs in bulk for backfill.

### 8.3 Output Protocol

The exporter emits spans via the **OpenTelemetry Protocol (OTLP)**. Both
transport options are supported:

- **OTLP/gRPC** (port 4317, default)
- **OTLP/HTTP** (port 4318)

The exporter uses the standard OTel SDK's OTLP exporter. It does not
implement the OTLP protocol from scratch.

### 8.4 Exporter Lifecycle

The exporter runs as one of:

- **Sidecar process** alongside the engine (Mode 0/2)
- **Backend service** reading from the event store (Mode 2/3)
- **Batch job** for backfilling historical data

It is NOT embedded in the engine binary. It is NOT a library linked into
the engine. This separation ensures the engine's critical path is not
affected by OTel SDK overhead, network latency, or exporter failures.

### 8.5 Implementation Language (OQ-OTEL-4 Resolved)

**Decision:** The spec is language-agnostic. The exporter MAY be
implemented in any language with a mature OTel SDK.

Recommended candidates:

| Language | Rationale | Trade-offs |
|---|---|---|
| Rust | Reads JSONL natively, single binary | OTel Rust SDK is less mature than Go/JS |
| TypeScript | OTel JS SDK is mature, Bun compatibility | Requires Node/Bun runtime |
| Go | OTel Go SDK is the reference implementation | Adds a new language to the stack |

The implementation language decision is deferred to the implementation
task brief. This spec defines only the mapping, not the implementation.

---

## 9. Configuration

The exporter accepts the following configuration. Configuration sources
(environment variables, config file, CLI flags) are implementation-defined.

### 9.1 Required Configuration

| Parameter | Description | Example |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint URL | `http://localhost:4317` |
| `input_source` | `"jsonl"` or `"eventstore"` | `jsonl` |
| `input_path` (JSONL mode) | Path to the JSONL audit log file | `/var/log/loopstorm/audit.jsonl` |
| `database_url` (event store mode) | PostgreSQL connection string | `postgres://...` |

### 9.2 Optional Configuration

| Parameter | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | `grpc` or `http/protobuf` |
| `OTEL_EXPORTER_OTLP_HEADERS` | (none) | Authentication headers (e.g. API key) |
| `batch_size` | `100` | Maximum spans per OTLP export batch |
| `flush_interval_ms` | `5000` | Maximum time between OTLP export flushes |
| `service_name` | `loopstorm-engine` | OTel `service.name` resource attribute |
| `service_version` | (auto-detect) | OTel `service.version` resource attribute |

### 9.3 Standard OTel Environment Variables

The exporter MUST respect standard OTel SDK environment variables
(`OTEL_EXPORTER_OTLP_*`, `OTEL_RESOURCE_ATTRIBUTES`, etc.) as defined
by the OpenTelemetry specification. Implementation-specific parameters
are additive and MUST NOT conflict with standard OTel variables.

---

## 10. Deployment Mode Behavior

### 10.1 Mode 0 -- JSONL Reader + Local Collector

In Mode 0 (air-gapped), the OTel exporter runs as a local sidecar that
reads the JSONL file and sends spans to a locally-running OTel Collector
(e.g., Jaeger all-in-one, Grafana Agent).

```
[Engine] -> [JSONL file]
                |
          [OTel Exporter] -> [Local OTel Collector] -> [Local Jaeger/Grafana]
```

No network access to external services is required. The exporter and
collector both run on the same machine.

**Mode 0 is NOT a primary use case for OTel export.** Mode 0 users
typically use the CLI (`loopstorm replay`, `loopstorm verify`) for
audit analysis. OTel export in Mode 0 is for operators who already run
a local observability stack and want LoopStorm data in it.

### 10.2 Mode 2 -- Event Store Reader + Hosted Collector

In Mode 2, the exporter runs as a backend service that reads from the
PostgreSQL event store and sends spans to the organization's OTel
Collector or directly to a SaaS backend (Datadog, Grafana Cloud, etc.).

```
[Engine] -> [JSONL] -> [HTTP Forwarder] -> [Event Store (PostgreSQL)]
                                                    |
                                           [OTel Exporter] -> [OTLP] -> [Datadog/Grafana]
```

### 10.3 Mode 3 -- Mode 2 + Supervisor Traces

Mode 3 adds supervisor traces. The exporter processes both agent events
and supervisor events from the event store. Supervisor traces are linked
to agent traces via span links (Section 6.2).

---

## 11. Limitations

### 11.1 trace_id Bit Layout

OTel trace_id has no structural requirements beyond being non-zero. UUID
v7 has version/variant bits at fixed positions. This means the trace_id
space is not uniformly random -- bits 48-51 are always `0111` and bits
64-65 are always `10`. This has no practical impact on OTel backends,
which treat trace_id as an opaque identifier. Sampling algorithms based
on trace_id bit patterns may exhibit slight bias; this is acceptable for
LoopStorm's use case (all traces are exported, no sampling).

### 11.2 span_id Collision Probability

SHA-256 truncated to 64 bits gives ~2^32 birthday-bound collision
resistance. Within a single trace (run), this means collisions become
non-negligible at ~4 billion events per run. LoopStorm runs are expected
to have at most thousands of events. Cross-trace span_id collisions are
irrelevant (span_id is scoped to a trace).

### 11.3 Retroactive Root Span Duration

The root span's duration is only known after the `run_ended` event is
processed. If the exporter emits spans incrementally (before the run
ends), it must either:

(a) Emit the root span with zero duration and update it when `run_ended`
    arrives. OTel's model does not support span updates after export.
(b) Buffer the root span until `run_ended` and emit it last.
(c) Emit the root span with zero duration and accept the limitation.

**Recommended approach:** Option (b) for completed runs, option (c) for
incomplete/abandoned runs. The exporter SHOULD buffer spans per trace
and flush the entire trace when `run_ended` is received or when a
configurable timeout (default: 5 minutes) elapses without `run_ended`.

### 11.4 Custom Attributes vs. Semantic Conventions

Not all LoopStorm event fields have OTel semantic convention equivalents.
Custom `loopstorm.*` attributes are used throughout. This means OTel
backends will not automatically render LoopStorm-specific attributes in
pre-built dashboards. Users will need to create custom dashboards or
use the exporter's documentation to configure their backend.

### 11.5 No Distributed Tracing Across Agent LLM Calls

This spec maps LoopStorm enforcement events to OTel spans. It does NOT
establish trace context propagation between LoopStorm and the agent's own
LLM API calls. If the agent framework (e.g., LangChain, CrewAI) produces
its own OTel traces, those are separate from LoopStorm traces. Linking
them would require W3C Trace Context propagation through the shim, which
is out of scope for v1.1.

### 11.6 Exporter Does Not Modify Enforcement Behavior

The exporter is read-only. It cannot:
- Block or delay enforcement decisions
- Write to the JSONL audit log
- Modify the event store
- Send signals to the engine

If the exporter fails (network error, collector down, misconfiguration),
enforcement continues unaffected. Exporter failures are logged locally
but do not trigger any LoopStorm event or alert.

---

## Appendix A: Open Question Resolutions

| ID | Question | Decision | Rationale |
|---|---|---|---|
| OQ-OTEL-1 | trace_id derivation: direct byte mapping or hash? | Direct byte mapping (strip UUID hyphens). | UUID v7 is 128 bits = OTel trace_id size. Direct mapping preserves temporal ordering. Always non-zero. |
| OQ-OTEL-2 | span_id derivation: how to get 64 bits from (run_id, seq)? | First 8 bytes of SHA-256(run_id_bytes \|\| seq_be_bytes). | Deterministic, collision-resistant within reasonable run sizes, non-zero with negligible probability of failure. |
| OQ-OTEL-3 | Span duration: zero-duration, latency_ms, or inter-event delta? | Use `latency_ms` where available; zero-duration otherwise. Root span duration = `run_ended.ts` - `run_started.ts`. | `latency_ms` is the semantically correct duration for `policy_decision` spans. Inter-event deltas would conflate queue time with processing time. |
| OQ-OTEL-4 | Exporter implementation language? | Spec is language-agnostic. Decision deferred to implementation brief. | The mapping is the stable contract; the exporter is a replaceable component. |

---

## Appendix B: Complete Span Attribute Reference

This appendix lists every OTel attribute emitted by the exporter, grouped
by scope.

### B.1 Resource Attributes (per-trace, set once)

| Attribute | Type | Source |
|---|---|---|
| `service.name` | STRING | Configuration or `"loopstorm-engine"` / `"loopstorm-supervisor"` |
| `service.version` | STRING | Engine version |
| `deployment.environment.name` | STRING | `environment` event field |
| `loopstorm.agent.name` | STRING | `agent_name` event field |
| `loopstorm.agent.role` | STRING | `agent_role` event field |
| `loopstorm.policy_pack_id` | STRING | `policy_pack_id` event field |

### B.2 Core Span Attributes (per-span)

| Attribute | Type | Present on |
|---|---|---|
| `loopstorm.schema_version` | INT64 | All spans |
| `loopstorm.hash` | STRING | All spans |
| `loopstorm.hash_prev` | STRING | All spans (empty string for first event) |
| `loopstorm.run_status` | STRING | `run_started`, `run_ended` |
| `loopstorm.system_event_type` | STRING | `system_event` |
| `loopstorm.decision` | STRING | `policy_decision` |
| `loopstorm.rule_id` | STRING | `policy_decision` |
| `loopstorm.reason` | STRING | `policy_decision`, `run_ended` |
| `loopstorm.tool` | STRING | `policy_decision`, `supervisor_tool_call` |
| `loopstorm.args_hash` | STRING | `policy_decision` |
| `loopstorm.args_redacted` | STRING | `policy_decision` (JSON-serialized) |
| `loopstorm.model` | STRING | `policy_decision` (when present) |
| `loopstorm.input_tokens` | INT64 | `policy_decision` (when present) |
| `loopstorm.output_tokens` | INT64 | `policy_decision` (when present) |
| `loopstorm.estimated_cost_usd` | DOUBLE | `policy_decision` (when present) |
| `loopstorm.latency_ms` | DOUBLE | `policy_decision` (when present) |
| `loopstorm.loop_rule` | STRING | `loop_detected` |
| `loopstorm.loop_action` | STRING | `loop_detected` |
| `loopstorm.cooldown_ms` | INT64 | `loop_detected`, `policy_decision` (cooldown) |

### B.3 Budget Attributes (per-span, when budget object present)

| Attribute | Type |
|---|---|
| `loopstorm.budget.cost_usd.current` | DOUBLE |
| `loopstorm.budget.cost_usd.soft` | DOUBLE |
| `loopstorm.budget.cost_usd.hard` | DOUBLE |
| `loopstorm.budget.input_tokens.current` | INT64 |
| `loopstorm.budget.input_tokens.soft` | INT64 |
| `loopstorm.budget.input_tokens.hard` | INT64 |
| `loopstorm.budget.output_tokens.current` | INT64 |
| `loopstorm.budget.output_tokens.soft` | INT64 |
| `loopstorm.budget.output_tokens.hard` | INT64 |
| `loopstorm.budget.call_count.current` | INT64 |
| `loopstorm.budget.call_count.soft` | INT64 |
| `loopstorm.budget.call_count.hard` | INT64 |
| `loopstorm.budget.dimension` | STRING |

### B.4 Behavioral Telemetry Attributes (per-span, v1.1, optional)

| Attribute | Type |
|---|---|
| `loopstorm.telemetry.call_seq_fingerprint` | STRING |
| `loopstorm.telemetry.inter_call_ms` | INT64 |
| `loopstorm.telemetry.token_rate_delta` | DOUBLE |
| `loopstorm.telemetry.param_shape_hash` | STRING |

### B.5 Supervisor Attributes (per-span, supervisor traces only)

| Attribute | Type |
|---|---|
| `loopstorm.supervisor.run_id` | STRING |
| `loopstorm.supervisor.trigger` | STRING |
| `loopstorm.supervisor.trigger_run_id` | STRING |
| `loopstorm.supervisor.proposal_id` | STRING |
| `loopstorm.supervisor.proposal_type` | STRING |
| `loopstorm.supervisor.target_agent` | STRING |
| `loopstorm.supervisor.rationale` | STRING |
| `loopstorm.supervisor.confidence` | DOUBLE |
| `loopstorm.supervisor.supporting_runs` | STRING (JSON array) |
| `loopstorm.supervisor.status` | STRING |
| `loopstorm.supervisor.escalation_id` | STRING |
| `loopstorm.supervisor.severity` | STRING |
| `loopstorm.supervisor.recommendation` | STRING |
| `loopstorm.supervisor.timeout_seconds` | INT64 |
| `loopstorm.supervisor.timeout_action` | STRING |

---

## Appendix C: OTel Span Events

In addition to the standalone span per LoopStorm event, certain events
are also recorded as OTel Span Events on the root span for convenience:

| LoopStorm event_type | OTel Span Event name | Attached to | Attributes |
|---|---|---|---|
| `budget_soft_cap_warning` | `loopstorm.budget_warning` | Root span | `loopstorm.budget.dimension`, `loopstorm.reason` |
| `budget_exceeded` | `loopstorm.budget_exceeded` | Root span | `loopstorm.budget.dimension`, `loopstorm.reason` |
| `loop_detected` | `loopstorm.loop_detected` | The `policy_decision` span with the same `seq` (if exists), otherwise root span | `loopstorm.loop_rule`, `loopstorm.loop_action` |

These OTel Span Events are a convenience for backends that support
timeline annotations on spans. They duplicate information already
available as standalone spans.

---

## Appendix D: Example Trace Visualization

The following shows how a typical LoopStorm run appears in an OTel
trace viewer:

```
Trace: 01960e07d0e97ad086215614ec0dbd54
|-[root] loopstorm.run_started (0ms - 12450ms) [OK]
|  |- loopstorm.policy_decision seq=1 tool=file.read (2ms) [OK]
|  |- loopstorm.policy_decision seq=2 tool=http.get (3ms) [ERROR: deny]
|  |- loopstorm.budget_update seq=3 (0ms) [UNSET]
|  |- loopstorm.policy_decision seq=4 tool=file.read (1ms) [OK]
|  |     * SpanEvent: loopstorm.loop_detected
|  |- loopstorm.loop_detected seq=5 (0ms) [UNSET]
|  |- loopstorm.policy_decision seq=6 tool=file.write (2ms) [OK]
|  |- loopstorm.run_ended seq=7 (0ms) [OK]
|
|  * SpanEvent: loopstorm.loop_detected (at seq=5 timestamp)
```

---

## Appendix E: What This Spec Does NOT Define

- OTel Metrics export (e.g., decision rate, budget utilization gauges)
- OTel Logs export (the JSONL file is already a log; re-exporting as OTel
  Logs is redundant)
- W3C Trace Context propagation through the shim to the agent's own traces
- Custom OTel backend dashboards or alert configurations
- The exporter implementation (language, build system, CI pipeline)
- Sampling strategies (all events are exported; downstream sampling is the
  OTel backend's responsibility)
