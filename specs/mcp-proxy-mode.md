<!-- SPDX-License-Identifier: MIT -->
# Spec: MCP Proxy Mode

**Version:** 1.0
**Date:** 2026-03-20
**Status:** Normative
**ADR:** ADR-009
**Control philosophy stage:** Stage 1 (Prevent) -- extends the enforcement boundary to MCP tool calls
**Gate consumers:** MCP proxy implementer, CI/CD, release packaging, deployment guide
**Target MCP protocol version:** 2025-03-26

---

## 1. Overview

### 1.1 Problem Statement

The Model Context Protocol (MCP) is the dominant standard for agent tool
invocation as of 2026. LoopStorm Guard's enforcement boundary is currently
the language shim (`loopstorm.wrap()`) that intercepts LLM API calls. MCP
tool calls bypass this boundary entirely: an agent guarded by LoopStorm can
issue unrestricted MCP `tools/call` requests that the policy engine never
sees, the budget tracker never counts, and the loop detector never monitors.

This is a critical enforcement gap on the dominant 2026 agent tool-call
surface.

### 1.2 Solution

LoopStorm Guard provides an **MCP proxy server** that sits between the
agent and upstream MCP servers. The proxy intercepts MCP `tools/call`
requests, translates them into LoopStorm `DecisionRequest` messages, sends
them to the existing Rust engine over UDS, and acts on the engine's
`DecisionResponse`. If the engine allows the call, the proxy forwards it to
the upstream MCP server. If the engine denies, kills, or applies a
cooldown, the proxy returns an appropriate MCP error response to the agent.

The proxy is a new **transport adapter**, not a new enforcement path. The
same policy pack, budget configuration, loop detection, and JSONL audit
trail apply to MCP-proxied calls identically to shim-intercepted calls.
From the engine's perspective, an MCP-proxied tool call is indistinguishable
from a shim-intercepted tool call.

### 1.3 Scope

- This spec is a **v1.1 design deliverable** (ADR-009).
- Implementation may extend into v2 depending on complexity.
- This spec defines the architecture, protocol translation, configuration,
  and deployment model. It does not contain implementation code.

### 1.4 Resolved Decisions

| ID | Question | Decision | Rationale |
|---|---|---|---|
| OQ-MCP-1 | Implementation language | **TypeScript** (`apps/mcp-proxy/`, MIT) | The `@modelcontextprotocol/sdk` TypeScript SDK handles transport negotiation (stdio, SSE, streamable HTTP). Reimplementing MCP transport in Rust adds months of work for marginal performance gain. The proxy is not in the P99 < 5ms critical path -- the engine decision is. |
| OQ-MCP-2 | `run_id` generation | **UUID v7 per MCP connection**, override via MCP request metadata | Each MCP client connection represents one agent run. The proxy generates a UUID v7 when the connection is established. If the agent provides a `run_id` in the MCP request metadata, it takes precedence. |
| OQ-MCP-3 | `seq` numbering | **Proxy tracks `seq` per `run_id`** | The proxy is responsible for assigning monotonically increasing `seq` values. The upstream MCP server has no knowledge of LoopStorm sequencing. |
| OQ-MCP-4 | MCP spec version | **MCP 2025-03-26** (latest stable as of March 2026) | Pin to `@modelcontextprotocol/sdk` version `>=1.10.0 <2.0.0` for the implementation. The spec itself is protocol-version-aware, not SDK-version-aware. |

---

## 2. Architecture

### 2.1 Architecture Diagram

```
                                 ENFORCEMENT PLANE
                          +-----------------------------+
                          |                             |
+--------+   MCP    +-----+--------+   UDS/NDJSON   +--+-------+   JSONL
| Agent  |--------->| LoopStorm    |--------------->|  Rust    |--------> audit.jsonl
| (LLM)  |<---------| MCP Proxy    |<---------------| Engine   |
+--------+          +-----+--------+                +----------+
                          |
                          | MCP (forwarded)
                          v
                   +--------------+
                   | Upstream MCP |
                   | Server(s)    |
                   +--------------+
```

### 2.2 Data Flow for a Single `tools/call`

```
Agent                  Proxy                     Engine                Upstream
  |                      |                         |                     |
  |-- tools/call ------->|                         |                     |
  |                      |-- DecisionRequest ----->|                     |
  |                      |                         |-- evaluate() ---+   |
  |                      |                         |<- (internal) ---+   |
  |                      |<-- DecisionResponse ----|                     |
  |                      |                         |                     |
  |                      |  [if decision=allow]    |                     |
  |                      |-- tools/call (fwd) ---------------------->|  |
  |                      |<-- tools/call result <-----------------------|
  |<-- tools/call result-|                         |                     |
  |                      |                         |                     |
  |                      |  [if decision=deny]     |                     |
  |<-- MCP error --------|                         |                     |
```

### 2.3 Component Responsibilities

| Component | Responsibility |
|---|---|
| **Agent** | Issues MCP `tools/call` requests. Unaware of the proxy (or aware and configured to connect to it instead of the upstream server). |
| **Proxy** | Translates MCP to LoopStorm IPC. Manages `run_id` and `seq`. Forwards allowed calls. Returns MCP errors for denied calls. Passes through non-`tools/call` MCP features. |
| **Engine** | Evaluates policy, tracks budget, detects loops, writes JSONL. Unchanged from direct shim usage. |
| **Upstream** | Any standard MCP server. Unaware of LoopStorm. |

---

## 3. MCP Protocol Translation

### 3.1 `tools/call` Request to `DecisionRequest` Mapping

When the proxy receives a `tools/call` request from the agent, it constructs
a `DecisionRequest` (conforming to `schemas/ipc/decision-request.schema.json`)
using the following mapping:

| MCP `tools/call` field | `DecisionRequest` field | Mapping rule |
|---|---|---|
| `params.name` | `tool` | Direct copy. The MCP tool name is passed verbatim. |
| `params.arguments` | `args_hash` | JCS canonical JSON of `arguments`, then SHA-256 hex digest. Same algorithm as `specs/args-hash.md`. |
| `params.arguments` | `args_redacted` | The proxy MAY apply local redaction before sending. If redaction is not configured, this field is omitted. |
| (proxy-generated) | `run_id` | UUID v7 generated per connection, or overridden by metadata (Section 6.3). |
| (proxy-tracked) | `seq` | Monotonically increasing integer, starting at 1, incremented per `tools/call` within a `run_id`. |
| (clock) | `ts` | ISO 8601 timestamp of when the proxy intercepted the call. |
| (proxy config) | `agent_name` | From proxy configuration file, if set. |
| (proxy config) | `agent_role` | From proxy configuration file, if set. |
| (proxy config) | `environment` | From proxy configuration file, if set. |
| (not available) | `model` | Not available via MCP. Omitted. |
| (not available) | `input_tokens` | Not available via MCP. Omitted. |
| (not available) | `output_tokens` | Not available via MCP. Omitted. |
| (not available) | `estimated_cost_usd` | Not available via MCP. Omitted. |
| `params._meta` | (proxy-internal) | Used to extract `run_id` override. Not forwarded to engine. |
| N/A | `schema_version` | Always `1`. |

**Invariant:** The `DecisionRequest` produced by the proxy is structurally
identical to one produced by a language shim. The engine cannot and need not
distinguish between the two origins.

### 3.2 `DecisionResponse` to MCP Response Mapping

| `DecisionResponse.decision` | MCP behavior | MCP JSON-RPC error code | Notes |
|---|---|---|---|
| `allow` | Proxy forwards the `tools/call` to the upstream MCP server and returns the upstream's response to the agent. | (no error) | The proxy does NOT modify the upstream response. |
| `deny` | Proxy returns an MCP error response to the agent. The call is NOT forwarded to upstream. | `-32001` | `error.message`: `"Tool call denied by policy"`. `error.data.rule_id`: the `rule_id` from the engine. `error.data.reason`: the `reason` from the engine. |
| `cooldown` | Proxy pauses for `cooldown_ms` milliseconds, then returns an MCP error response. The call is NOT forwarded. | `-32002` | `error.message`: `"Tool call paused: loop detected"`. `error.data.cooldown_ms`: the value from the engine. `error.data.cooldown_message`: the corrective context from the engine. |
| `kill` | Proxy returns an MCP error response, then closes the MCP connection to the agent. | `-32003` | `error.message`: `"Run terminated"`. `error.data.reason`: the `reason` from the engine. Connection close signals run termination. |
| `require_approval` | Proxy returns an MCP error response indicating the call is held for human approval. | `-32004` | `error.message`: `"Tool call held for human approval"`. `error.data.approval_id`: the `approval_id` from the engine. `error.data.approval_timeout_ms`: the timeout from the engine. |

### 3.3 MCP Error Code Registry

The proxy uses application-defined error codes in the range `-32001`
through `-32099`. Per JSON-RPC 2.0, the range `-32000` to `-32099` is
reserved for implementation-defined server errors. The MCP specification
permits servers to define custom error codes in this range. The proxy's
codes are:

| Code | Constant name | Meaning |
|---|---|---|
| `-32001` | `LOOPSTORM_DENIED` | Policy denied the tool call. |
| `-32002` | `LOOPSTORM_COOLDOWN` | Loop detected; call paused. |
| `-32003` | `LOOPSTORM_KILLED` | Run terminated by policy or budget. |
| `-32004` | `LOOPSTORM_APPROVAL_REQUIRED` | Call held for human approval. |
| `-32005` | `LOOPSTORM_ENGINE_UNAVAILABLE` | Engine UDS connection failed. |

### 3.4 Fail-Closed Behavior (ADR-002)

If the proxy cannot reach the engine (UDS connection refused, timeout,
parse error), the proxy MUST deny the call. It returns MCP error code
`-32005` with `error.message`: `"LoopStorm engine unavailable"`.

The proxy does NOT have a `fail_open` option. MCP-proxied calls are
fail-closed unconditionally. Rationale: the proxy exists solely to enforce
policy on MCP calls. Allowing calls to bypass enforcement when the engine
is down defeats the purpose of the proxy. This differs from the language
shim's `fail_open` option, which exists because the shim wraps an existing
agent that may have been deployed before LoopStorm was added.

### 3.5 MCP Error Response Structure

All LoopStorm-originated error responses conform to JSON-RPC 2.0 error
format as required by MCP:

```json
{
  "jsonrpc": "2.0",
  "id": "<request_id>",
  "error": {
    "code": -32001,
    "message": "Tool call denied by policy",
    "data": {
      "loopstorm": true,
      "rule_id": "block-ssrf",
      "reason": "URL matches blocked pattern: 169.254.*"
    }
  }
}
```

The `error.data.loopstorm` field (boolean `true`) allows agents to
distinguish LoopStorm enforcement errors from upstream MCP server errors.

---

## 4. Tool Discovery

### 4.1 Tool List Passthrough

When the agent sends a `tools/list` request, the proxy forwards it to all
configured upstream MCP servers, collects the responses, and returns a
merged tool list to the agent. The proxy does NOT filter or modify the
tool list.

Rationale: policy enforcement happens at call time, not at discovery time.
An agent should see the full tool catalog. Policy rules use `tool` and
`tool_pattern` to match tool names at invocation time.

### 4.2 Tool Name Mapping

MCP tool names from upstream servers are passed through verbatim to the
engine's `tool` field in the `DecisionRequest`. Policy authors write rules
using the MCP tool names exactly as the upstream server declares them.

If multiple upstream servers are configured and tool name collisions exist
(two servers declaring the same tool name), the proxy MUST prefix tool
names with the upstream server identifier using dot notation:

```
<server_id>.<tool_name>
```

For example, if upstream server `github` and upstream server `filesystem`
both declare a tool named `read`, the proxy exposes them as
`github.read` and `filesystem.read`. This prefixing is applied
consistently to both the `tools/list` response and the engine's `tool`
field. It is enabled per-server via the `prefix` configuration option
(Section 6.1).

If only one upstream server is configured, or if no collisions exist and
`prefix` is not explicitly enabled, tool names are passed through without
modification.

### 4.3 Dynamic Tool Registration

MCP servers can change their tool list at runtime via the
`notifications/tools/list_changed` notification (MCP 2025-03-26). When
the proxy receives this notification from an upstream server, it:

1. Re-queries the upstream's `tools/list`.
2. Updates its internal tool catalog.
3. Forwards the `notifications/tools/list_changed` notification to the
   agent.

The proxy does NOT need to inform the engine of tool list changes. The
engine evaluates policy rules against the `tool` field of each
`DecisionRequest` at call time -- it does not maintain a tool catalog.

---

## 5. Transport

### 5.1 Agent-to-Proxy Transport

The proxy presents itself as a standard MCP server and supports the
following MCP transports for agent connections:

| Transport | Support level | Notes |
|---|---|---|
| **stdio** | Required (v1.1) | Primary integration path. The proxy binary is launched by the agent host as a subprocess. |
| **Streamable HTTP** | Required (v1.1) | MCP 2025-03-26 standard HTTP transport. The proxy listens on a configurable local port. |
| **SSE** (deprecated) | Optional | Deprecated in MCP 2025-03-26 but still widely used. Supported for backward compatibility. |

The agent connects to the proxy as if it were a normal MCP server. The
agent's MCP client configuration points to the proxy instead of the
upstream server.

### 5.2 Proxy-to-Engine Transport

The proxy connects to the LoopStorm engine via Unix Domain Socket (UDS)
using the existing NDJSON IPC protocol defined in
`specs/ipc-wire-format.md`. No changes to the IPC protocol are required.

| Parameter | Value |
|---|---|
| Transport | UDS (AF_UNIX, SOCK_STREAM) |
| Default socket path | `/tmp/loopstorm-engine.sock` |
| Override | `LOOPSTORM_SOCKET` env var or proxy config `engine_socket` |
| Protocol | NDJSON (one `DecisionRequest` per line, one `DecisionResponse` per line) |
| Max message size | 64 KiB |
| Shim-side timeout | 10 seconds (recommended) |

The proxy maintains a single persistent UDS connection to the engine for
the lifetime of the proxy process. If the connection drops, the proxy
attempts to reconnect with exponential backoff (100ms, 200ms, 400ms, ...
capped at 5s). During reconnection, all `tools/call` requests are denied
(fail-closed).

### 5.3 Proxy-to-Upstream Transport

The proxy connects to upstream MCP servers using the transport declared in
the proxy configuration file. Each upstream server has its own transport
configuration:

| Transport | Notes |
|---|---|
| **stdio** | The proxy launches the upstream MCP server as a subprocess. |
| **Streamable HTTP** | The proxy connects to the upstream's HTTP endpoint. |
| **SSE** | Supported for upstream servers that use the deprecated SSE transport. |

The proxy uses the `@modelcontextprotocol/sdk` client to manage upstream
connections. Transport negotiation is handled by the SDK.

---

## 6. Configuration

### 6.1 Proxy Configuration File

The proxy reads its configuration from a YAML file. Default path:
`loopstorm-proxy.yaml` in the current working directory. Override via
`--config <path>` CLI flag or `LOOPSTORM_PROXY_CONFIG` environment
variable.

```yaml
# loopstorm-proxy.yaml
schema_version: 1

# Engine connection
engine_socket: /tmp/loopstorm-engine.sock  # default

# Agent-facing transport (how the agent connects to this proxy)
transport:
  type: stdio            # stdio | http
  # HTTP-only options:
  port: 3100             # default 3100
  host: 127.0.0.1        # default 127.0.0.1 (localhost only)

# Agent identity (injected into every DecisionRequest)
agent_name: my-agent     # optional
agent_role: worker        # optional
environment: production   # optional

# Upstream MCP servers
upstreams:
  - id: filesystem
    transport:
      type: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    prefix: false          # default: false

  - id: github
    transport:
      type: http
      url: http://localhost:3200/mcp
    prefix: true           # prefix tool names with "github."

  - id: database
    transport:
      type: stdio
      command: node
      args: ["./db-mcp-server.js"]
    prefix: false
```

### 6.2 Configuration Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `schema_version` | integer | Yes | -- | Must be `1`. |
| `engine_socket` | string | No | `/tmp/loopstorm-engine.sock` | UDS path to the LoopStorm engine. |
| `transport.type` | string | Yes | -- | Agent-facing transport: `stdio` or `http`. |
| `transport.port` | integer | No | `3100` | HTTP listen port (only when `type: http`). |
| `transport.host` | string | No | `127.0.0.1` | HTTP listen address (only when `type: http`). |
| `agent_name` | string | No | -- | Injected into `DecisionRequest.agent_name`. |
| `agent_role` | string | No | -- | Injected into `DecisionRequest.agent_role`. |
| `environment` | string | No | -- | Injected into `DecisionRequest.environment`. |
| `upstreams` | array | Yes | -- | One or more upstream MCP server definitions. |
| `upstreams[].id` | string | Yes | -- | Unique identifier for this upstream. Used in tool name prefixing. |
| `upstreams[].transport.type` | string | Yes | -- | Upstream transport: `stdio`, `http`, or `sse`. |
| `upstreams[].transport.command` | string | Cond. | -- | Command to launch (required for `stdio`). |
| `upstreams[].transport.args` | array | No | `[]` | Arguments for the subprocess (only for `stdio`). |
| `upstreams[].transport.url` | string | Cond. | -- | URL to connect to (required for `http` and `sse`). |
| `upstreams[].transport.headers` | object | No | -- | Additional HTTP headers for `http`/`sse` transport. |
| `upstreams[].prefix` | boolean | No | `false` | If `true`, prefix tool names with `<id>.` in the merged tool list. |

### 6.3 `run_id` Assignment

The proxy generates a UUID v7 when a new MCP client connection is
established. This UUID becomes the `run_id` for all `DecisionRequest`
messages sent during that connection's lifetime.

An agent MAY override the `run_id` by including it in the MCP request
metadata (`_meta`) field on the first `tools/call` request:

```json
{
  "method": "tools/call",
  "params": {
    "name": "read_file",
    "arguments": { "path": "/etc/hosts" },
    "_meta": {
      "loopstorm_run_id": "01942f2a-4e6c-7000-8000-000000000001"
    }
  }
}
```

Rules for `run_id` override:

1. The override is read from `params._meta.loopstorm_run_id` on the
   **first** `tools/call` request of the connection.
2. If present and valid (UUID format), it replaces the proxy-generated
   UUID for the duration of the connection.
3. If present but invalid, the proxy logs a warning and uses its own
   generated UUID.
4. Subsequent `tools/call` requests on the same connection that include a
   different `loopstorm_run_id` are ignored (the `run_id` is locked to
   the connection).
5. The `_meta` field is NOT forwarded to the engine. It is consumed by the
   proxy.

### 6.4 Policy Pack Applies Identically

The proxy does not have its own policy configuration. The same policy pack
loaded by the engine applies to MCP-proxied calls. MCP tool names appear
in the engine's `tool` field and match against `tool` and `tool_pattern`
rules exactly as shim-originated tool names do.

Example policy rules for MCP tools:

```yaml
rules:
  - name: allow-filesystem-reads
    tool_pattern: "filesystem.*"
    action: allow

  - name: block-dangerous-db
    tool: "database.drop_table"
    action: deny
    reason: "DROP TABLE is not permitted"

  - name: require-approval-for-github-push
    tool: "github.push"
    action: require_approval
    timeout: 300
    timeout_action: deny
```

### 6.5 Budget and Loop Detection Context

The proxy does not maintain budget or loop detection state. It sends
`DecisionRequest` messages to the engine, and the engine maintains all
state keyed by `run_id`.

Because the proxy-generated `run_id` maps to a single MCP client
connection, all tool calls within that connection share the same budget and
loop detection context. This is the same behavior as a language shim that
holds a single UDS connection for the duration of an agent run.

If an agent uses both a language shim and the MCP proxy simultaneously
(e.g., some tools via direct API calls, others via MCP), the `run_id`
SHOULD be shared between the shim and the proxy to ensure unified budget
tracking. The agent achieves this by:

1. Generating a UUID v7 in the agent process.
2. Passing it to the language shim via `Guard(run_id=...)`.
3. Passing it to the MCP proxy via `_meta.loopstorm_run_id`.

If the `run_id` is not shared, the engine treats the shim calls and MCP
calls as separate runs with independent budgets. This is safe but may
allow the aggregate budget to exceed the intended cap.

---

## 7. MCP Features Beyond `tools/call`

The MCP protocol (2025-03-26) defines several capabilities beyond tool
invocation. The proxy handles each as follows:

| MCP Feature | Proxy Behavior | Policy Enforcement | Logging |
|---|---|---|---|
| `tools/call` | **Intercepted** -- full LoopStorm enforcement pipeline | Yes | Yes (JSONL via engine) |
| `tools/list` | **Pass-through** with optional tool name prefixing | No | No |
| `resources/read` | **Pass-through** | No | Logged as `system_event` with `system_event_type: "mcp_resource_read"` |
| `resources/list` | **Pass-through** | No | No |
| `resources/subscribe` | **Pass-through** | No | No |
| `prompts/get` | **Pass-through** | No | No |
| `prompts/list` | **Pass-through** | No | No |
| `sampling/createMessage` | **Pass-through** | No | Logged as `system_event` with `system_event_type: "mcp_sampling_request"` |
| `completion/complete` | **Pass-through** | No | No |
| Notifications | **Pass-through** (both directions) | No | No |
| `ping` | **Pass-through** | No | No |
| `initialize` | **Handled by proxy** -- proxy negotiates with both agent and upstream | N/A | No |
| `logging/*` | **Pass-through** | No | No |

### 7.1 Resources

MCP resources (`resources/read`, `resources/list`, `resources/subscribe`)
are passed through without enforcement. The proxy logs `resources/read`
requests as `system_event` entries in the JSONL audit trail for
observability, but does not apply policy rules.

Rationale: resources are data retrieval operations, not tool executions.
Enforcing policy on resource reads is a v2 consideration. The audit trail
captures which resources were accessed for post-hoc analysis.

### 7.2 Prompts

MCP prompts (`prompts/get`, `prompts/list`) are passed through without
enforcement or logging. Prompts are template retrieval operations with no
side effects.

### 7.3 Sampling

MCP sampling (`sampling/createMessage`) is passed through without
enforcement. The proxy logs sampling requests as `system_event` entries
because sampling involves LLM inference (potential cost), but enforcement
is deferred to v2.

### 7.4 Notifications

MCP notifications (both client-to-server and server-to-client) are passed
through bidirectionally without modification, enforcement, or logging.
This includes:

- `notifications/tools/list_changed` (handled in Section 4.3)
- `notifications/resources/list_changed`
- `notifications/resources/updated`
- `notifications/progress`
- `notifications/cancelled`

### 7.5 Rationale

v1.1 enforces `tools/call` only. This is the minimum viable enforcement
surface: tool calls are the mechanism by which agents take actions with
side effects. Other MCP capabilities (resources, prompts, sampling) are
informational or advisory and do not directly cause side effects in
external systems.

Expanding enforcement to resources and sampling is a v2 design decision
that requires new policy rule types beyond the current `tool`/`tool_pattern`
matching model.

---

## 8. Deployment Model

### 8.1 Mode 0: Air-Gapped Local

In Mode 0, the proxy runs as a local process alongside the engine. No
network access is required. The proxy communicates with the engine via UDS
and with upstream MCP servers via stdio (subprocess) or localhost HTTP.

```
+--------+  stdio  +---------+  UDS   +--------+  JSONL
| Agent  |-------->|  Proxy  |------->| Engine |-------> audit.jsonl
+--------+         +---------+        +--------+
                        |
                        | stdio (subprocess)
                        v
                   +-----------+
                   | Upstream  |
                   | MCP Server|
                   +-----------+
```

The proxy is a Node.js process (Bun-compatible). It requires a JavaScript
runtime but no network connectivity. All upstream MCP servers in Mode 0
are local (stdio subprocesses or localhost HTTP).

The proxy binary can be distributed as:

- A standalone `npx`-runnable package: `npx @loopstorm/mcp-proxy --config loopstorm-proxy.yaml`
- A global install: `bun add -g @loopstorm/mcp-proxy`
- A project dependency: `bun add -D @loopstorm/mcp-proxy`

### 8.2 Mode 2/3: Hosted Control Plane

In Modes 2 and 3, the proxy operates identically to Mode 0 at the local
level. Event forwarding to the hosted backend is the responsibility of the
engine's event forwarding mechanism, not the proxy. The proxy itself never
makes outbound network calls to the LoopStorm backend.

The proxy's events appear in the hosted dashboard as standard
`policy_decision` events. The dashboard cannot distinguish MCP-proxied
events from shim-originated events (by design -- both are enforcement
events).

### 8.3 Proxy Lifecycle

The proxy can be started in two ways:

**Standalone:** The proxy is started as an independent process. The engine
must already be running and listening on the configured UDS path.

```bash
# Start engine first
loopstorm-engine --policy policy.yaml --audit-log audit.jsonl &

# Start proxy
npx @loopstorm/mcp-proxy --config loopstorm-proxy.yaml
```

**Managed by engine (v2, deferred):** The engine could launch the proxy
as a subprocess. This is not a v1.1 requirement.

The proxy exits when:

1. The agent closes the MCP connection (stdio: stdin closes; HTTP: no
   active connections after idle timeout).
2. The proxy receives SIGTERM or SIGINT.
3. The engine UDS connection fails and cannot be re-established after
   the retry limit (10 attempts with exponential backoff).

On shutdown, the proxy closes all upstream MCP connections gracefully
(sending any required MCP shutdown notifications) before exiting.

---

## 9. `args_hash` for MCP Calls

### 9.1 Computation

MCP `tools/call` sends tool arguments in the `params.arguments` field as a
JSON object. The proxy computes `args_hash` using the identical algorithm
defined in `specs/args-hash.md`:

```
args_hash = hex_lower(sha256(utf8_encode(jcs_canonicalize(arguments))))
```

The proxy MUST use an RFC 8785 compliant JCS implementation. The
recommended TypeScript implementation is the `canonicalize` npm package.

### 9.2 Missing Arguments

If `params.arguments` is absent or `undefined` in the MCP `tools/call`
request, the proxy treats it as `null` and computes:

```
args_hash = sha256("null") = 74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b
```

This matches the behavior defined in `specs/args-hash.md` Section 5.1.

### 9.3 Cross-Language Consistency

The proxy MUST pass all 12 test vectors in `tests/fixtures/args-hash-vectors.json`.
This ensures that MCP-proxied calls produce identical `args_hash` values to
Python-shim-originated calls for the same tool arguments. The loop
detector and audit trail integrity depend on this consistency.

---

## 10. Security Considerations

### 10.1 Localhost Only

The proxy's HTTP transport (when configured) binds to `127.0.0.1` by
default. Binding to `0.0.0.0` or any non-loopback address is NOT
supported in v1.1 and MUST be rejected by the proxy at startup.

Rationale: the proxy is a local enforcement component. Exposing it over
the network would create an unauthenticated MCP server accessible to
remote clients. Network-accessible MCP enforcement requires additional
authentication that is out of scope for v1.1.

### 10.2 No Additional Auth Between Proxy and Engine

In Mode 0, the proxy connects to the engine via UDS with file permission
`0600`. This is the same access control mechanism as the language shim.
No additional authentication is required or supported.

### 10.3 MCP Transport Security

Security of the agent-to-proxy and proxy-to-upstream MCP connections is
inherited from MCP's own transport layer:

| Transport | Security |
|---|---|
| stdio | Process isolation (same user). No network exposure. |
| HTTP | Localhost-only binding. No TLS required for loopback. |
| SSE | Same as HTTP. |

For upstream MCP servers accessed over non-loopback HTTP (e.g., a remote
MCP server), the proxy SHOULD support TLS but this is an upstream
transport concern, not a LoopStorm enforcement concern.

### 10.4 Upstream Server Trust

The proxy forwards allowed tool calls to upstream MCP servers. It does not
validate or sanitize the upstream server's response. The proxy trusts that
the upstream server returns well-formed MCP responses.

The proxy does NOT forward `args_redacted` to the upstream server. It
forwards the original `params.arguments` from the agent. Redaction is for
the audit trail only.

### 10.5 Engine Unavailability

If the engine is unavailable (connection refused, timeout), the proxy
denies ALL `tools/call` requests with MCP error code `-32005`. This is
fail-closed behavior per ADR-002. The proxy does NOT queue requests for
later processing.

---

## 11. Latency Impact

An MCP-proxied tool call adds the following latency compared to a direct
(non-guarded) MCP call:

| Component | Expected latency | Notes |
|---|---|---|
| Proxy JSON parse + `args_hash` computation | < 1 ms | In-process. SHA-256 of small payload. |
| UDS round-trip to engine | < 5 ms (P99) | Same as shim IPC. Includes policy eval, budget check, loop detection. |
| Proxy response construction | < 0.5 ms | In-process. |
| **Total overhead** | **< 7 ms (P99)** | Added to the upstream MCP server's own latency. |

For tool calls where the upstream MCP server latency is 100ms+ (typical
for API-based tools), the proxy overhead is negligible (< 7% of total
round-trip time).

The proxy does NOT add latency to non-`tools/call` MCP operations
(resources, prompts, notifications). These are passed through without
engine consultation.

---

## 12. Implementation Language and Package Location

### 12.1 Language Decision: TypeScript

The MCP proxy is implemented in TypeScript. Rationale:

1. **SDK availability:** The `@modelcontextprotocol/sdk` is TypeScript-native.
   It handles transport negotiation (stdio, SSE, streamable HTTP), protocol
   versioning, and message framing. Reimplementing this in Rust would add
   months of development for marginal performance benefit.

2. **Performance sufficiency:** The proxy's hot path (JSON parse, SHA-256,
   UDS write, UDS read, JSON serialize) is well within TypeScript/Bun
   performance capabilities. The P99 < 5ms budget enforcement is in the
   Rust engine, not the proxy.

3. **Ecosystem alignment:** MCP server implementations are overwhelmingly
   TypeScript. The proxy's development and testing benefit from sharing the
   same language and tooling as the ecosystem it integrates with.

### 12.2 Package Location

```
apps/mcp-proxy/
  package.json          # @loopstorm/mcp-proxy
  tsconfig.json
  src/
    index.ts            # Entry point
    config.ts           # YAML config parsing and validation
    proxy.ts            # Core proxy logic
    engine-client.ts    # UDS NDJSON client to LoopStorm engine
    args-hash.ts        # JCS canonicalization + SHA-256
    mapping.ts          # MCP <-> DecisionRequest/Response translation
    errors.ts           # MCP error response construction
  bin/
    loopstorm-mcp-proxy.ts  # CLI entry point
```

### 12.3 License

MIT (per ADR-013: `apps/` directory is MIT-licensed). Every source file
carries `// SPDX-License-Identifier: MIT`.

### 12.4 Dependencies

| Package | Purpose | License |
|---|---|---|
| `@modelcontextprotocol/sdk` | MCP server and client implementation | MIT |
| `canonicalize` | RFC 8785 JCS canonicalization for `args_hash` | MIT |
| `yaml` | Proxy config file parsing | ISC |

No runtime dependency on the LoopStorm backend, web dashboard, or any
AGPL-licensed package.

---

## 13. Relationship to Language Shims

The MCP proxy is **additive, not a replacement** for the language shims
(`loopstorm-py`, `loopstorm-ts`).

| Scenario | Recommended approach |
|---|---|
| Agent uses direct LLM API calls only (OpenAI, Anthropic SDK) | Language shim (`loopstorm.wrap()`) |
| Agent uses MCP tools only | MCP proxy |
| Agent uses both direct API calls and MCP tools | Language shim + MCP proxy with shared `run_id` |
| Agent framework provides MCP client (e.g., Claude Desktop, Cursor) | MCP proxy (shim cannot intercept framework-internal MCP calls) |

The language shim has capabilities that the MCP proxy does not:

| Capability | Language shim | MCP proxy |
|---|---|---|
| Token count tracking | Yes (from LLM response) | No (MCP does not expose tokens) |
| Cost estimation | Yes (model + tokens) | No |
| Model identification | Yes (from API call) | No |
| `args_redacted` from raw args | Yes | Possible but limited (no schema context) |
| Cooldown with auto-retry | Yes (shim sleeps then retries) | No (returns error to agent) |

The MCP proxy is the correct enforcement point when the tool invocation
surface is MCP. It extends LoopStorm's enforcement boundary to cover the
MCP protocol without requiring agent code changes beyond pointing the
agent's MCP client at the proxy instead of the upstream server.

---

## 14. References

- ADR-009: MCP Proxy Mode (foundational decision)
- ADR-001: IPC Wire Format
- ADR-002: Fail-Closed Default
- ADR-004: `run_id` Client-Generated
- ADR-007: Multi-Dimensional Budget
- `specs/ipc-wire-format.md` (UDS NDJSON protocol)
- `specs/args-hash.md` (JCS + SHA-256 algorithm)
- `schemas/ipc/decision-request.schema.json`
- `schemas/ipc/decision-response.schema.json`
- `schemas/policy/policy.schema.json` (`tool` and `tool_pattern` fields)
- `docs/deployment-modes.md` (Mode 0/1/2/3)
- `docs/control-philosophy.md` (Stage 1 -- Prevent)
- MCP Specification 2025-03-26: https://spec.modelcontextprotocol.io/
