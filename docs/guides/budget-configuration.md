<!-- SPDX-License-Identifier: MIT -->
# Budget Configuration Guide

Budget caps prevent AI agents from consuming excessive resources. This guide
covers how to configure and tune budget limits in your policy file.

## How budgets work

The engine tracks four dimensions of resource consumption per run:

| Dimension | Unit | Reported by |
|---|---|---|
| `cost_usd` | US dollars | Shim (via `estimated_cost_usd`) |
| `input_tokens` | Token count | Shim (via `input_tokens`) |
| `output_tokens` | Token count | Shim (via `output_tokens`) |
| `call_count` | Integer | Engine (auto-incremented per check) |

On each `guard.check()` call, the shim can report token counts and cost.
The engine accumulates these values and checks them against the configured
caps.

## Soft vs hard caps

Each dimension supports two thresholds:

- **Soft cap** (optional) — emits a `budget_soft_cap_warning` event.
  The run continues. Use this to trigger alerts or logging.
- **Hard cap** (required) — emits a `budget_exceeded` event and returns
  a `kill` decision. The run is terminated.

Soft cap must be ≤ hard cap when both are set.

## Basic configuration

```yaml
budget:
  cost_usd:
    soft: 8.00    # Warn at $8
    hard: 10.00   # Kill at $10
  call_count:
    hard: 1000    # Kill after 1000 calls (no soft warning)
```

## Recommended defaults

### Development / testing

```yaml
budget:
  cost_usd:
    hard: 1.00     # Low cost limit for testing
  call_count:
    hard: 100      # Quick termination for runaway loops
```

### Production — lightweight agent

```yaml
budget:
  cost_usd:
    soft: 5.00
    hard: 10.00
  input_tokens:
    soft: 200000
    hard: 500000
  output_tokens:
    soft: 50000
    hard: 100000
  call_count:
    soft: 400
    hard: 500
```

### Production — complex agent (multi-step, long-running)

```yaml
budget:
  cost_usd:
    soft: 40.00
    hard: 50.00
  input_tokens:
    hard: 2000000
  output_tokens:
    hard: 500000
  call_count:
    soft: 4000
    hard: 5000
```

## Tracking cost

The shim does not automatically compute cost — your application must
provide `estimated_cost_usd` on each check call. This keeps the shim
model-agnostic.

### Python example

```python
# After an LLM call, report the cost
result = guard.check(
    "llm_call",
    args={"prompt": prompt},
    input_tokens=response.usage.prompt_tokens,
    output_tokens=response.usage.completion_tokens,
    estimated_cost_usd=compute_cost(response.usage, model="gpt-4o"),
)
```

### TypeScript example

```typescript
await guard.check("llm_call", {
  args: { prompt },
  inputTokens: response.usage.prompt_tokens,
  outputTokens: response.usage.completion_tokens,
  estimatedCostUsd: computeCost(response.usage, "gpt-4o"),
});
```

## Cost computation

Here is a simple cost estimation helper:

```python
COST_PER_1K = {
    "gpt-4o": {"input": 0.0025, "output": 0.01},
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "claude-3-5-sonnet": {"input": 0.003, "output": 0.015},
}

def compute_cost(usage, model: str) -> float:
    rates = COST_PER_1K.get(model, {"input": 0.01, "output": 0.03})
    return (
        usage.prompt_tokens / 1000 * rates["input"]
        + usage.completion_tokens / 1000 * rates["output"]
    )
```

## Budget events in the audit log

When the soft cap is reached:

```json
{"event_type": "budget_soft_cap_warning", "dimension": "cost_usd",
 "budget": {"cost_usd": {"current": 8.12, "soft": 8.00, "hard": 10.00}}}
```

When the hard cap is reached:

```json
{"event_type": "budget_exceeded", "dimension": "cost_usd",
 "budget": {"cost_usd": {"current": 10.03, "soft": 8.00, "hard": 10.00}}}
```

The `budget_exceeded` event is always followed by a `kill` decision on
the next check call for that run.

## Monitoring budget usage

The `budget` field is included on every `budget_update` event after each
`policy_decision`. You can track budget consumption by:

1. Querying the audit log for `budget_update` events
2. Using the web dashboard's run detail page (shows budget bars)
3. Setting soft caps to get early warnings

## What happens at termination

When a hard cap is exceeded:

1. Engine emits `budget_exceeded` event
2. Next `check()` call returns `kill` decision
3. Shim raises `RunTerminatedError`
4. Engine emits `run_ended` with `run_status: "terminated_budget"`
5. All subsequent `check()` calls for this run_id also return `kill`

The agent should catch `RunTerminatedError` and stop gracefully.

## Per-run vs per-session budgets

Budget tracking is **per run_id**. Each Guard instance has a fixed run_id.
If you create multiple Guard instances (e.g., one per conversation), each
has its own independent budget.

To enforce a global budget across runs, use the web dashboard's policy
management (Mode 2+) or an external monitoring system.
