<!-- SPDX-License-Identifier: MIT -->
# Integration Guide

This guide shows how to integrate LoopStorm Guard into your AI agent
application using the Python or TypeScript shim.

## Architecture overview

```
┌──────────────┐      UDS/Named Pipe       ┌──────────────────┐
│  Your Agent  │ ──── (NDJSON protocol) ──▶ │  loopstorm-engine│
│  + shim      │ ◀──── DecisionResponse ─── │  (Rust binary)   │
└──────────────┘                            └──────────────────┘
```

1. Start the `loopstorm-engine` binary with a policy file
2. Your agent code wraps tool calls via the shim
3. Each tool call is checked against the policy before execution
4. The engine writes a tamper-evident audit log (JSONL hash chain)

## Step 1: Start the engine

```bash
loopstorm-engine --policy policy.yaml --audit-log audit.jsonl
```

The engine listens on a Unix Domain Socket (default:
`/tmp/loopstorm-engine.sock`) or named pipe on Windows
(`\\.\pipe\loopstorm-engine`).

Options:
- `--socket <path>` — custom socket path
- `--log-level <level>` — `trace`, `debug`, `info` (default), `warn`, `error`
- `--validate-policy` — validate the policy file and exit (don't start the server)
- `--force` — remove a stale socket file before starting

## Step 2: Install the shim

### Python

```bash
pip install loopstorm-py
```

### TypeScript / Node.js

```bash
bun add @loopstorm/shim-ts
# or
npm install @loopstorm/shim-ts
```

## Step 3: Wrap your tool calls

### Python — decorator pattern

```python
from loopstorm import Guard

guard = Guard(fail_open=False)

@guard.wrap("file_read")
def read_file(path: str) -> str:
    return open(path).read()

@guard.wrap("http_get")
def http_get(url: str) -> str:
    import urllib.request
    return urllib.request.urlopen(url).read().decode()

# Tool calls are now enforced
content = read_file("/etc/hosts")  # Allowed by policy
http_get("http://169.254.169.254")  # Raises PolicyDeniedError
```

### Python — explicit check

```python
from loopstorm import Guard

guard = Guard()

# Manual check before executing
result = guard.check("db_write", args={"table": "users", "data": {"name": "Alice"}})
# result.decision == "allow"

# With token tracking for budget enforcement
result = guard.check(
    "llm_call",
    args={"prompt": "..."},
    input_tokens=1500,
    output_tokens=200,
    estimated_cost_usd=0.003,
)
```

### Python — OpenAI adapter

```python
from openai import OpenAI
from loopstorm import Guard

client = OpenAI()
guard = Guard(agent_role="coder", environment="production")
guarded = guard.openai(client)

# All tool calls in responses are automatically checked
response = guarded.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Read /etc/passwd"}],
    tools=[{"type": "function", "function": {"name": "file_read", ...}}],
)
```

### TypeScript — wrap pattern

```typescript
import { Guard } from "@loopstorm/shim-ts";

const guard = new Guard({
  failOpen: false,
  agentRole: "coder",
  environment: "production",
});

const safeFetch = guard.wrap("http_get", fetch);

// Enforced — denied by policy if URL is internal
const response = await safeFetch("https://api.example.com/data");

guard.close();
```

### TypeScript — explicit check

```typescript
import { Guard, PolicyDeniedError } from "@loopstorm/shim-ts";

const guard = new Guard();

try {
  await guard.check("db_write", {
    args: { table: "users", data: { name: "Alice" } },
    estimatedCostUsd: 0.001,
  });
  // Proceed with the write...
} catch (err) {
  if (err instanceof PolicyDeniedError) {
    console.log(`Blocked: ${err.reason}`);
  }
}

guard.close();
```

### TypeScript — OpenAI adapter

```typescript
import OpenAI from "openai";
import { Guard } from "@loopstorm/shim-ts";

const client = new OpenAI();
const guard = new Guard({ agentRole: "coder" });
const guarded = guard.openai(client);

// Tool calls in responses are checked before returning
const response = await guarded.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Read /etc/passwd" }],
  tools: [{ type: "function", function: { name: "file_read", ... } }],
});
```

## Guard options

| Option | Python | TypeScript | Default | Description |
|---|---|---|---|---|
| Socket path | `socket_path` | `socketPath` | Platform default | Path to engine socket |
| Fail open | `fail_open` | `failOpen` | `True`/`true` | Allow calls when engine is unavailable |
| Run ID | `run_id` | `runId` | UUID v4 | Fixed run ID for this guard instance |
| Agent role | `agent_role` | `agentRole` | None | Role tag for policy matching |
| Agent name | `agent_name` | `agentName` | None | Human-readable agent name |
| Environment | `environment` | `environment` | None | Environment tag |
| Model | `model` | `model` | None | Model name |
| Timeout | `timeout` | `timeout` | 10 (seconds) | Socket timeout |

## Error handling

The shim raises typed errors for each enforcement decision:

| Error class | When raised | What to do |
|---|---|---|
| `PolicyDeniedError` | Tool call denied by policy | Skip the tool call, try an alternative |
| `CooldownError` | Loop detected, cooldown applied | Wait, then retry with different args |
| `RunTerminatedError` | Run killed (budget/policy/audit) | Stop the agent run entirely |
| `ApprovalRequiredError` | Human approval needed | Wait for approval or handle timeout |
| `EngineUnavailableError` | Cannot reach engine (`failOpen=false`) | Engine is down — restart it |

### Handling errors in Python

```python
from loopstorm import Guard, PolicyDeniedError, RunTerminatedError

guard = Guard(fail_open=False)

try:
    guard.check("dangerous_tool", args={"target": "production"})
except PolicyDeniedError as e:
    print(f"Denied by rule {e.rule_id}: {e.reason}")
except RunTerminatedError as e:
    print(f"Run killed: {e.reason}")
    raise  # Propagate to stop the agent
```

### Handling errors in TypeScript

```typescript
import { Guard, PolicyDeniedError, RunTerminatedError } from "@loopstorm/shim-ts";

const guard = new Guard({ failOpen: false });

try {
  await guard.check("dangerous_tool", { args: { target: "production" } });
} catch (err) {
  if (err instanceof PolicyDeniedError) {
    console.log(`Denied by rule ${err.ruleId}: ${err.reason}`);
  } else if (err instanceof RunTerminatedError) {
    console.log(`Run killed: ${err.reason}`);
    throw err;
  }
}
```

## Fail-open vs fail-closed

- **`failOpen: true`** (default) — if the engine is unavailable, tool
  calls proceed without enforcement. Use this during development or when
  agent availability matters more than enforcement.

- **`failOpen: false`** — if the engine is unavailable, tool calls throw
  `EngineUnavailableError`. Use this in production where enforcement is
  mandatory.

## Context manager (Python)

```python
with Guard(fail_open=False) as guard:
    guard.check("tool_a")
    guard.check("tool_b")
# Connection is automatically closed
```

## Verifying the audit trail

After a run, verify the hash chain integrity:

```bash
loopstorm-cli verify audit.jsonl
# Exit 0 = chain intact
# Exit 1 = chain broken at sequence N

loopstorm-cli replay audit.jsonl
# Pretty-prints the audit log with hash verification
```

## Environment variables

| Variable | Description |
|---|---|
| `LOOPSTORM_SOCKET` | Override the default socket path |

## Mode 0 (air-gapped)

In Mode 0, everything runs locally with no network calls:
- Engine binary runs on the same machine
- Shim connects via local socket
- Audit log is written to local disk
- No cloud services required

This is the default and recommended starting point.
