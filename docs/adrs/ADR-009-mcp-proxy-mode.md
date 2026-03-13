<!-- SPDX-License-Identifier: MIT -->
# ADR-009: MCP Proxy Mode

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

The Model Context Protocol (MCP) is the dominant standard for how agents call tools as of 2026 — donated to the Linux Foundation in December 2025, backed by every major AI provider, with 97M+ monthly SDK downloads. MCP NPM downloads run approximately 4:1 over PyPI.

LoopStorm Guard's current enforcement boundary is the language shim wrapping LLM API calls. MCP tool calls bypass this boundary entirely. An agent guarded by LoopStorm can make unrestricted MCP tool calls that the policy engine never sees. This is a critical enforcement gap on the dominant 2026 agent tool-call surface.

---

## Decision

LoopStorm Guard will support an **MCP proxy mode** where a local MCP server sits between the agent and upstream MCP servers, routing tool call parameters through the existing policy engine.

Architecture:

```
[Agent] --> [LoopStorm MCP Proxy] --> [Upstream MCP Server(s)]
                  |
                  v
            [Rust Engine]
            (same policy eval, budget, loop detection, JSONL)
```

The MCP proxy:
1. Presents itself as an MCP server to the agent.
2. Receives MCP `tools/call` requests from the agent.
3. Translates each tool call into a LoopStorm DecisionRequest and sends it to the engine via UDS.
4. If the engine returns `allow`, forwards the call to the upstream MCP server.
5. If the engine returns `deny`, `kill`, or `cooldown`, returns an appropriate MCP error response to the agent.
6. Records the call and its outcome in the JSONL event log via the engine.

The MCP proxy reuses the existing engine without any engine changes. It is a new transport adapter, not a new enforcement path. The same policy pack, budget configuration, and loop detection apply to MCP-proxied calls as to shim-intercepted calls.

The MCP proxy is a design deliverable for v1.1. Implementation may extend into v2 depending on complexity. The design spec is published at `specs/mcp-proxy-mode.md`.

---

## Consequences

**Positive:**
- Closes the enforcement gap on MCP tool calls.
- Reuses the existing engine and policy infrastructure. No new enforcement logic.
- Agents using MCP get the same guarantees as agents using direct API calls through the shim.
- The proxy is a separate process/component; agents that do not use MCP are unaffected.

**Negative:**
- Adds a network hop (localhost) between the agent and the MCP server, increasing per-call latency. This is bounded by the same P99 < 5ms target as UDS IPC.
- MCP protocol evolution may require proxy updates. The proxy must track MCP spec versions.
- The proxy must handle MCP features beyond simple tool calls (resources, prompts, sampling) — either by passing them through unmodified or by explicitly not supporting them in v1.1.

---

## Migration Path

The MCP proxy mode is additive. It does not replace the language shim approach. Teams can use the shim, the MCP proxy, or both, depending on their agent architecture.

If MCP becomes the universal tool-call interface and language shims become unnecessary, the shim could be simplified to a thin MCP client that routes all calls through the proxy. This is a v2+ consideration.
