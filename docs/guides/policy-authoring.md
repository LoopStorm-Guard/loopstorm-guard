<!-- SPDX-License-Identifier: MIT -->
# Policy Authoring Guide

This guide explains how to write LoopStorm Guard policy files. Policies
control which tool calls your AI agents can make, enforce budget limits,
detect loops, and redact sensitive data.

## Quick start

Create a file called `policy.yaml`:

```yaml
schema_version: 1
name: "my-first-policy"
rules:
  - name: "allow-reads"
    action: allow
    tool_pattern: "*_read"

  - name: "deny-all"
    action: deny
    reason: "default deny"
```

This policy allows any tool ending in `_read` and denies everything else.

## Policy file structure

Every policy file must have `schema_version: 1` and at least one rule.

```yaml
schema_version: 1        # Required. Always 1.
name: "descriptive-name" # Optional. Human-readable name.
description: "..."       # Optional. What this policy does.
agent_role: "coder"      # Optional. Scopes policy to an agent role (ADR-008).
environment: "production"# Optional. Default environment tag.

rules: [...]             # Required. Ordered list of rules.
budget: {...}            # Optional. Budget caps.
loop_detection: {...}    # Optional. Loop detection tuning.
redaction: {...}         # Optional. Secret redaction config.
```

## Rules

Rules are evaluated **in order**. The first rule that matches determines the
decision. If no rule matches, the decision is **deny** (fail-closed, ADR-002).

### Rule fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique identifier for this rule |
| `action` | Yes | `allow`, `deny`, or `require_approval` |
| `tool` | No | Exact tool name to match |
| `tool_pattern` | No | Glob pattern for tool names (e.g. `http.*`, `db_*`) |
| `conditions` | No | Additional conditions (all must match) |
| `reason` | No | Human-readable reason (included in deny responses) |
| `priority` | No | Explicit priority (lower = first). Overrides array order. |
| `timeout` | If `require_approval` | Seconds to wait for human approval |
| `timeout_action` | If `require_approval` | Action on timeout: `deny`, `allow`, or `kill` |

`tool` and `tool_pattern` are mutually exclusive. If neither is specified,
the rule matches all tools.

### Actions

- **`allow`** — tool call proceeds
- **`deny`** — tool call is blocked, agent receives the `reason`
- **`require_approval`** — tool call is paused pending human approval

### Examples

**Block SSRF attempts:**

```yaml
rules:
  - name: "block-cloud-metadata"
    action: deny
    tool: "http_get"
    conditions:
      - field: "args.url"
        operator: matches
        pattern: "http://169.254.*"
    reason: "SSRF: cloud metadata endpoint access blocked"
```

**Allow reads, require approval for destructive operations:**

```yaml
rules:
  - name: "allow-reads"
    action: allow
    tool_pattern: "*_read"

  - name: "approve-deletes"
    action: require_approval
    tool_pattern: "*_delete"
    timeout: 300
    timeout_action: deny
    reason: "Delete operations require human approval"

  - name: "deny-all"
    action: deny
    reason: "default deny"
```

**Environment-scoped rules:**

```yaml
rules:
  - name: "deny-writes-prod"
    action: deny
    tool_pattern: "*_write"
    conditions:
      - field: "environment"
        operator: equals
        value: "production"
    reason: "writes blocked in production"

  - name: "allow-writes"
    action: allow
    tool_pattern: "*_write"
```

## Conditions

Conditions add filters beyond tool name matching. All conditions on a rule
must match for the rule to fire.

### Condition fields

| Field | Required | Description |
|---|---|---|
| `field` | Yes | Field to evaluate (see below) |
| `operator` | Yes | Comparison operator |
| `value` | No | Value to compare against |
| `pattern` | No | Glob/regex pattern for `matches`/`not_matches` |

### Available fields

- `tool` — the tool name
- `agent_role` — the agent's role tag
- `environment` — the environment tag
- `args.<key>` — dot-notation into the tool call arguments (e.g. `args.url`, `args.path`)

### Operators

| Operator | Description | Value type |
|---|---|---|
| `equals` | Exact string match | `string` |
| `not_equals` | Negated exact match | `string` |
| `matches` | Glob pattern match | `pattern` field |
| `not_matches` | Negated glob match | `pattern` field |
| `in` | Value is in the list | `string[]` |
| `not_in` | Value is not in the list | `string[]` |

### Condition examples

```yaml
conditions:
  # Exact match
  - field: "environment"
    operator: equals
    value: "production"

  # Glob pattern
  - field: "args.url"
    operator: matches
    pattern: "http://internal.*"

  # List membership
  - field: "agent_role"
    operator: in
    value: ["admin", "supervisor"]
```

## Budget

Budget caps prevent runaway costs. Each dimension has an optional **soft**
cap (warning emitted, run continues) and a required **hard** cap (run
terminated with a `kill` decision).

```yaml
budget:
  cost_usd:
    soft: 8.00   # Warning at $8
    hard: 10.00  # Kill at $10
  input_tokens:
    hard: 500000 # Kill at 500K input tokens
  output_tokens:
    hard: 100000
  call_count:
    soft: 900
    hard: 1000   # Kill after 1000 tool calls
```

### Budget dimensions

| Dimension | Type | Description |
|---|---|---|
| `cost_usd` | `float` | Cumulative estimated cost in USD |
| `input_tokens` | `int` | Cumulative input tokens |
| `output_tokens` | `int` | Cumulative output tokens |
| `call_count` | `int` | Number of tool calls |

All dimensions are optional. You can set just `cost_usd` and `call_count`
if you don't track tokens.

The shim reports `input_tokens`, `output_tokens`, and `estimated_cost_usd`
on each check call. The engine accumulates these per run.

## Loop detection

Loop detection catches agents stuck in repetitive patterns. Two heuristics:

1. **Identical call fingerprint** — same tool + same args_hash N times
   within a rolling window
2. **Identical error response** — same error N times in a row without
   intervening success

```yaml
loop_detection:
  enabled: true                       # Default: true
  identical_call_window_seconds: 120  # Default: 120 (2 minutes)
  identical_call_threshold: 3         # Default: 3 identical calls
  identical_error_threshold: 3        # Default: 3 identical errors
  cooldown_ms: 5000                   # Default: 5000 (5 seconds)
```

On first trigger, the engine returns a `cooldown` decision. The shim
pauses for `cooldown_ms` then raises `CooldownError`. On repeated triggers
within the same run, the engine escalates to `kill`.

## Redaction

The engine automatically redacts secrets from tool call arguments before
writing them to the audit log. Default patterns cover API keys, bearer
tokens, JWTs, and AWS credentials.

```yaml
redaction:
  enabled: true  # Default: true
  additional_patterns:
    - name: "database-password"
      pattern: "(?i)password\\s*=\\s*\\S+"
      replacement: "[DB_PASSWORD_REDACTED]"
  key_patterns:
    - "secret"
    - "api_key"
    - "password"
```

`key_patterns` redacts the value of any JSON key matching the listed names,
regardless of its content.

## The `escalate_to_human` invariant

The tool name `escalate_to_human` can **never** be blocked by any policy
rule (ADR-012, C13). If your policy contains a `deny` rule that would
match `escalate_to_human`, the engine rejects the policy at load time.
This ensures agents can always request human help.

## Validation

Validate your policy file before deploying:

```bash
loopstorm-cli validate policy.yaml
```

The CLI checks:
- Schema version is supported
- All rules have valid actions and operators
- `tool` and `tool_pattern` are not used on the same rule
- `require_approval` rules have `timeout` and `timeout_action`
- No rule denies `escalate_to_human`
- Budget values are non-negative
- Soft cap ≤ hard cap (when both are set)

## Complete example

```yaml
schema_version: 1
name: "production-agent-policy"
description: >
  Production policy for coding agents. Blocks dangerous operations,
  enforces budget, and detects loops.

rules:
  # Safety: always allow escalation to human
  - name: "allow-escalation"
    action: allow
    tool: "escalate_to_human"

  # Security: block SSRF to cloud metadata
  - name: "block-metadata-ssrf"
    action: deny
    tool_pattern: "http_*"
    conditions:
      - field: "args.url"
        operator: matches
        pattern: "http://169.254.*"
    reason: "SSRF: cloud metadata access blocked"

  # Security: block localhost access
  - name: "block-localhost"
    action: deny
    tool_pattern: "http_*"
    conditions:
      - field: "args.url"
        operator: matches
        pattern: "http://127.0.0.*"
    reason: "SSRF: localhost access blocked"

  # Workflow: approve file deletions
  - name: "approve-deletes"
    action: require_approval
    tool_pattern: "*_delete"
    timeout: 300
    timeout_action: deny
    reason: "File deletion requires approval"

  # Allow: read operations
  - name: "allow-reads"
    action: allow
    tool_pattern: "*_read"

  # Allow: HTTP to external hosts
  - name: "allow-external-http"
    action: allow
    tool_pattern: "http_*"

  # Allow: write operations (non-production)
  - name: "allow-writes-non-prod"
    action: allow
    tool_pattern: "*_write"
    conditions:
      - field: "environment"
        operator: not_equals
        value: "production"

  # Default: deny everything else
  - name: "default-deny"
    action: deny
    reason: "not explicitly allowed by policy"

budget:
  cost_usd:
    soft: 8.00
    hard: 10.00
  call_count:
    soft: 900
    hard: 1000

loop_detection:
  enabled: true
  identical_call_threshold: 3
  cooldown_ms: 5000

redaction:
  enabled: true
  key_patterns:
    - "password"
    - "secret"
    - "token"
```
