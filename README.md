# LoopStorm Guard

**Runtime enforcement layer and AI agent safety platform.**

LoopStorm Guard intercepts every AI agent tool call before execution, enforces policy rules, enforces budget caps (cost, tokens, call count), detects loops, and writes a tamper-evident JSONL hash-chain audit log.

[![CI](https://github.com/LoopStorm-Guard/loopstorm-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/LoopStorm-Guard/loopstorm-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE-MIT)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE-AGPL-3.0)

---

## What It Does

```
Your Agent → loopstorm.wrap() → [Policy Check] → [Budget Check] → [Loop Detection] → Tool Executes
                                      ↓
                              JSONL Audit Log (hash-chain verified)
```

**Five-stage control philosophy:**

| Stage | Type | Description |
|---|---|---|
| 1 — Prevent | Deterministic | Policy enforcement at the call interception boundary |
| 2 — Detect | Deterministic | Loop-detection heuristics within a run |
| 3 — Recover | Deterministic | Bounded recovery: cooldown + corrective context injection |
| 4 — Contain | Deterministic | Safe termination with evidence preservation |
| 5 — Adapt | AI-assisted | Supervisor agent: interpret · propose · escalate · learn |

Stages 1–4 are fully deterministic. The AI Supervisor (Stage 5) operates exclusively on the **observation plane** — it never touches the enforcement critical path.

---

## Quick Start (Mode 0 — No Account Required)

```bash
pip install loopstorm-py

# loopstorm.yaml
# agent_role: my-agent
# rules:
#   - name: deny-cloud-metadata
#     action: deny
#     tool_pattern: "http.get"
#     conditions:
#       - field: url
#         operator: matches
#         pattern: "169.254.169.254.*"
# budget:
#   cost_usd:
#     hard: 5.00

from loopstorm import guard

@guard(policy="loopstorm.yaml")
def my_agent():
    # Your agent code here
    pass
```

Everything runs locally. No account. No network. No telemetry.

---

## Architecture

See [`docs/adrs/`](docs/adrs/) for all 13 Architecture Decision Records.

**Key decisions:**
- [ADR-001](docs/adrs/ADR-001-ipc-wire-format.md) — IPC wire format (newline-delimited JSON over Unix domain socket)
- [ADR-002](docs/adrs/ADR-002-fail-closed-default.md) — Fail-closed default
- [ADR-012](docs/adrs/ADR-012-ai-supervisor-architecture.md) — AI Supervisor architecture
- [ADR-013](docs/adrs/ADR-013-open-core-licensing.md) — Open-core licensing

---

## Deployment Modes

| Mode | Description |
|---|---|
| **Mode 0** | Pure OSS, air-gapped, no account, no network |
| **Mode 1** | OSS local + self-hosted control plane (v2, enterprise) |
| **Mode 2** | OSS local engine + LoopStorm-hosted control plane (v1 commercial) |
| **Mode 3** | Mode 2 + AI Supervisor active, mobile approval, cross-customer intelligence |

See [`docs/deployment-modes.md`](docs/deployment-modes.md) for details.

---

## Repository Structure

```
apps/
  engine/          # Rust enforcement binary (MIT)
  cli/             # Rust CLI: replay, verify, chain-check (MIT)
  shim-python/     # Python shim: loopstorm-py (MIT)
  shim-ts/         # TypeScript shim: loopstorm-ts (MIT)
packages/
  schemas/         # Shared JSON schemas + TypeScript types (MIT)
  backend/         # Hono API + tRPC + Drizzle ORM (AGPL-3.0-only)
  web/             # Next.js 15 control plane UI (AGPL-3.0-only)
schemas/           # Canonical schema source-of-truth
docs/              # ADRs, specs, deployment docs
examples/          # Example policy packs
```

---

## Licensing

- **MIT**: `apps/`, `packages/schemas/` — free to use, fork, embed
- **AGPL-3.0-only**: `packages/backend/`, `packages/web/` — commercial hosting requires a license

See [ADR-013](docs/adrs/ADR-013-open-core-licensing.md) for the full open-core boundary rationale.

---

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability reporting policy.
See [`docs/owasp-agentic-mapping.md`](docs/owasp-agentic-mapping.md) for OWASP Agentic Top 10 coverage.
