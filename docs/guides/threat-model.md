<!-- SPDX-License-Identifier: MIT -->
# Trust Boundaries and Threat Model

This document describes LoopStorm Guard's trust boundaries, threat model,
and how the system defends against each threat category.

## Trust boundaries

```
┌─────────────────────────────────────────────────────┐
│  Untrusted Zone                                     │
│  ┌───────────────┐    ┌────────────────────┐        │
│  │  AI Agent      │    │  External Services │        │
│  │  (LLM output)  │    │  (APIs, DBs, etc.) │        │
│  └───────┬───────┘    └────────────────────┘        │
│          │ tool calls                               │
│  ════════╪══════════════════════════════════════    │
│          │ ENFORCEMENT BOUNDARY                     │
│  ┌───────▼───────┐                                  │
│  │  Language Shim │  (Python / TypeScript)           │
│  │  ► JCS hash    │                                  │
│  │  ► IPC send    │                                  │
│  └───────┬───────┘                                  │
│          │ UDS / Named Pipe (local only)             │
│  ┌───────▼──────────────┐                           │
│  │  loopstorm-engine    │  Trusted Zone              │
│  │  ► Policy evaluation │                           │
│  │  ► Budget tracking   │                           │
│  │  ► Loop detection    │                           │
│  │  ► Audit log writer  │                           │
│  └──────────────────────┘                           │
│                                                     │
│  ════════════════════════════════════════════════    │
│          OBSERVATION BOUNDARY                       │
│  ┌──────────────────────┐                           │
│  │  AI Supervisor       │  (reads events, proposes) │
│  │  ► Never enforces    │                           │
│  │  ► Human approves    │                           │
│  └──────────────────────┘                           │
└─────────────────────────────────────────────────────┘
```

### Boundary 1: Enforcement boundary

The shim sits between the AI agent and the engine. The agent's tool calls
pass through the shim, which forwards them to the engine for a decision.
The engine is the sole decision authority.

**Trust assumption**: The engine binary is trusted. The shim is trusted
to correctly forward requests. The agent (LLM output) is untrusted.

### Boundary 2: Observation boundary

The AI Supervisor reads audit events and proposes changes but **never**
touches the enforcement path (ADR-012). Proposals require human approval
before they affect enforcement.

**Trust assumption**: The supervisor can observe but cannot modify
enforcement behavior. Humans are the final authority.

## Threat categories and mitigations

### T1: Policy bypass

**Threat**: Agent finds a way to execute a tool call without going through
the shim.

**Mitigations**:
- The shim wraps tool call functions — the original function is not
  directly accessible when using `guard.wrap()`
- `failOpen: false` mode ensures no calls proceed without engine
  verification
- The hash chain audit log detects gaps in the sequence (missing calls
  would break the chain)

**Residual risk**: If the agent has access to the raw tool function
reference (not the wrapped version), it can bypass the shim. This is
an integration correctness concern, not a runtime attack.

### T2: SSRF / resource access

**Threat**: Agent instructs a tool call to access internal resources
(cloud metadata, localhost services).

**Mitigations**:
- Policy rules can match on `args.url` with glob patterns to block
  internal IP ranges
- See `tests/fixtures/policies/ssrf-block.yaml` for a reference policy
- Maps to OWASP Agentic #5 (Insecure Output Handling)

### T3: Budget exhaustion

**Threat**: Agent makes excessive API calls, consuming tokens/cost
beyond acceptable limits.

**Mitigations**:
- Multi-dimensional budget caps (cost, tokens, call count)
- Hard caps terminate the run with a `kill` decision
- Budget tracking is in the engine (Rust), not the shim — the agent
  cannot manipulate budget state

### T4: Infinite loops

**Threat**: Agent enters a loop making the same failing call repeatedly.

**Mitigations**:
- Heuristic 1: Identical call fingerprint detection (same tool + same
  args hash N times in a window)
- Heuristic 2: Identical error response detection
- First trigger: cooldown (pause + retry). Repeated trigger: kill.

### T5: Audit log tampering

**Threat**: Attacker modifies the audit log to hide malicious actions.

**Mitigations**:
- JSONL hash chain — each event includes SHA-256 of the previous event
- `loopstorm-cli verify` detects any chain break
- The audit writer is fail-closed: if it cannot write, the engine
  returns `kill` (ADR-005)
- Socket permissions are 0600 (owner-only)

### T6: Credential leakage

**Threat**: Sensitive values (API keys, passwords) appear in the audit log.

**Mitigations**:
- Automatic redaction of: API keys, bearer tokens, JWTs, AWS credentials
- Configurable additional patterns and key-based redaction
- `args_hash` is computed on pre-redaction args (so the hash is
  consistent) but `args_redacted` stores the post-redaction version

### T7: Escalation blocking

**Threat**: A policy rule blocks `escalate_to_human`, preventing agents
from requesting human help.

**Mitigations**:
- The engine rejects any policy that would deny `escalate_to_human`
  at load time (ADR-012, C13)
- The backend API enforces this invariant when creating/updating policies
- This is a hard invariant — there is no override

### T8: Cross-tenant data access

**Threat**: In the hosted tier (Mode 2+), one tenant accesses another
tenant's data.

**Mitigations**:
- PostgreSQL Row Level Security (RLS) on all tenant-scoped tables
- `tenant_id` is set via `SET LOCAL` in the tRPC middleware before
  any query runs
- Defense-in-depth: application-level tenant filtering + database-level
  RLS

**Residual risk**: RLS policies have not been adversarially tested yet.
This is a known gap scheduled for pre-v1 work.

### T9: Supervisor escape

**Threat**: The AI Supervisor modifies enforcement rules directly.

**Mitigations**:
- Enforcement and observation planes are architecturally separated
  (ADR-012)
- The supervisor has read-only access to events
- All supervisor proposals require human approval
- The supervisor runs in a separate engine instance

## OWASP Agentic Top 10 mapping

See `docs/owasp-agentic-mapping.md` for the complete mapping of
LoopStorm Guard controls to the OWASP Agentic Top 10 threats.

## Assumptions

1. The machine running the engine is not compromised
2. The UDS/named pipe is protected by filesystem permissions
3. The policy file is authored by a trusted human
4. The shim is correctly integrated (all tool calls go through `guard.wrap()` or `guard.check()`)
5. The audit log file is stored on a filesystem with appropriate access controls
