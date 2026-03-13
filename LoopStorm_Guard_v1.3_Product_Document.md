# LoopStorm Guard
## v1.2 Product Document

**Organization:** LoopStorm  
**Author:** Ricardo  
**Date:** March 2026  
**Version:** 1.2 — Precision Pass

---

## Table of Contents

1. Executive Summary
2. Why Now *(market thesis)*
3. The Problem
4. What LoopStorm Guard Does
   - 4.3 Control Philosophy
5. Ideal Customer Profile — Who It Is For
6. Who This Is Not For
7. Trust Boundaries and Threat Model
8. Core Guarantees — Scoped Correctly
9. Product Architecture
10. Tech Stack
11. Operational Guarantees and Failure Modes
12. Open Core vs Commercial Boundary
13. Flow of Work
14. Case Studies
15. Deployment Modes
16. v1 Scope, v1.1 Scope, v2 Direction
17. Pricing and GTM
18. What v1 Must Prove
19. Major Corrections Made from v1.0
20. Final Precision Changes Made (v1.1 → v1.2)
21. Market Alignment — Priority Actions (March 2026)
22. Major Corrections Made from v1.0 *(renumbered)*
23. Final Precision Changes Made (v1.1 → v1.2) *(renumbered)*

---

---

# 1. Executive Summary

AI agents running in production are executing tool calls, spending API credits, and taking real-world actions with no runtime enforcement layer. Teams discover problems in their billing dashboards, through customer complaints, or in compliance audits — not before the damage is done.

LoopStorm Guard is a runtime control layer that sits between an agent's code and the AI provider it uses. It intercepts calls, enforces policies, tracks budgets, detects loop behavior, and writes a structured event log with hash-chain integrity. It is designed to reduce the blast radius of agent failures, support after-the-fact investigation, and give engineering teams meaningful runtime control over agents they have deployed.

v1 is the smallest credible product: a Rust engine, a Python shim, a local JSONL event log, policy allow/deny enforcement, hard budget caps, two loop-detection heuristics, a replay and verification CLI, and a minimal hosted run timeline. It is not a full governance platform. It is the enforcement core that the rest of the product is built on.

The primary buyers are platform engineering, SRE, and AI infrastructure teams at software companies with at least one production agent executing real tool calls. The selling moment is a recent incident — an unexpected API bill, an unintended tool execution, or the first question from a security team about what the agent actually did.

---

---

# 2. Why Now

*The following reflects LoopStorm's market thesis — strategic beliefs about where the agent infrastructure market is heading. These are not claims supported by published market research. They should be validated and updated as customer evidence accumulates.*

**Thesis 1 — The shift from chatbots to agents is creating a new class of production risk.** Until recently, most teams running LLMs had chatbots — systems that respond to input and produce text. As of 2025, a meaningful number of software companies are operating agents that call tools, take actions, and run autonomously in loops. We believe the engineering discipline for governing this class of system has not kept pace, and that teams are discovering this gap through incidents rather than through deliberate tooling choices.

**Thesis 2 — Provider tooling is not designed for this problem.** OpenAI, Anthropic, and Google have invested in content safety — preventing harmful model outputs. Execution governance — preventing runaway behavior, enforcing environment boundaries, capping spend — requires the customer's deployment context. We believe this creates a structural gap that model providers are unlikely to fill from their side of the boundary.

**Thesis 3 — Compliance and security scrutiny of agent behavior is increasing.** We believe security teams at software companies with production agents are beginning to ask questions that engineering teams cannot answer without runtime instrumentation: what did the agent actually do, what are the limits on what it can spend or execute, and who reviewed a sensitive action before it ran. Whether and how quickly this becomes a formal compliance requirement is uncertain. The organizational pressure we believe exists now.

**Thesis 4 — The pattern-selection window is early.** Teams that are choosing how to govern agents in production today are likely making decisions that will hold for several years. The cost of replacing embedded runtime infrastructure is higher than the cost of adopting it. If this thesis is correct, the opportunity is to become the default before teams either build their own solutions or default to doing nothing.

---

---

# 3. The Problem

## 3.1 Four Failure Modes That Teams Have Actually Hit

**Runaway Cost**
An agent enters an unexpected state and retries the same LLM or tool call in a loop. There is no automated stop. The existing mechanism for catching this is a billing alert set by someone who thought to set it, or a developer refreshing their OpenAI dashboard. By the time the process is killed manually, the damage is done and the run has no useful output to recover from.

**Silent Policy Violations**
An agent designed for a sandboxed test environment makes a call against a production endpoint because nothing enforced the environment boundary at the tool call level. The call succeeds. Data is written, deleted, or leaked. The incident surfaces in an audit or a customer complaint, not in a system alert.

**Unauditable and Unverifiable Behavior**
A customer, auditor, or internal reviewer asks what the AI agent did. The engineering team's answer is reconstructed from log timestamps, system prompts, and memory of what the agent was supposed to do. Standard log files can be edited. There is no mechanism to verify that what is in the log corresponds to what actually happened.

**Uncontrolled Loop Behavior**
An agent receives an error and retries the identical call with identical arguments. It receives the same error. It retries again. This is not a bug in any one component — it is an emergent behavior that requires observing call history across an entire run to detect. No individual LLM call or tool call handler sees it. Nothing stops it.

## 3.2 Why Existing Tools Are Not Enough

**Observability platforms** (Langfuse, LangSmith, Datadog) record what happened after the fact. They are diagnostic, not preventive. They cannot block a call, enforce a budget, or detect a loop in real time. They also depend on the agent self-reporting its behavior — a malfunctioning agent may report its own failures inaccurately.

**LLM provider safety filters** address the content of model outputs. They do not govern execution behavior, API spending, tool call patterns, or environment isolation.

**Framework callbacks** (LangChain, OpenAI hooks) are per-developer implementations. No two are alike. There is no shared policy format, no shared budget enforcement model, and no shared event log schema. They are not maintained across agent versions.

**Custom wrappers** solve the immediate problem for one team on one day. They are not productized, not auditable, and not portable.

---

---

# 4. What LoopStorm Guard Does

LoopStorm Guard is a runtime control layer for AI agents. It intercepts calls an agent makes to an LLM or tool, evaluates those calls against a set of enforcement systems, and returns a decision before the call executes. The interception boundary is explicit and documented. Enforcement applies to calls that are routed through it.

## 4.1 The Four Enforcement Systems in v1

**Policy Enforcement — Allow and Deny**
A YAML policy pack defines which tools an agent is allowed to call, under what conditions, and in which environment. The evaluator is fail-closed: if the policy pack cannot be loaded or parsed, the run does not start. Rules are evaluated in priority order; the first match wins. v1 enforces allow and deny decisions. Require-approval decisions are a v1.1 capability.

**Budget Control — Hard Caps**
Every agent run operates under a budget configuration with hard caps across measurable dimensions: token consumption (input and output), estimated API cost, and number of tool calls. A hard cap terminates the run, cleanly, and captures whatever safe partial output exists at the moment of termination. Soft caps — warning-only events that allow the run to continue — are included in v1 for operational visibility.

**Loop Detection — Two Heuristics in v1**
Two deterministic heuristics run continuously within a run. The first detects repeated identical tool calls with the same argument fingerprint within a rolling time window. The second detects repeated identical error responses without any intervening success. When either fires, the guard applies a recovery sequence: a cooldown pause first, then run termination on the next trigger. A third heuristic — agent state stagnation — is v1.1.

**Structured Event Log with Hash-Chain Integrity**
Every intercepted call and its decision outcome is written to an append-only JSONL event log. Each event includes a SHA-256 hash of its own payload and a link to the previous event's hash. This hash chain supports detection of accidental file corruption and unsophisticated post-hoc modifications. The specific limitations of this integrity model are documented in Section 8.

## 4.2 What v1 Does Not Do

v1 does not include: human-in-the-loop approval workflows (v1.1), LangChain or TypeScript adapters (v1.1), model degradation on budget soft cap (v1.1), cross-run budget accumulation (v2), a hosted multi-tenant dashboard (v1.1 hosted tier), mobile approval UX (v1.1), or enterprise self-hosting packaging (v2).

These are not missing features. They are deliberate scope decisions. v1 is the enforcement core. Everything else is built on top of it after the core is validated.

## 4.3 Control Philosophy

The conceptual model behind LoopStorm Guard has four stages, applied in sequence for every guarded run. Understanding this model helps explain why the product is designed the way it is, and what makes it different from a logging or observability tool.

**Stage 1 — Prevent obvious bad actions.** Before any call executes, the policy evaluator checks it against explicit rules. Calls that violate defined boundaries are blocked immediately. This is deterministic, cheap, and binary — the policy either matches or it does not. No probabilistic scoring, no LLM involvement, no ambiguity.

**Stage 2 — Detect non-progress.** Once a call has been permitted, the loop detector monitors the run's call history. If the agent is repeating itself without making forward progress — same tool, same arguments, same errors — that is not a question of policy. It is a question of whether the agent is doing useful work. The heuristics answer that question deterministically, based on observable call patterns.

**Stage 3 — Attempt bounded recovery.** When non-progress is detected, the guard does not immediately terminate. It intervenes first. A cooldown pause is applied, and a corrective signal is injected into the agent's context. The agent gets a chance to self-correct. This is not optimistic — if the intervention does not change the behavior, the next trigger escalates.

**Stage 4 — Terminate safely when progress cannot be re-established.** If recovery attempts fail, the run is terminated cleanly. Whatever the agent has produced up to that point is preserved as safe partial output, subject to the adapter's checkpointing capability (see Section 8.2). Evidence is always preserved regardless of whether recoverable business output is available.

The product is not trying to make agents smarter or correct their reasoning. It is trying to bound the damage when they fail, preserve evidence of what happened, and give the team the information they need to understand and fix the failure afterward. This is a control-systems problem, not an AI problem.

---

---

# 5. Ideal Customer Profile — Who It Is For

## 5.1 The v1 Wedge — Bullseye Profile

The sharpest initial target is a **platform engineering, infrastructure, or AI engineering team** at a software company that has shipped at least one production agent executing real tool calls — external API calls, code execution, database writes, or other actions with real cost or consequence. The team is Python-first. They have experienced, or have a well-founded fear of, at least one of: unexpected API spend from a runaway run, an agent executing a call it should not have been allowed to make, or an inability to answer a basic post-incident question about what the agent did.

A secondary entry point within the same wedge is a **technical CTO or Head of Engineering at an AI-native software company** in the 10–150 person range. These buyers are often building the agent infrastructure themselves and have direct technical opinions about what a runtime control layer should look like. They qualify fast and they influence the broader market if they adopt.

The buying signal is not general interest in AI governance. It is a specific incident or a specific operational fear that has already materialized. Teams evaluating LoopStorm because they "should probably have something like this" are a longer, harder sell than teams who were on-call when the runaway agent bill arrived.

## 5.2 Qualification Table

| Dimension | v1 Wedge (Primary Target) | Addressable Market | Weak Fit |
|---|---|---|---|
| Agent maturity | Production, executing tool calls with real cost or consequence | Pre-production but actively building toward it | Demos, chatbots, text-only |
| Team type | Platform / infra / AI engineering, or technical CTO | VP Eng, Staff Eng with platform authority | Individual developer, research team |
| Prior incidents | At least one concrete incident or imminent credible fear | Aware of the risk category | No awareness, no incidents |
| Tool use | External APIs, code execution, databases, file systems | Internal tool calls only | No tool calls |
| Python stack | Python-first or Python-compatible | Mixed (TypeScript support is v1.1) | Go / Java only (not yet) |
| Company size | 10–150 employees (wedge) | 150–500 employees | Solo founders, large enterprises with existing solutions |
| Industry | Fintech, healthtech, legal tech, AI-native SaaS | Enterprise SaaS, any industry with agent deployments | Consumer apps, pure research |
| Urgency | Prior incident in last 90 days, or active compliance question | Upcoming audit or board-level AI review | General market interest |

The "addressable market" column represents expansion after the wedge is proven. v1 GTM should stay focused on the primary target column. Selling to the middle column before the wedge is validated adds noise to product feedback and extends sales cycles unnecessarily.

## 5.3 Decision Makers and Champions

The check signer is typically a VP Engineering, Head of AI Platform, or technical CTO. The internal champion is typically the engineer who was on-call during the runaway agent incident, or the person who has been tasked with answering the security team's question about agent behavior. The champion has personal motivation — they experienced the problem. The check signer needs business justification. Both need to be present in a pilot for it to move.

---

---

# 6. Who This Is Not For

Being clear about this prevents wasted sales cycles and misconfigured pilots.

**Hobby and side-project agents.** If the agent is not in production and is not executing tool calls that have real consequences, LoopStorm Guard does not solve a real problem for this user yet. The cost of setup and configuration is not justified.

**Demo and prototype chatbots.** A chatbot that responds to user input and returns text — even if it is powered by GPT-4 — is not an agent in the operational sense LoopStorm addresses. There are no tool calls to enforce policy on, no run budget to track, and no loop behavior to detect.

**Teams that only want passive observability.** LoopStorm Guard is an enforcement layer, not a logging service. Teams that want to see what their agents did, without any interception or enforcement, will find that LoopStorm is more than they want and will resist the integration overhead. Passive observability is not the product.

**Teams without Python agents in v1.** v1 ships a Python shim only. Teams running agents exclusively in Node.js, Go, Java, or other runtimes are not yet supported. This is a known limitation, not a future gap — TypeScript shim support is v1.1 and Go is v2 direction.

**Teams seeking a compliance certification out of the box.** LoopStorm Guard supports audit evidence collection and improves an organization's control posture around agent behavior. It does not certify compliance with any regulatory framework on its own, and it does not make that claim.

---

---

# 7. Trust Boundaries and Threat Model

This section defines what LoopStorm Guard assumes, what it protects against, and where its guarantees end. Operating within false assumptions produces a false sense of security. This section exists to prevent that.

## 7.1 What Is Trusted

| Component | Trust Assumption |
|---|---|
| Host operating system | Trusted — LoopStorm assumes the host has not been compromised by an adversary with root access |
| Rust engine process | Trusted — assumes the engine binary has not been replaced and is running correctly |
| Python shim | Trusted — assumes the shim code has not been modified by the agent or a dependency |
| JSONL file path | Trusted — assumes the log file location has not been redirected or replaced by a host-level attacker |
| Local socket (UDS) | Trusted — Unix socket at mode 0600, same user, same host; OS-level isolation only |
| Policy pack YAML at load time | Trusted — assumes the policy file was loaded from an expected location without tampering |

## 7.2 What Is Not Trusted

| Threat | LoopStorm's Position |
|---|---|
| Agent code that calls the AI provider directly, bypassing the shim | Not protected. Enforcement only applies to calls routed through the LoopStorm integration boundary. |
| Agent code or dependencies that modify the shim's behavior at runtime | Not protected. LoopStorm does not defend against a Python-level attack inside the agent's process. |
| A compromised host (root access, process injection) | Not protected. Host-level compromise is outside LoopStorm's threat scope. |
| A developer who removes the shim integration from the agent | Not protected. The shim is installed by human decision. Its removal is also a human decision. |
| Developer misconfiguration (missing policy pack, empty budget config) | Partially protected. Fail-closed on load failure. Silent misconfiguration (policy with no rules) is the developer's responsibility to validate. |
| A backend that is offline or unreachable | Addressed in operational guarantees. Local JSONL is always written; backend sync is best-effort. |
| Network-level interception of the HTTP sink | Mitigated by TLS; backend authentication requires a valid API key. |
| JSONL file modification by a host user with write access to the log path | Detectable only as-written by the hash chain. Sophisticated attackers with write access can recompute the chain (see Section 8). |

## 7.3 Failure Scenarios — Defined Behaviors

| Scenario | What LoopStorm Does |
|---|---|
| Engine process dies mid-run | Shim detects socket failure. Default: fail-open — agent continues unguarded, warning logged. Optional: fail-closed — agent raises EngineUnavailableError and terminates. |
| Engine takes longer than IPC timeout | Default: fail-open, synthetic proceed returned. Configurable timeout. Configurable to fail-closed. |
| Host is fully compromised | LoopStorm provides no protection. This is outside the product's trust boundary. |
| Backend is offline at event flush time | Events buffer locally in the JSONL file. On backend reconnect, the JSONL can be imported manually via the import API. No events are lost that were written to the local file. |
| Backend is offline at run start | Local-only mode activates silently. Events are written to JSONL only. |
| Events arrive out of order at the backend | Backend validates and rejects events where the seq value already exists (idempotent insert). Ordering is enforced by seq, not by arrival time. |
| Duplicate event batch sent to backend | Handled idempotently by the unique constraint on (run_id, seq). Second insert is a no-op. |
| Policy pack cannot be parsed | Engine refuses to start the run. Run does not proceed. Error is returned to the shim. |
| Agent routes around the shim | Enforcement does not apply to those calls. LoopStorm's guarantee is scoped to the integration boundary. |
| Approval service is unavailable | In v1, approvals are a v1.1 feature. In v1.1: timeout elapses → automatic deny. Shim raises PolicyDeniedError. |

## 7.4 What LoopStorm Claims and Does Not Claim

LoopStorm Guard claims to enforce policy, budget, and loop-detection decisions **for calls that are routed through the integration boundary, on a host that has not been compromised, with an engine process that is healthy**.

LoopStorm Guard does not claim to be a security perimeter. It is a control layer for cooperative systems — systems where the developer has intentionally integrated enforcement and is not actively trying to bypass it.

This framing is accurate and sufficient for the v1 use case: teams who want runtime control over agents they own and operate, not adversarial enforcement against agents trying to escape supervision.

---

---

# 8. Core Guarantees — Scoped Correctly

## 8.1 Policy Enforcement

**What is guaranteed:** Every call intercepted by the shim is evaluated against the active policy pack before it executes. The evaluator is fail-closed — a parse failure, schema violation, or missing policy file prevents the run from starting. The first matching rule wins; no fallthrough ambiguity.

**Scope:** Applies to calls routed through the LoopStorm shim. Does not apply to direct API calls made by the agent outside the shim. Does not prevent a developer from removing the shim.

## 8.2 Budget Control

**What is guaranteed:** Token counts, estimated cost, and tool call counts are tracked per run. When a hard cap is breached, the engine returns a kill decision before the next call executes. The run is terminated cleanly by the shim. Safe partial output is captured at the moment of termination where the adapter supports it. This terminates the run in the shim; it does not interact with the AI provider's billing system.

**Safe partial output — definition and scope:**
Safe partial output refers to whatever structured results, artifacts, or intermediate state the agent's adapter has accumulated and checkpointed up to the point of termination. It is not a generic "save everything" mechanism. Its availability depends on how the adapter is implemented and what the agent has produced.

Specifically:

- *When it is available:* If the adapter maintains an explicit results buffer — for example, a document review agent that accumulates per-document summaries as each completes — the guard can capture that buffer at termination time and surface it as recoverable output. Any work the agent completed before the cap was hit is preserved.

- *When it is not available:* If the agent's output is a single artifact produced at the end of the run (a compiled report, a final answer, a single API write), and that artifact has not been checkpointed mid-run, termination means no business output is recoverable. The guard terminates cleanly, but there is nothing to return.

- *What is always available regardless of adapter:* The event log up to the termination point. This preserves the full evidence record of what the agent attempted — every intercepted call, every decision, every cost increment — even when no recoverable business output exists. Evidence preservation is unconditional. Business output preservation is adapter-dependent.

- *What is required from the adapter:* Adapters that want to support safe partial output must implement a checkpoint or buffer interface. The v1 OpenAI adapter supports basic buffered output capture. Custom tool wrappers must explicitly register results with the guard to participate in partial output collection. This is documented in the adapter integration guide.

**Scope:** Cost tracking is based on model pricing tables embedded in the engine — it is an estimate, not a verified billing figure. The AI provider's actual billed cost may differ due to pricing changes, tokens counted differently by the provider, or calls made outside the shim.

## 8.3 Loop Detection

**What is guaranteed:** Two heuristics run within every guarded run. When either fires, the recovery sequence executes. The first trigger produces a cooldown. The second trigger for the same rule terminates the run. The heuristics are deterministic — same inputs produce same decisions.

**Scope:** Heuristics run within a single run session. Cross-run loop behavior (the same agent running repeatedly and looping across runs) is a v2 capability. Heuristics detect patterns in the calls the guard sees; an agent looping in internal logic without visible tool calls is not detected.

## 8.4 Structured Event Log and Hash-Chain Integrity

This is the most important guarantee to state precisely.

**What the hash chain provides:**
Every event in the JSONL log carries a SHA-256 hash of its own payload and a link to the previous event's hash. This chain structure means that any modification to any event — if the chain is verified afterward — produces a detectable inconsistency. The replay CLI detects this inconsistency and reports the sequence number where the break occurred.

This is useful for:

- Detecting accidental file corruption (bit rot, truncation, partial writes)
- Detecting unsophisticated post-hoc modifications where an individual event is changed but the chain is not recomputed
- Establishing that a log file has not been casually edited

**What the hash chain does not provide:**
A hash chain alone, stored in a file on a host where the writer also has write access, does not constitute strong tamper-evidence against a motivated adversary with access to that host. An attacker who can modify the JSONL file can also recompute the chain. A modified file with a recomputed chain is indistinguishable from the original when verified by the replay CLI alone.

**What strong tamper-evidence requires:**
To make the audit log resistant to recomputation attacks, an external trust anchor is required. Options include: a signed root hash published to an immutable external ledger; periodic cryptographic checkpoints signed by a KMS or HSM key controlled by LoopStorm; an append-only remote witness that receives hash proofs in real time; or event forwarding to an immutable backend where the engine is not the only writer and write access is access-controlled independently.

**v1 position and hosted backend:** The hash chain in v1 provides integrity detection against accidental corruption and unsophisticated modification. It does not provide forensic-grade tamper-evidence against an adversary with host access.

The hosted backend improves the evidentiary integrity posture relative to local-only JSONL in several meaningful ways: the events database is append-only at the permission level (the ingest account has INSERT only, no UPDATE or DELETE), the backend receives and independently validates the chain as a second pass separate from the engine, and the control plane's access controls are separate from the host running the agent. These differences matter — they remove the "engine is the only writer" weakness of the local-only model.

However, the hosted backend alone is not sufficient for forensic-grade claims in a contested proceeding or formal regulatory audit. Strong evidentiary integrity additionally requires: external cryptographic signing of the log (via KMS or HSM), database-level audit logging of all access to event records, immutable storage or external anchoring of chain proofs, and rigorous operational security of the control plane itself — including access reviews, incident response procedures, and change management. These are conditions that depend partly on how LoopStorm operates the control plane and partly on what external anchoring mechanisms are in use. LoopStorm does not certify that the hosted backend meets any specific forensic or regulatory evidentiary standard.

The forthcoming signed checkpoint anchoring feature (commercial, v1.1) is a concrete step toward a stronger foundation for evidentiary claims. Even with it, the full picture of what satisfies a specific audit or legal standard is context-dependent and requires review by qualified legal or compliance advisors.

Signed checkpoint anchoring is not in v1.

## 8.5 Secret and PII Redaction

**What is guaranteed:** The redaction engine runs before any event payload is written to the JSONL file or transmitted to the backend. Sensitive fields identified by key name and by configurable pattern are replaced with typed markers. The hash of the original arguments is computed before redaction and stored separately.

**Scope:** Redaction accuracy depends on the patterns configured. Default patterns cover common API key formats, bearer tokens, JWTs, and AWS credential formats. Novel secret formats not matching any configured pattern will not be redacted. Teams with non-standard secret formats must configure additional patterns. LoopStorm does not guarantee zero leakage for unknown patterns — it guarantees that the default pattern set covers common cases and that the framework for adding patterns exists.

## 8.6 Enforcement Boundary — The Correct Statement

LoopStorm Guard enforces its controls on calls that pass through the integration boundary. The enforcement assumption is that: the host is not compromised, the engine process is healthy, and the developer has routed agent calls through the shim. Within those assumptions, enforcement is reliable. Outside those assumptions, no enforcement claim applies.

The correct framing is not "the guard cannot be bypassed." The correct framing is: **the guard enforces the controls it is responsible for, within the trust boundary it operates in, for the calls it intercepts.**

---

---

# 9. Product Architecture

## 9.1 The Three Surfaces

LoopStorm Guard is organized as three surfaces that can be adopted incrementally. v1 delivers Surfaces 1 and 2 in full. Surface 3 in v1 is minimal — a hosted run timeline, not a full control plane.

```
┌──────────────────────────────────────────────────────────────────┐
│  SURFACE 1 — THE GUARD (runs on customer infrastructure)         │
│                                                                  │
│  Python Agent  →  Python Shim  →  Rust Engine                   │
│                                   ├── Redactor                   │
│                                   ├── Policy Evaluator           │
│                                   ├── Budget Engine              │
│                                   ├── Loop Detector              │
│                                   ├── Hash Chain Builder         │
│                                   └── Event Emitter              │
│                                        ├── JSONL (always local)  │
│                                        └── HTTP Batch (→ cloud)  │
└──────────────────────────────────────────────────────────────────┘
                          │ HTTPS (async, batched, best-effort)
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  SURFACE 2 — THE REPLAY AND VERIFICATION CLI (local binary)      │
│                                                                  │
│  loopstorm-replay <file>                                         │
│  → Verifies hash chain, filters by event type, exits 0/1        │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  SURFACE 3 — HOSTED CONTROL PLANE (v1: minimal run timeline)     │
│                                                                  │
│  Hono API  →  Supabase (PostgreSQL + Auth + Realtime + Storage)  │
│  Next.js Web UI  →  Run list, Run timeline, Chain badge          │
│  (v1.1: Approvals, Policy distribution, Multi-tenant dashboard)  │
│  (v1.1: Mobile approval app with push notifications)             │
└──────────────────────────────────────────────────────────────────┘
```

## 9.2 The Rust Engine

The engine is the only component that contains business logic. It runs as a co-process alongside the Python agent on the same host, communicating via a Unix Domain Socket at file permission 0600. This provides operating-system-level isolation between the agent's process and the enforcement logic.

Three properties of this design matter:

**Security posture on secret handling.** The engine handles raw tool arguments before redaction. Running as a separate Rust process means the redaction path is not subject to Python's memory model or the agent's dependency tree. Memory safety is guaranteed at the language level in safe Rust.

**ReDoS immunity.** The redaction engine uses a regex library with linear-time matching guarantees (Thompson NFA). Regardless of what patterns are configured in the policy pack, pattern matching cannot be forced into exponential-time behavior by crafted inputs.

**Distribution.** The engine compiles to a single static binary with no runtime dependencies. It installs via the Python package's post-install script. It runs on Linux and macOS at launch; Windows support follows. The shim manages the subprocess lifecycle.

## 9.3 The Python Shim

The shim is intentionally thin — approximately 300 lines, standard library only. It intercepts calls, serializes decision requests, sends them to the engine via the local socket, receives decisions, and applies them. It contains no business logic.

This thinness is a design property, not a constraint. If the shim were removed or rewritten, the engine's behavior would be unchanged. The shim is a transport layer. The engine is the product.

Production integration is not "three lines of code." It requires: installing and configuring the engine binary, authoring a policy pack, setting a budget configuration, deciding on fail-open vs fail-closed behavior, validating that routing assumptions are correct, and making a deployment decision about local-only vs hosted mode. This is a production setup task, not a one-liner.

## 9.4 The Control Plane

The v1 hosted control plane provides event ingest, run storage, and a read-only timeline UI. Its data model is append-only at the permission level — the ingest service account has INSERT permission on the events table and no UPDATE or DELETE. This means the hosted backend provides a secondary integrity path that is independent of the local JSONL file.

**Supabase** provides the infrastructure: PostgreSQL for event storage, Row Level Security for database-level tenant isolation, Auth for human session management with custom tenant claims, Realtime for live updates in v1.1, and Storage for policy pack files and JSONL exports.

**Drizzle ORM** handles the high-throughput ingest path via a direct PostgreSQL connection pool, bypassing the HTTP overhead of Supabase's PostgREST layer.

**tRPC** provides end-to-end TypeScript types across the web UI and future mobile surfaces — the same typed router definition is the API contract, with no OpenAPI spec to maintain.

## 9.5 Data Boundaries

| Data | Storage Location | Access Control |
|---|---|---|
| Raw tool arguments (pre-redaction) | Nowhere — discarded immediately | N/A |
| Redacted event payloads | Local JSONL + PostgreSQL (if backend configured) | RLS: owner tenant only |
| args_hash (pre-redaction fingerprint) | Local JSONL + PostgreSQL | RLS: owner tenant only |
| Hash chain values | Local JSONL + PostgreSQL | RLS: owner tenant only |
| Policy pack YAML files | Supabase Storage, private bucket | Signed URL, owner tenant |
| JSONL export files | Supabase Storage, private bucket | Signed URL, owner tenant |
| API keys | PostgreSQL — SHA-256 hash only, raw key never stored | Indirectly via auth middleware |
| User sessions | Supabase Auth | Supabase managed |

---

---

# 10. Tech Stack

## 10.1 Stack Summary

| Layer | Technology | Role |
|---|---|---|
| Guard engine | Rust + Tokio | All enforcement logic — runs as co-process |
| Python integration | Python shim (stdlib only) | Intercept, transport, apply decisions |
| Monorepo tooling | Turborepo + Bun workspaces | Build caching, shared packages |
| API server | Hono on Bun | Event ingest, query, auth |
| API contract | tRPC | End-to-end TypeScript types |
| Web UI (v1) | Next.js 15 App Router | Run list, run timeline, chain badge |
| Mobile (v1.1) | Expo SDK 52 + Expo Router | Approval workflow, push notifications |
| Desktop (v1.1) | Tauri 2 | Local JSONL viewer, offline mode |
| Shared UI | NativeWind + shadcn/ui | One component set for web and mobile |
| Database | Supabase PostgreSQL | Append-only events, RLS tenant isolation |
| ORM — ingest path | Drizzle ORM | Direct pg pool, bypasses PostgREST |
| Tenant security | Supabase Row Level Security | Database-level isolation |
| Auth | Supabase Auth | Email, Google OAuth, JWT with tenant claim |
| Realtime (v1.1) | Supabase Realtime | Live approval queue updates |
| File storage | Supabase Storage | Policy YAMLs, JSONL exports, private buckets |
| Push notifications (v1.1) | Supabase Edge Functions + Expo | Approval notification pipeline |
| Lint and format | Biome | Replaces ESLint + Prettier |

## 10.2 Key Decisions and Their Rationale

**Rust for the engine, not Go or Python.** The choice is not primarily about performance. It is about memory safety on the secret-handling path, linear-time regex guarantees, and static binary distribution. All three are architectural requirements, not preferences.

**Supabase instead of separate managed services.** Assembling auth, database, realtime, and file storage from separate providers creates four integration boundaries that each must be secured and maintained independently. Supabase collapses them into one platform with one consistent security model (JWT + RLS). The practical consequence is approximately 400–600 lines of auth, session management, and realtime subscription code that does not need to be written.

**tRPC instead of REST + OpenAPI.** The web UI and future mobile app share a typed API client derived directly from the backend router definition. A backend type change is reported at compile time to every client. There is no spec to maintain and no codegen step.

**Hono on Bun for the API.** Hono is framework-agnostic — the same application code runs on Node.js today and on Cloudflare Workers post-v1 with a one-line runner change. Bun's built-in SQLite support is relevant for the local-mode path.

---

---

# 11. Operational Guarantees and Failure Modes

## 11.1 Event Durability Model

Events are written to the local JSONL file synchronously before the engine returns a decision to the shim. The JSONL file is the ground truth. If the backend is offline, unreachable, or returns an error, events already written to the local file are not lost.

HTTP batch forwarding to the backend is asynchronous and best-effort. The engine queues events in memory for forwarding. If the engine process dies before the batch is flushed, queued events that have been written to the JSONL file can be imported to the backend later via the JSONL import API. Events that were queued in memory but not yet written to the JSONL file are lost. This window is bounded by the flush interval (default: every 100 events or 5 seconds, whichever comes first).

## 11.2 Crash Recovery

If the engine process crashes mid-run:

- Events already written to the JSONL file are intact and verifiable
- The run record in the backend, if partially sent, will show status `running` indefinitely until manually updated or until a run timeout is applied
- The shim detects the socket failure on the next call and either fails open or raises EngineUnavailableError depending on configuration
- There is no automatic recovery — the agent must be restarted to establish a new engine connection

Run timeouts at the backend (a job that marks runs older than N hours as `abandoned`) are a v1.1 operational feature.

## 11.3 Ordering Guarantees

Events within a single run are ordered by `seq` — an integer incremented by the engine for each event in that run. Seq is the canonical ordering field, not insertion timestamp and not wall-clock time. The backend enforces a unique constraint on (run_id, seq). Events arriving out of order by network jitter are stored correctly by seq value. Events with duplicate seq values are silently dropped (idempotent insert).

## 11.4 Idempotency

The ingest endpoint is idempotent on (run_id, seq). Retransmitting the same event batch is safe. The backend accepts the first copy and ignores subsequent duplicates. This allows the engine's HTTP sink to retry on transient network failures without creating duplicate events.

## 11.5 Backend Outage Behavior

| Condition | Engine Behavior | Data Loss Risk |
|---|---|---|
| Backend unreachable at run start | Local-only mode, JSONL written | None — JSONL is ground truth |
| Backend goes offline mid-run | JSONL continues; HTTP batch queued | Loss of queued batches not yet flushed if engine crashes |
| Backend returns 5xx on batch | Engine retries with exponential backoff (v1: up to 3 retries) | Possible loss after retries exhausted |
| Backend comes back online | JSONL import API can reconcile local files | Manual step in v1; automatic reconciliation is v1.1 |

## 11.6 Latency Budget

The IPC round-trip from shim to engine and back adds latency to every guarded call. On the same host, this round-trip is targeted at under 2ms at P99. The engine's enforcement logic — redaction, policy evaluation, budget check, loop check, chain advance — is designed to execute in under 1ms for the common case (no regex-intensive patterns, policy pack with fewer than 50 rules).

Total expected overhead per guarded call: under 5ms at P99 on a healthy host under normal load. This is the design target. It will be benchmarked in PR8 and documented in the release notes.

## 11.7 Storage Growth

Each event in the JSONL log is approximately 500 bytes to 2KB depending on payload size after redaction. A run with 100 events produces approximately 50–200KB of JSONL. At 1,000 runs per day, local storage growth is approximately 50–200MB per day before any rotation or archival. Storage rotation — keeping the last N days of local JSONL — is a v1.1 operational feature. Teams running at high volume in v1 should plan for local storage growth and use the JSONL import API to move files to the hosted backend.

## 11.8 Fail-Open vs Fail-Closed

The default behavior when the engine is unavailable or times out is fail-open — the agent continues without enforcement, and a warning is logged. This is the correct default for production agents where enforcement failure should not cause a complete service outage.

Teams where an unguarded agent is more dangerous than a stopped agent should configure fail-closed. In fail-closed mode, an engine timeout or crash raises `EngineUnavailableError` and terminates the run. This is appropriate for agents executing financial transactions, privileged system operations, or other high-consequence tool calls.

The fail-open vs fail-closed choice must be made explicitly per deployment. There is no universally correct answer.

---

---

# 12. Open Core vs Commercial Boundary

## 12.1 Open-Source Core (MIT License)

The following components are open-source and will remain so. They represent the enforcement core that gives LoopStorm Guard credibility — customers can audit them, fork them, and run them without any commercial relationship.

| Component | What It Provides |
|---|---|
| Rust engine binary | All enforcement logic: redaction, policy eval, budget, loop detection, hash chain |
| Python shim | Integration layer for Python agents |
| JSON schemas | Language-neutral event and policy contracts |
| JSONL event log format | Documented, stable, importable |
| Replay and verification CLI | Local chain verification, event filtering, export |
| Local policy evaluation (allow/deny) | YAML-based policy enforcement, fail-closed |
| Local budget enforcement | Hard caps, safe partial output |
| Two loop-detection heuristics | Deterministic, configurable |

The open-source core is genuinely useful on its own. A team can run LoopStorm Guard in local-only mode with no LoopStorm account, no hosted backend, and no commercial relationship. This is intentional. The OSS layer drives adoption; the commercial layer converts teams who want team-scale features.

## 12.2 Commercial Hosted Tier

The following capabilities require the hosted control plane and are commercial.

| Capability | Why It Is Commercial |
|---|---|
| Hosted run timeline and dashboard | Infrastructure and multi-tenant engineering |
| Multi-tenant API key management | Requires hosted auth and account management |
| Hosted policy pack distribution | Policy versioning, team distribution, audit trail |
| Human-in-the-loop approval workflow | Requires hosted backend, realtime infrastructure |
| Mobile approval app | Requires hosted backend and push notification pipeline |
| Signed checkpoint anchoring | Requires KMS infrastructure for strong tamper evidence |
| Cross-run budget and analytics | Requires persistent cross-run state |
| Alert rules and notifications | Requires hosted event processing |
| Team management and RBAC | Multi-user account features |
| SLA-backed uptime | Commercial operational commitment |

## 12.3 Self-Hostable Commercial Tier (v2)

Organizations with data residency requirements or contractual restrictions on SaaS data flows will be able to self-host the full control plane. The architecture supports this — Supabase has a self-hosted distribution, Hono runs on any Node.js-compatible environment, and Next.js builds to a standalone Docker image. The v2 self-hosted tier requires packaging, deployment documentation, and support commitments that are out of v1 scope.

## 12.4 Open Core Moat

The commercial moat is not the open-source enforcement core — that is intentionally commoditizable. The moat is: hosted multi-tenant infrastructure, policy distribution and versioning at team scale, the approval workflow and mobile UX, signed checkpoint anchoring for forensic-grade audit integrity, and the operational experience of running this for many teams. These cannot be easily replicated by a team running the OSS layer internally.

---

---

# 13. Flow of Work

## 13.1 Production Integration — What It Actually Involves

Integrating LoopStorm Guard in a production agent is a deployment decision, not a code edit. The actual steps are:

**Step 1 — Install.** The Python shim is installed via pip. The post-install script downloads the engine binary for the host platform.

**Step 2 — Author policy pack.** The team writes a YAML policy pack defining which tools the agent is allowed to call, in which environment, under what conditions. This requires understanding the agent's tool surface. For a well-documented agent, this takes a few hours. For an undocumented one, it requires tooling inventory first.

**Step 3 — Set budget configuration.** Hard caps for token consumption, estimated cost, and tool calls are configured per run. These require a judgment call about acceptable spend per run. Setting them too tight causes false positives on healthy runs; too loose and they miss real failures.

**Step 4 — Decide fail behavior.** Fail-open or fail-closed is configured explicitly. This is an operational decision, not a default to accept without consideration.

**Step 5 — Integrate the shim.** The existing AI client is wrapped by the LoopStorm shim. Tool calls that should be guarded are routed through the tool wrapper. Calls that bypass the shim are not enforced.

**Step 6 — Validate routing.** The team verifies that the agent's call paths are actually being intercepted. This is done by running the agent in a test environment and checking that events appear in the JSONL file. Calls that do not produce events are not being routed through the guard.

**Step 7 — Deploy and monitor.** The agent runs in production with the guard active. The JSONL file is inspected after incidents. If the hosted backend is configured, the team can view the run timeline in the web UI.

## 13.2 Per-Call Interception Sequence

When the agent makes a tool call, the shim intercepts it and sends a DecisionRequest to the engine via the local socket. The engine runs five steps in sequence: redaction, policy evaluation, budget check, loop check, and hash chain advance. The event is written to JSONL. The engine returns a DecisionResponse. The shim applies the decision.

If the decision is proceed: the tool executes with the original unredacted arguments.  
If the decision is deny: a PolicyDeniedError is raised. The tool does not execute.  
If the decision is kill: a TerminateRunError is raised. The run ends cleanly with safe partial output.

## 13.3 Hash Chain Verification

A reviewer who wants to verify that a JSONL file has not been modified runs the replay CLI against it. The CLI reads every event in sequence order, computes the SHA-256 of each event's payload, compares it to the stored payload_hash, and verifies that each event's hash_prev matches the previous event's payload_hash.

If every event passes: the output is CHAIN VALID. The file has not been casually modified.  
If any event fails: the output is CHAIN BROKEN at seq N. The file has been modified at or after that position — or has been corrupted.

This verification is meaningful for detecting accidental corruption and unsophisticated modification. It is not a substitute for a forensic-grade external trust anchor when that level of evidence is required. See Section 8.4 for the complete scope of this guarantee.

---

---

# 14. Case Studies

The following four scenarios represent the core value demonstrations of v1. They are the four mandatory end-to-end test scenarios that must pass before v1 ships.

---

## Case Study 1 — SSRF Tool Call Blocked by Policy

**Scenario.** A fintech company's AI agent can fetch URLs to retrieve financial data. A malicious input contains the AWS instance metadata endpoint. Without enforcement, the agent fetches it and may expose IAM credentials.

**With LoopStorm Guard.** The production policy pack contains a rule that unconditionally denies calls to the HTTP request tool where the URL matches private IP ranges or known cloud metadata patterns. The policy evaluator matches the URL pattern. The engine returns deny. The shim raises PolicyDeniedError. The tool does not execute.

**Audit log content.** A policy_decision event records: the tool name, the rule ID that matched, the decision, and the reason string from the policy. The URL is shown in redacted form if it contained sensitive query parameters. The args_hash records the fingerprint of the original call.

**Limitations.** This protection applies only to calls routed through the LoopStorm integration boundary. If the agent constructs the HTTP call via a library that does not go through the shim, the policy does not apply.

**Business outcome.** A potential SSRF attack is blocked at the enforcement layer. The event is on record. The security team can configure an alert for future rule matches on the hosted control plane (v1.1 commercial feature).

---

## Case Study 2 — Runaway Cost Stopped by Budget Hard Cap

**Scenario.** A document review agent processes a batch with a misconfiguration causing it to process the same document repeatedly. Each call costs approximately $0.08. Without enforcement, the run accumulates hundreds of dollars before manual intervention.

**With LoopStorm Guard.** The production budget configuration sets a hard cap of $5.00 estimated cost per run. When the accumulated estimated cost reaches the cap, the budget engine returns kill. The shim raises TerminateRunError. The run ends cleanly. The correctly processed documents up to that point are captured as safe partial output.

**Audit log content.** Budget update events record the accumulated cost approaching the cap. A budget exceeded event records the breach with the dimension, current value, and cap value. The termination system event records the exit reason and the safe partial output reference.

**Limitations.** The $5.00 cap is an estimated cost based on the engine's internal pricing table. It is not the AI provider's verified billed amount. Actual billing may differ. The safe partial output is whatever the agent has accumulated — if the agent keeps state in memory and that state is lost on termination, the partial output may be less complete than expected.

**Business outcome.** Cost is bounded at approximately $5.00 instead of accumulating to $60–$70. The partial output is recoverable. The incident has an auditable record without additional instrumentation.

---

## Case Study 3 — Looping Agent Detected and Terminated

**Scenario.** A customer support agent receives a malformed ticket that causes it to call the same tool with the same arguments repeatedly, receiving the same response each time. Without enforcement, this runs indefinitely.

**With LoopStorm Guard.** Loop heuristic Rule 1 tracks repeated identical tool calls within a rolling window. On the third identical call with the same argument fingerprint within 120 seconds, the loop detector fires. Recovery sequence: first trigger produces a cooldown pause with a corrective context message injected. Second trigger for the same rule terminates the run.

**Audit log content.** Loop detected events at each trigger with the rule name, recovery action, and the argument fingerprint. Recovery action events documenting the injected intervention. The full call sequence visible in timeline order.

**Limitations.** Loop detection applies to calls visible at the enforcement boundary. An agent looping in internal state without producing repeated outbound tool calls will not be detected by this heuristic. Cross-run loop detection — the same agent looping across multiple separate runs — is a v2 capability.

**Business outcome.** The stuck agent terminates automatically after a bounded number of identical calls. No manual intervention required. The escalation sequence is auditable.

---

## Case Study 4 — Hash Chain Supports Audit Evidence Review

**Scenario.** A healthcare technology company uses agents for patient data processing. During a compliance review, the reviewer asks whether the agent activity log has been modified since the runs occurred.

**With LoopStorm Guard.** The company exports JSONL log files from Supabase Storage and runs the replay CLI against them. Unmodified runs show CHAIN VALID. A copy of one file with a modified field shows CHAIN BROKEN at the modified sequence number.

**What this demonstrates to the reviewer.** The log files show internal consistency — no casual or unsophisticated modification has occurred. Each event's payload matches its hash. The chain is intact.

**What this does not demonstrate.** The hash chain alone does not prove that the log cannot have been recomputed by someone with write access to the file. For forensic-grade evidence in a regulated proceeding, the hosted backend's append-only PostgreSQL record and the forthcoming signed checkpoint anchoring feature (commercial, v1.1) provide a stronger integrity foundation.

**Correct language for this capability.** LoopStorm Guard supports audit evidence collection by providing structured, hash-linked event records that improve the evidentiary integrity of agent activity logs compared to unstructured log files. It strengthens the organization's control posture and supports investigation and review. It is not a compliance certification and does not replace legal or regulatory review of audit requirements.

**Practical outcome.** The reviewer can verify log consistency without specialized tools — SHA-256 of any event's payload can be checked against the stored hash using standard utilities. The redacted log contains no PHI. The structure supports investigation.

---

---

# 15. Deployment Modes

## Mode 1 — Local Only (Open-Source, No Account Required)

The engine binary, the Python shim, and the JSONL file. The replay CLI. No backend. No account. No network.

This mode is fully useful for: individual developers validating guard behavior, teams in air-gapped environments, security evaluations before committing to a vendor relationship, and organizations with data residency restrictions that prevent any data leaving the premises.

Installation is via pip and a post-install binary download. The engine binary and replay CLI are bundled in the same release.

## Mode 2 — Local Engine + Hosted Control Plane (v1 Commercial)

The engine runs locally on the customer's infrastructure. Events are forwarded to the LoopStorm hosted backend via the HTTP batch sink. The web UI shows the run timeline, chain verification badge, and event detail.

The local JSONL file remains the ground truth. The hosted backend is a secondary storage and viewing layer. If the backend is unreachable, events are written to JSONL and can be imported later.

This is the primary commercial offering in v1.

## Mode 3 — Self-Hosted Control Plane (v2, Enterprise)

The full control plane — API server, Supabase, web UI — deployed within the customer's own infrastructure. No data reaches LoopStorm's cloud. This mode requires packaging, deployment documentation, and operational support commitments. It is a v2 roadmap item.

The architecture is designed for it. No code changes are required to support self-hosting; only deployment and packaging work.

---

---

# 16. Scope — v1, v1.1, and v2

## v1 — The Smallest Credible Product

v1 is the enforcement core. It proves that the guard works correctly, that the event log is reliable, and that a team can deploy it in production with measurable impact on at least one failure mode.

| Capability | Surface |
|---|---|
| Rust engine — redaction, policy eval (allow/deny), budget hard caps, two loop heuristics, hash chain | Engine |
| Python shim — OpenAI adapter, generic tool wrapper, fail-open/closed config | Shim |
| Local JSONL event log with hash chain | Engine |
| Replay and verification CLI | CLI binary |
| Hosted event ingest and run storage | Backend |
| Minimal hosted run timeline (read-only) | Web UI |
| Hash chain verification badge in UI | Web UI |
| API key auth for SDK-to-backend | Backend |
| Human auth for UI access | Backend + Supabase Auth |
| Tenant isolation via RLS | Supabase |
| Policy pack file upload (YAML, validated on upload) | Backend |
| Budget soft cap warning events | Engine |
| Local development via Supabase CLI | Dev tooling |

### v1 Pre-Ship Deliverable (non-code, required before first pilot)

| Deliverable | Owner | Notes |
|---|---|---|
| **OWASP Top 10 Agentic Applications mapping document** | Architect + Docs | One-page artifact mapping LoopStorm Guard enforcement capabilities to the OWASP Top 10 for Agentic Applications 2026; required before the first enterprise pilot security conversation; estimated one week of effort; explicitly states both what LoopStorm covers and what it does not — overstating coverage fails security review |

## v1.1 — Operational Completeness

| Capability | Notes |
|---|---|
| Human-in-the-loop approval workflow (web UI) | Requires hosted backend |
| Supabase Realtime for live approval queue | Replaces 5-second polling |
| Mobile approval app (Expo) with push notifications | Requires hosted backend |
| Third loop heuristic — agent state stagnation | Engine addition |
| Model degradation action (degrade_model) | Shim action on engine decision |
| **TypeScript shim (must-have — Priority Action 5)** | **Promoted from nice-to-have to must-have; required to cover MCP-native and TypeScript-first agent stacks (Claude Code, Cursor, ADK); same IPC protocol over UDS, separate shim implementation; every release cycle without it is lost ICP surface area** |
| Automatic run timeout and abandonment cleanup | Backend operational job |
| Automatic JSONL reconciliation on backend reconnect | HTTP sink retry and import |
| Signed checkpoint anchoring (commercial) | KMS-backed root hash signing |
| LangChain adapter | Python shim extension |
| Alert rules with email and webhook notifications | Commercial hosted feature |
| **`agent_role` identity field in policy YAML schema (Priority Action 2)** | **First-class role/identity primitive; enables role-scoped allow/deny rules; positions product for Zero Trust architecture conversations in enterprise security reviews; design decision must be resolved before v1.1 policy schema is published** |
| **MCP proxy mode — architecture design (Priority Action 3)** | **Design deliverable targeting v1.1; implementation may extend into v2 depending on complexity; local MCP server intercepts tool call parameters before upstream execution and routes them through the policy engine; closes the enforcement gap on the dominant 2026 agent tool-call surface** |
| **OpenTelemetry (OTEL) event exporter (Priority Action 4 — telemetry surface)** | **Translates JSONL events to OTEL-compatible spans; enables downstream integration with Datadog, Grafana, SIEM stacks; the event schema maps cleanly to OTEL span semantics** |

## v2 — Platform Scale

| Capability | Notes |
|---|---|
| Cross-run budget accumulation (time-window) | Requires persistent cross-run state |
| Enterprise self-hosted packaging (Mode 3) | Deployment tooling and support |
| Go and other runtime shims | New language integrations |
| Network-level sidecar / proxy mode | No shim required in agent |
| Policy editor in UI | Security-gated, version-controlled |
| RBAC and SSO | Multi-team account management |
| pgvector-based semantic policy matching | Experimental, not deterministic |
| Multi-region hosted deployment | Latency and data residency |
| **Behavioral anomaly detection layer (Priority Action 4 — detector)** | **ML-based anomaly detection over call sequencing, token consumption patterns, and tool call parameter distributions; the behavioral telemetry schema required to support this must be designed and captured in v1.1 — not built in v2; the detector is a v2 capability, the data collection is a v1.1 obligation** |

---

---

# 17. Pricing and GTM

## 17.1 Why Now

The buying window is open for the next 12–18 months. Teams that are selecting their runtime governance patterns today are selecting for 2–3 years. The cost of migrating runtime infrastructure after it is embedded in production agents is high — higher than the cost of the tool itself. The teams who adopt now will be the reference customers for the teams who adopt in 2027.

The alternative for most teams is a custom internal solution built once and not maintained. LoopStorm's competition in most deals is not another vendor — it is the team deciding to build it themselves. That is a winnable argument when the team has already built it once and knows the maintenance burden.

## 17.2 Initial Pricing Hypothesis

| Tier | Price | What It Covers |
|---|---|---|
| Open-source | Free | Engine, shim, JSONL, replay CLI, local mode |
| Starter (hosted) | $200–$500 / month | Hosted timeline, 2 team members, 1M events/month, 30-day retention |
| Team (hosted) | $1,000–$2,000 / month | Unlimited team members, 10M events/month, 90-day retention, approval workflow |
| Enterprise (hosted or self-hosted) | Custom | Signed checkpoint anchoring, SSO, RBAC, SLA, custom retention, Mode 3 self-host |

These are hypotheses, not published prices. They must be validated against willingness to pay in the first 5–10 customer conversations.

The pricing model must not create a perverse incentive to reduce event volume (and therefore reduce guard coverage). Per-event pricing above generous thresholds is the correct structure — not per-event as the primary unit.

## 17.3 Pilot Trigger

The ideal trigger for a pilot is a team that has had one real incident — an unexpected API bill, an unsafe tool call, or a failed compliance question — in the past 90 days. This team already knows the problem is real. They do not need to be convinced that it matters.

Secondary trigger: a security or compliance team has asked the engineering team for evidence of what an AI agent did, and the engineering team cannot produce it.

## 17.4 Success Metric in the First 30 Days

A pilot is successful if: the team has deployed the guard on at least one production agent, the agent has run at least 10 guarded runs visible in the hosted timeline, and at least one enforcement event — a policy deny, a budget cap hit, or a loop detection — has been triggered on a real production run. That last condition proves that the guard is integrated in a meaningful path, not a toy agent.

If no enforcement events occur in the first 30 days, it is likely that the policy is misconfigured, the agent is not routing through the guard, or the agent is operating normally and the team's risk exposure is lower than expected. All three are useful findings.

## 17.5 Validation Plan

Three questions to validate in the first 90 days:

**Question 1 — Does the integration friction match the expectation?** The current assumption is 1–3 days to production-ready integration including policy authoring and routing validation. If this consistently takes longer, either the documentation is insufficient or the product surface is wrong.

**Question 2 — Does at least one enforcement event per team occur in the first 30 days?** If teams are integrated but see zero enforcement events, either the agents are well-behaved (good) or the guard is not in the right path (bad). This ratio must be tracked per pilot.

**Question 3 — Does the audit log satisfy the security or compliance team's question?** Each pilot should identify the specific question the security or compliance team was asking. After 30 days, ask whether the team can now answer it with LoopStorm's evidence. Yes or no — that is the clearest product signal.

## 17.6 Red Flags — Signals That v1 Is Not Working

- Teams complete integration but never trigger an enforcement event, because the shim is not actually in the critical path
- Teams use the JSONL log for debugging but not for any compliance or incident review purpose
- The policy authoring step consistently takes more than one week and requires LoopStorm involvement
- Teams treat LoopStorm as an observability tool rather than an enforcement tool
- The hash chain guarantee is misrepresented by sales or marketing as providing forensic-grade audit integrity without qualification

## 17.7 Why Teams Switch Now Instead of Later

Teams switch when the cost of not having the control is concrete and recent, not hypothetical and future. The job is not to convince a team that AI agents might cause problems. The job is to find teams that already know they have a problem and hand them a solution that fits into their existing stack.

The ideal pitch is not "here is what could go wrong." It is: "the thing that went wrong for you last month — here is a system that prevents the next one and gives you a record of this one."

---

---

# 18. What v1 Must Prove

v1 is not complete until it can demonstrate all five of the following outcomes against a real or realistic production scenario.

**1. Enforcement is real.**
At least one policy deny, one budget termination, and one loop kill must be triggered in a realistic agent scenario and visible in the audit log and the hosted UI. "Works in a demo" is not sufficient. The enforcement path must be tested against an agent whose behavior was not specifically designed to trigger it.

**2. The JSONL log is usable for post-incident investigation.**
A developer who was not present during an agent run must be able to open the JSONL file, understand what happened, identify when and why enforcement triggered, and verify that the chain is intact — without reading the LoopStorm documentation during the investigation. If this requires documentation, the event structure is not self-explanatory enough.

**3. Integration does not require LoopStorm involvement.**
A team must be able to integrate the shim, author a policy pack, configure budget caps, and get to a production-ready guarded agent without a call with LoopStorm. If every pilot requires a configuration call, the product is a professional services engagement, not a product.

**4. The tamper-evidence claim survives scrutiny.**
A technically sophisticated reviewer — a security engineer or auditor — must be able to read the hash chain section of the documentation, understand both what it provides and what it does not, and accept it as technically accurate. The claim must not be overstated in sales or marketing materials. The first time this claim is challenged by a security team in a pilot and fails, it damages the product's credibility.

**5. At least one pilot team integrates and demonstrates measurable enforcement impact in production.**
One real team, one real production agent, one real enforcement event that they care about. This is the only validation that matters. Everything else is theory.

---

---

# 21. Market Alignment — Priority Actions (March 2026)

*Five actions derived from a March 2026 market landscape analysis. None alter the v1 architecture. Actions 2–5 govern v1.1 design decisions. Action 1 is a pre-pilot deliverable requiring no implementation.*

---

## Action 1 — OWASP Agentic Top 10 Mapping Document (pre-pilot, ~1 week)

The OWASP Top 10 for Agentic Applications 2026 is the emerging baseline lens used by enterprise security teams when evaluating runtime enforcement tools. LoopStorm Guard directly addresses several items on this list (unconstrained resource consumption, excessive agent actions, audit evidence), but this alignment is not currently explicit in any customer-facing artifact. A one-page mapping document — produced before the first enterprise pilot — converts the first security conversation from interrogation to confirmation. It must honestly state both what LoopStorm covers and what it does not. Overstated coverage fails the scrutiny of the technically sophisticated reviewer described in Section 18.

## Action 2 — `agent_role` as First-Class Policy Schema Primitive (v1.1 design)

Enterprise security reviews in 2026 ask: what is the identity of this agent, and how does your enforcement layer scope permissions to that identity? The current policy schema matches on tool name, environment, and call arguments — no identity axis exists. Adding `agent_role` as a first-class field enables rules of the form: deny calls to the production database tool from an agent with role `data-reader`. This is the minimal model required to participate in Zero Trust architecture conversations. It is a schema design decision with low implementation cost; retrofitting it in v2 is significantly more expensive.

## Action 3 — MCP Proxy Mode Architecture (v1.1 design, v1.1 or v2 implementation)

The Model Context Protocol is now the dominant standard for how agents call tools — donated to the Linux Foundation in December 2025, backed by every major AI provider, 97M+ monthly SDK downloads. LoopStorm Guard's enforcement boundary is the Python shim wrapping LLM API calls. MCP tool calls are outside this boundary. An agent guarded by LoopStorm today can make unrestricted MCP tool calls the policy engine never sees. A local MCP proxy layer — sitting between the agent and upstream MCP servers and routing tool call parameters through the existing policy engine — closes this gap without new enforcement logic. The design spec must be produced in the v1.1 design sprint even if implementation extends into v2.

## Action 4 — Behavioral Telemetry Schema (v1.1 schema design; detector is v2)

The market is moving toward behavioral anomaly detection — identifying anomalous tool-use sequences and actions that deviate from established baselines. LoopStorm Guard's three-heuristic loop detector is correct for v1 and v1.1. The v2 behavioral detector requires historical telemetry that is not in the current event schema: call sequence fingerprints, token consumption rate-of-change, inter-call timing, and parameter distribution signatures. Schema changes to the hosted events table after production deployment are expensive to retrofit. The design decision — which fields to capture — must be made in v1.1. The detector itself is a v2 capability. This is an architecture decision that costs almost nothing to make now and is expensive to defer.

## Action 5 — TypeScript Shim Promoted to v1.1 Must-Have (scope protection)

The TypeScript shim is already on the v1.1 roadmap. This action prevents it from being deprioritized under implementation pressure. The dominant agent toolchains in 2026 — Claude Code, Cursor, Google ADK — are TypeScript-first. MCP NPM downloads run approximately 4:1 over PyPI. A Python-only shim means LoopStorm Guard cannot protect agents built on the most common stacks. The v1 ICP is Python-native teams. Every release cycle without a TypeScript shim is lost v1.1 ICP surface area. The implementation cost is low: the TypeScript shim reuses the existing UDS IPC protocol over the same Rust engine with no engine changes required.

---

---

# 22. Major Corrections Made from v1.0

**1. Tamper-evidence language corrected.**
v1.0 described the hash chain as providing "independently verifiable" audit integrity that would satisfy auditors. This was too strong. A hash chain in a file is verifiable only against the chain itself — an attacker with write access can recompute it. Section 8.4 now precisely describes what the chain provides (accidental corruption detection, unsophisticated modification detection), what it does not provide (protection against recomputation by a party with write access), and what is required for strong tamper-evidence (external trust anchor, KMS signing, or hosted append-only backend). The language "tamper-evident" is retained where technically accurate and scoped where it is not.

**2. Bypass claim scoped correctly.**
v1.0 stated that "the guard cannot be bypassed by the agent's code." This is false as an absolute. Section 7 and Section 8.6 now use trust-boundary language: enforcement applies to calls routed through the integration boundary, on a host that has not been compromised, with a healthy engine process. The guard is a control layer for cooperative systems, not an adversarial security perimeter.

**3. ICP narrowed significantly.**
v1.0's ICP included teams from 20 to 2,000 employees across a broad range of industries. v1.1's ICP focuses on platform engineering, SRE, and AI infrastructure teams with at least one production agent executing real tool calls and at least one concrete risk driver (prior incident or compliance question). The "Who This Is Not For" section is new and explicit — it prevents wasted pilots with teams who want passive observability or who do not yet have production tool use.

**4. v1 scope dramatically reduced.**
v1.0 included a mobile app, a desktop app, a full multi-tenant dashboard, a complete approval workflow, and all four loop heuristics. v1.1 splits this into three waves: v1 (enforcement core + minimal hosted timeline), v1.1 (approvals, mobile, Realtime, third heuristic, TypeScript shim), and v2 (self-hosted enterprise, cross-run budgets, network proxy mode). The v1 product is now the smallest thing that proves the enforcement core works in production.

**5. Trust Boundaries and Threat Model added.**
v1.0 had no section defining what LoopStorm assumes, what it protects against, and where its guarantees end. Section 7 fills this gap with explicit tables for trusted components, untrusted threats, and defined failure scenario behaviors. This section exists to prevent the product from being deployed under false assumptions about what it protects.

**6. Operational Guarantees and Failure Modes added.**
v1.0 described the architecture but not the operational reality. Section 11 defines the event durability model, crash recovery semantics, ordering guarantees, idempotency assumptions, backend outage behavior, latency targets, storage growth projections, and fail-open vs fail-closed logic. These are not implementation details — they are the guarantees a production engineering team needs before deciding to deploy.

**7. Open Core vs Commercial Boundary added.**
v1.0 did not define what is open-source, what is commercial, or what the moat is. Section 12 defines the open-source core (enforcement engine, shim, JSONL, replay CLI), the commercial hosted tier (approvals, dashboard, signed anchoring, alerts), and the v2 self-hosted enterprise tier. The commercial moat is not the enforcement core — that is deliberately commoditizable — it is the hosted operational layer and signed checkpoint infrastructure.

**8. Pricing and GTM sections added.**
A product document without a pricing hypothesis and validation plan is an architecture memo. Section 17 adds initial pricing hypothesis, pilot trigger, 30-day success metric, validation questions, red flags, and why-now framing. These are hypotheses — they are labeled as such — but they give the team something concrete to test and refine.

**9. Compliance language tightened throughout.**
v1.0 used language implying that LoopStorm would satisfy compliance audits and regulatory requirements. v1.1 consistently uses: "supports audit evidence collection," "improves evidentiary integrity," "strengthens control posture," and "supports investigation and review." The product helps teams build a defensible position. It does not certify that position.

**10. Integration honesty restored.**
v1.0 described integration as "three lines of code." Section 13.1 now describes the actual production integration sequence: policy authoring, budget configuration, fail behavior decisions, routing validation, and deployment choices. This is a 1–3 day task done correctly — not a one-liner. Understating integration complexity sets up customers for disappointment and creates a support burden.

---

# 23. Final Precision Changes Made (v1.1 → v1.2)

**1. Hosted-backend forensic/audit claim softened (Section 8.4)**
The previous v1 position paragraph said "Organizations that require forensic-grade audit integrity should use the hosted backend" — implying the hosted backend alone is sufficient. This was too strong. The revised text explains concretely how the hosted backend *improves* evidentiary integrity relative to local-only mode (append-only DB, independent chain verification pass, separate access controls). It then explicitly states what is still required for forensic-grade evidentiary claims in a contested proceeding: external cryptographic signing, database audit logging, immutable storage anchoring, and rigorous control-plane operational security. It clarifies that LoopStorm does not certify the hosted backend as meeting any specific forensic or regulatory standard.

**2. ICP narrowed and stratified (Section 5)**
The previous qualification table used a single "strong fit / weak fit" column with an employee range of 20–2,000. The revised section introduces a three-column structure: v1 Wedge (primary target), Addressable Market (expansion), and Weak Fit. The v1 wedge tightens to 10–150 employees, adds "technical CTO at AI-native software company" as an explicit first-tier profile, and makes prior incidents or a concrete operational fear a near-required qualifier. The broader addressable market is kept visible but separated, preventing GTM diffusion in the early phase.

**3. Safe partial output defined precisely (Section 8.2)**
The phrase "safe partial output is captured at the moment of termination" was vague and implied universal availability. The revised section defines safe partial output as adapter-dependent checkpointed state, specifies when it is available (adapter maintains an explicit results buffer), when it is not (single-artifact runs without mid-run checkpointing), and clarifies that evidence preservation — the event log — is unconditional regardless of whether recoverable business output exists. The v1 OpenAI adapter's behavior is noted; custom adapters must explicitly register results to participate.

**4. Control Philosophy section added (Section 4.3)**
No such section existed previously. The new section crystallizes the four-stage control model — prevent obvious bad actions, detect non-progress, attempt bounded recovery, terminate safely — in plain technical language. It makes the product's conceptual spine explicit and distinguishes LoopStorm from logging and observability tools. It also clarifies the product's self-framing: a control-systems problem, not an AI problem.

**5. "Why Now" reframed as market thesis (Section 2)**
The previous section made several assertions — "incidents are common," "compliance pressure is arriving" — as though they were established facts. The revised section opens with an explicit framing line stating these are strategic beliefs, not claims backed by published research. Each thesis is labeled as a thesis. Stronger-sounding claims are hedged with "we believe." This keeps the section substantive and directional while making the epistemic status of its claims honest.

---

*LoopStorm Guard — v1.3 Product Document*  
*Prepared March 2026 — Ricardo / LoopStorm*  
*v1.3 additions: Section 21 Market Alignment Priority Actions; v1.1 scope updated with Priority Actions 2–5; v1 pre-ship deliverable (Action 1) added; v2 scope updated with behavioral anomaly detection; section numbering updated*
