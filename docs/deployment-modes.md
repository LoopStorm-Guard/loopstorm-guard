# LoopStorm Guard — Deployment Modes

<!-- SPDX-License-Identifier: MIT -->

This document describes the four deployment modes of LoopStorm Guard.
All designs must work in Mode 0 first. Network-dependent features are additive layers.

---

## Mode 0 — Pure OSS, Air-Gapped

**Status:** v1 (GA)
**Requires:** Nothing. No account, no network, no telemetry.

Engine binary + Python shim + JSONL file + replay CLI. Everything runs locally.
This is the primary distribution mechanism.

**What works:**
- Full policy enforcement (allow/deny/cooldown/kill/require_approval)
- Multi-dimensional budget caps (cost_usd, token_count, call_count)
- Loop detection (heuristics 1 + 2, heuristic 3 in v1.1)
- Tamper-evident JSONL hash-chain audit log
- Replay CLI: `loopstorm replay`, `loopstorm verify`, `loopstorm chain-check`
- All example policy packs

**What doesn't work:** Nothing — Mode 0 is complete and production-grade.

---

## Mode 1 — OSS Local + Self-Hosted Control Plane

**Status:** v2 (Enterprise)
**Requires:** Customer-managed infrastructure (Postgres, Hono API, Next.js UI)

All OSS components run on customer infrastructure. The full control plane is also
deployed within the customer's own infrastructure. No event data reaches LoopStorm's cloud.

The AI Supervisor in Mode 1 runs on the customer's infrastructure against a
customer-specified LLM provider. Cross-customer intelligence is not available.

---

## Mode 2 — OSS Local Engine + Hosted Control Plane

**Status:** v1 (Commercial Tier 1)
**Requires:** LoopStorm account

Engine binary and shim run on the customer's infrastructure. Events are forwarded
to the LoopStorm-hosted backend via the HTTP batch sink. The web UI provides run
timeline, hash chain verification, and (in v1.1) AI supervisor output.

The JSONL file remains the ground truth. The hosted backend is a secondary storage
and viewing layer. Cross-customer intelligence available if opted in.

---

## Mode 3 — Full Stack with AI Supervisor

**Status:** v1.1 (Commercial Tier 2)
**Requires:** LoopStorm account + Mode 3 plan

Mode 2 plus:
- AI Supervisor Agent active (observation plane only)
- Mobile approval app (Expo)
- Real-time approval queue (Supabase Realtime)
- Cross-customer intelligence (opt-in)
- Alert rules with email/webhook notifications
- OTEL event exporter

The AI Supervisor runs as a live agent on LoopStorm's hosted infrastructure,
watching customer agents continuously. It is itself guarded by the enforcement
core — its tool calls are audited, its budget is capped, its policy pack is readable.

---

## Enforcement/Observation Plane Separation

In all modes, the enforcement plane and observation plane are architecturally separated:

```
ENFORCEMENT PLANE (P99 < 5ms, deterministic):
  [Agent] → [Shim] → [Engine] → [Decision] → [JSONL]

OBSERVATION PLANE (async, seconds-to-minutes, AI-assisted, Mode 3 only):
  [JSONL / Event Store] → [Supervisor Tools] → [Supervisor Agent]
                                                      ↓
                                [Proposals · Escalations → Human Approval]
```

The supervisor has NO access to the enforcement plane. This separation is permanent
and inviolable across all modes.
