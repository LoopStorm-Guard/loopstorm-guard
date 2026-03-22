<!-- SPDX-License-Identifier: MIT -->
# JSONL Event Schema Reference

Every event written to the audit log conforms to `event.schema.json`
(schema_version 1). Each line in the JSONL file is one event.

## Common fields (all events)

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | `int` | Yes | Always `1` |
| `event_type` | `string` | Yes | Event type (see below) |
| `run_id` | `string (uuid)` | Yes | Run this event belongs to |
| `seq` | `int` | Yes | Monotonically increasing sequence number within the run |
| `hash` | `string (hex64)` | Yes | SHA-256 of event payload (excluding `hash` and `hash_prev`) |
| `hash_prev` | `string (hex64) \| null` | No | Hash of previous event. Null for seq=1 |
| `ts` | `string (ISO 8601)` | Yes | Timestamp of event creation |

## Hash chain

Events form a tamper-evident hash chain per run:

```
Event 1: hash = SHA256(payload_1),           hash_prev = null
Event 2: hash = SHA256(payload_2),           hash_prev = hash_1
Event 3: hash = SHA256(payload_3),           hash_prev = hash_2
```

The payload for hashing is the JSON line with `hash` and `hash_prev`
fields stripped. To verify: remove those two fields from the raw line,
compute SHA-256, and compare with the stored `hash`.

## Event types

### `run_started`

Emitted when a new agent run begins.

| Field | Type | Description |
|---|---|---|
| `run_status` | `"started"` | Always "started" |
| `agent_name` | `string` | Human-readable agent name |
| `agent_role` | `string` | Agent role tag |
| `environment` | `string` | Environment tag |
| `policy_pack_id` | `string` | Active policy pack ID |

### `policy_decision`

Emitted for every tool call checked against the policy.

| Field | Type | Description |
|---|---|---|
| `tool` | `string` | Tool name (e.g. "http_get") |
| `args_hash` | `string (hex64)` | SHA-256 of JCS-canonical args |
| `args_redacted` | `object` | Tool args after secret redaction |
| `decision` | `string` | `"allow"`, `"deny"`, `"cooldown"`, `"kill"`, `"require_approval"` |
| `rule_id` | `string` | Policy rule that produced the decision |
| `reason` | `string` | Human-readable reason |
| `model` | `string` | LLM model identifier |
| `input_tokens` | `int` | Input tokens for this call |
| `output_tokens` | `int` | Output tokens for this call |
| `estimated_cost_usd` | `float` | Estimated cost |
| `latency_ms` | `float` | Engine processing latency |

### `budget_update`

Emitted after each `policy_decision` with updated budget state.

| Field | Type | Description |
|---|---|---|
| `budget` | `object` | Current budget state (see Budget object below) |

### `budget_soft_cap_warning`

Emitted when a budget dimension's soft cap is reached.

| Field | Type | Description |
|---|---|---|
| `dimension` | `string` | `"cost_usd"`, `"input_tokens"`, `"output_tokens"`, `"call_count"` |
| `budget` | `object` | Current budget state |

### `budget_exceeded`

Emitted when a budget dimension's hard cap is reached. The decision is `kill`.

| Field | Type | Description |
|---|---|---|
| `dimension` | `string` | Which dimension was exceeded |
| `budget` | `object` | Final budget state |

### `loop_detected`

Emitted when the loop detector fires.

| Field | Type | Description |
|---|---|---|
| `loop_rule` | `string` | Which heuristic fired (e.g. "identical_call", "identical_error") |
| `loop_action` | `string` | `"cooldown"` (first trigger) or `"kill"` (repeated) |
| `cooldown_ms` | `int` | Cooldown duration applied (if action is cooldown) |

### `run_ended`

Emitted when a run finishes.

| Field | Type | Description |
|---|---|---|
| `run_status` | `string` | Final status: `"completed"`, `"terminated_budget"`, `"terminated_loop"`, `"terminated_policy"`, `"abandoned"`, `"error"` |

### `system_event`

Internal engine events (backpressure, startup, etc.).

| Field | Type | Description |
|---|---|---|
| `system_event_type` | `string` | Subtype (e.g. "queue_backpressure_activated") |
| `reason` | `string` | Details |

### Supervisor events

These events are emitted by the AI Supervisor (observation plane only):

- **`supervisor_run_started`** — supervisor begins analysis
- **`supervisor_tool_call`** — supervisor calls an analysis tool
- **`supervisor_proposal_created`** — supervisor proposes a change
- **`supervisor_escalation_created`** — supervisor flags for human attention

See `specs/ai-supervisory-interface.md` for full details.

## Budget object

```json
{
  "cost_usd": { "current": 3.50, "soft": 8.00, "hard": 10.00 },
  "input_tokens": { "current": 150000, "hard": 500000 },
  "call_count": { "current": 42, "soft": 900, "hard": 1000 }
}
```

Each dimension has `current` (accumulated value), and optional `soft`/`hard`
caps from the policy. Dimensions not configured in the policy are omitted.

## Example JSONL

```jsonl
{"schema_version":1,"event_type":"run_started","run_id":"019...","seq":1,"hash":"abc...","hash_prev":null,"ts":"2026-03-22T10:00:00Z","run_status":"started","agent_name":"coder","agent_role":"coder"}
{"schema_version":1,"event_type":"policy_decision","run_id":"019...","seq":2,"hash":"def...","hash_prev":"abc...","ts":"2026-03-22T10:00:01Z","tool":"file_read","args_hash":"123...","decision":"allow","rule_id":"allow-reads"}
{"schema_version":1,"event_type":"policy_decision","run_id":"019...","seq":3,"hash":"ghi...","hash_prev":"def...","ts":"2026-03-22T10:00:02Z","tool":"http_get","args_hash":"456...","args_redacted":{"url":"http://169.254.169.254"},"decision":"deny","rule_id":"block-metadata-ssrf","reason":"SSRF: cloud metadata access blocked"}
{"schema_version":1,"event_type":"run_ended","run_id":"019...","seq":4,"hash":"jkl...","hash_prev":"ghi...","ts":"2026-03-22T10:00:03Z","run_status":"completed"}
```
