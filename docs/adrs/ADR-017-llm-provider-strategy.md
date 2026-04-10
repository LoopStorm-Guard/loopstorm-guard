<!-- SPDX-License-Identifier: MIT -->
# ADR-017: LLM Provider Strategy (DeepSeek Primary, Anthropic Alternate)

**Status:** Accepted
**Date:** 2026-04-09
**Author:** Lead Architect

---

## Context

ADR-014 Gate 4 established a thin `LLMProvider` interface with `AnthropicProvider` as the only concrete implementation for v1.1. The reasoning at the time was that a full multi-provider abstraction was overengineering for v1.1 and Claude (haiku-class) was the intended target.

Since ADR-014 was adopted (2026-04-02), the project's commercial strategy has shifted. The OSS/SaaS commercialization plan (docs/oss-saas-business-model.md and the 7-phase commercialization roadmap approved 2026-04-09) requires an LLM provider that:

1. Is significantly cheaper per token at inference volumes we expect for Mode 3 (potentially thousands of supervisor sessions per day across all customers).
2. Supports tool-calling with a schema compatible enough to be adapted without rewriting the supervisor's 13-tool catalog.
3. Has an OpenAI-compatible HTTP API so no proprietary SDK is required (reduces dependency surface and simplifies the `LLMProvider` interface implementation).
4. Does not change the observation plane boundary: the supervisor still operates under `ADR-012`, under a $2.00/session hard budget cap, with human approval for every proposal.

### The Provider Swap

Between 2026-04-06 and 2026-04-09, the supervisor's LLM provider was swapped from Anthropic's Claude (via `@anthropic-ai/sdk`) to DeepSeek V3.2 (model ID `deepseek-chat`) via the OpenAI-compatible HTTP API at `https://api.deepseek.com`. Three files changed:

- `apps/supervisor/src/llm/deepseek.ts` — new file, `DeepSeekProvider` class implementing `LLMProvider` via `fetch` (no new SDK dependency).
- `apps/supervisor/src/index.ts` — `AnthropicProvider` import/instantiation replaced with `DeepSeekProvider`.
- `apps/supervisor/src/config.ts` — default model changed from `claude-3-5-haiku-latest` to `deepseek-chat`.

These changes exist on disk but are uncommitted as of this ADR. HANDOFF.md (§3) documents them. The change was made without an ADR amendment, which is an ADR-014 governance gap that this ADR closes.

### The Env Var Name Question

The supervisor reads the LLM API key from the env var `ANTHROPIC_API_KEY`. In the new setup, that env var holds a DeepSeek key. HANDOFF.md explicitly states: "The env var is still named `ANTHROPIC_API_KEY` — it holds the DeepSeek key. Do not rename the env var."

There are two tensions here:

- **Clarity:** The env var name lies about its contents. A new operator reading deployment config could reasonably assume it holds an Anthropic key.
- **Zero-friction operator override:** Operators in Mode 1 (enterprise self-hosted) may want to run the supervisor against Anthropic instead of DeepSeek. If the env var stays named `ANTHROPIC_API_KEY`, they can swap the provider (by changing one line in `index.ts` or a future config flag) without touching their env vars or secret management systems. Renaming the env var would force a config migration on every Mode 1 operator who later switches back to Anthropic.

The decision below resolves this tension by retaining the name but documenting it unambiguously.

---

## Decision

### 1. DeepSeek V3.2 is the primary LLM provider for Mode 3 SaaS.

- Default model: `deepseek-chat` (DeepSeek V3.2)
- API endpoint: `https://api.deepseek.com` (OpenAI-compatible chat completions API)
- Client: plain `fetch` from the Bun runtime. No proprietary SDK.
- Concrete implementation: `apps/supervisor/src/llm/deepseek.ts`, class `DeepSeekProvider implements LLMProvider`.
- Tool-calling: uses OpenAI tool format (DeepSeek V3.2 is compatible). The supervisor's 13 tools are serialized to the OpenAI `tools` schema and DeepSeek's responses follow the OpenAI `tool_calls` shape.

### 2. AnthropicProvider remains as a second implementation for Mode 1 enterprise.

- `apps/supervisor/src/llm/anthropic.ts` (the implementation specified in ADR-014 Gate 4) is retained as a working, tested alternate implementation. It is not deleted.
- The `@anthropic-ai/sdk` dependency is **removed** from `apps/supervisor/package.json` because it is no longer the default. Mode 1 operators who enable the Anthropic path must re-add the dependency (documented in the Mode 1 setup guide) or, preferably, use a `fetch`-based Anthropic implementation parallel to the DeepSeek one.
- **Recommendation for future work:** port `anthropic.ts` to use plain `fetch` against Anthropic's messages API, matching the DeepSeek implementation style. This eliminates the SDK dependency entirely and makes provider selection symmetric. This work is deferred but tracked.

### 3. The `LLMProvider` interface is unchanged from ADR-014 Gate 4.

```typescript
// apps/supervisor/src/llm/provider.ts — unchanged from ADR-014
interface LLMProvider {
  chat(params: {
    model: string;
    system: string;
    messages: Message[];
    tools: ToolDefinition[];
    max_tokens: number;
  }): Promise<LLMResponse>;
}
```

Both `DeepSeekProvider` and `AnthropicProvider` implement this interface. The session manager, risk scorer, and all supervisor business logic depend only on `LLMProvider`, never on a concrete provider.

### 4. The `ANTHROPIC_API_KEY` env var name is retained.

- The env var holds the DeepSeek API key in Mode 3 SaaS deployments.
- This is **intentional and documented** as a zero-friction operator override point: a Mode 1 operator who later switches to Anthropic does not need to change secret management — the same env var name serves both providers.
- Documentation must make this explicit in three places:
  - `docs/secrets-inventory.md`: "`ANTHROPIC_API_KEY` — LLM provider API key for the supervisor. In Mode 3 SaaS (DeepSeek primary), this holds a DeepSeek key. In Mode 1 with Anthropic, this holds an Anthropic key. The env var name is deliberately stable across providers."
  - `apps/supervisor/README.md`: same note.
  - Any Mode 3 deployment guide: same note.
- A more descriptive alias `LOOPSTORM_SUPERVISOR_LLM_API_KEY` MAY be added in v1.2 as a long-term-friendly name, but `ANTHROPIC_API_KEY` will continue to be read for backward compatibility indefinitely.

### 5. The hard budget cap ($2.00/session) applies regardless of provider.

- The $2.00/session cap defined in ADR-012 is enforced in the supervisor's session manager **before** any provider-specific code runs. The cap is provider-agnostic.
- Cost computation per provider:
  - **DeepSeek:** `(input_tokens * deepseek_input_rate) + (output_tokens * deepseek_output_rate)` where rates come from DeepSeek's published pricing. Rates are hardcoded as constants in `apps/supervisor/src/llm/pricing.ts` (or equivalent) and must be updated if DeepSeek changes pricing.
  - **Anthropic:** same pattern, Anthropic rates.
- The `LLMResponse.usage` field (`input_tokens`, `output_tokens`) is populated by the provider implementation. Both DeepSeek and Anthropic return these fields in compatible shapes.
- Supervisor session state tracks cumulative `cost_usd` across all tool-loop iterations. When `cost_usd >= 2.00`, the session terminates with `stop_reason = "budget_exceeded"` and a `supervisor_budget_exceeded` event is written to the audit log.

### 6. Provider selection is a single compile-time decision in v1.1.

- The supervisor instantiates exactly one `LLMProvider` at startup, read from `apps/supervisor/src/index.ts`.
- In v1.1, this is always `new DeepSeekProvider(...)` for Mode 3 SaaS deployments.
- Mode 1 operators who want Anthropic change one line in `index.ts` (or fork the supervisor) to instantiate `AnthropicProvider` instead.
- A runtime provider-selection flag (`LOOPSTORM_SUPERVISOR_LLM_PROVIDER=deepseek|anthropic`) MAY be added in v1.2 if demand warrants. It is not added in v1.1 because it would require dynamic import paths and additional configuration surface for a single-binary decision.

---

## Consequences

### Positive

1. **Lower cost per supervisor session.** DeepSeek V3.2 is significantly cheaper per token than Claude Haiku. At the expected Mode 3 volumes, this compresses the LLM cost line item in the business model's monthly cost table.
2. **Zero proprietary SDK dependency by default.** The DeepSeek implementation uses `fetch` only. Removing `@anthropic-ai/sdk` reduces the supervisor's dependency graph, the bundle size, and the license audit surface.
3. **Provider symmetry.** Both providers can (and should) be implemented via plain `fetch`. The `LLMProvider` interface abstracts the differences, and the session manager never knows which provider is active.
4. **Enterprise optionality preserved.** Mode 1 operators who have negotiated Anthropic rates or who have compliance reasons to prefer Anthropic retain a working path. They are not forced to DeepSeek.
5. **Budget invariant intact.** The $2.00/session hard cap is enforced above the provider layer. Swapping providers does not weaken this invariant.
6. **Env var stability.** Operators who switch providers do not have to reconfigure their secret management.
7. **ADR-014 gap closed.** The undocumented provider swap is now formally recorded as an architectural decision.

### Negative

1. **Env var name lies about contents.** `ANTHROPIC_API_KEY` holding a DeepSeek key will confuse new operators. Mitigated by documentation in three places, but the confusion surface remains until v1.2 adds the aliased `LOOPSTORM_SUPERVISOR_LLM_API_KEY` name.
2. **DeepSeek V3.2 tool-calling is less battle-tested with our 13-tool catalog than Claude.** Risk R7 from the commercialization plan flags that DeepSeek V3.2 tool-calling compatibility must be tested end-to-end before Phase 4 ships. If incompatibilities are found, the fix may require tool-schema adjustments, a fallback path to Anthropic, or both.
3. **DeepSeek is a Chinese-domiciled company.** Some enterprise customers may have data-residency or geopolitical concerns. For those customers, Mode 1 with Anthropic is the escape valve. Mode 3 SaaS defaults to DeepSeek; customers who cannot accept that must negotiate Mode 1 or wait for a multi-region provider story.
4. **Pricing is a moving target.** DeepSeek's published rates may change. The hardcoded rates in `pricing.ts` must be reviewed quarterly and on every supervisor release.
5. **Anthropic path is now second-class.** Without the `@anthropic-ai/sdk` dependency in `package.json`, Mode 1 operators must re-add it (or use a fetch-based Anthropic implementation). Until the fetch-based Anthropic port lands, the Anthropic path requires extra setup.

### Neutral

1. **No change to the supervisor's non-LLM code.** Session manager, risk scorer, trigger handling, tool catalog, proposal creation, escalation creation — all unchanged.
2. **No change to schemas, events, or the audit trail.** `supervisor_tool_call` events are provider-agnostic. The `cost_usd` field is computed from the same `LLMResponse.usage` shape regardless of provider.
3. **No change to the enforcement plane.** ADR-012's observation/enforcement separation is untouched. The supervisor is still read-only and still requires human approval.

---

## Amendment to ADR-014 Gate 4

ADR-014 Gate 4 ("LLM Provider Abstraction") is amended as follows:

> **Amendment (ADR-017, 2026-04-09):** The concrete implementation for v1.1 is `DeepSeekProvider` (`apps/supervisor/src/llm/deepseek.ts`), not `AnthropicProvider`. The `LLMProvider` interface defined in ADR-014 Gate 4 is unchanged. `AnthropicProvider` is retained as a second implementation for Mode 1 enterprise deployments. See ADR-017 for the provider strategy and rationale.

Readers of ADR-014 should consult ADR-017 for the current state.

---

## Migration Path

### From uncommitted DeepSeek changes to ADR-017-compliant state

1. **Commit the provider swap.** The three uncommitted files (`deepseek.ts`, `index.ts`, `config.ts`) are committed in a single `feat:` commit referencing this ADR.
2. **Remove `@anthropic-ai/sdk` dependency.** `bun remove @anthropic-ai/sdk --cwd apps/supervisor`, commit the lockfile change.
3. **Update documentation:**
   - `docs/secrets-inventory.md` — add the env var rationale note.
   - `apps/supervisor/README.md` (create if missing) — document the DeepSeek default and the Anthropic alternate.
   - `docs/guides/mode-3-setup.md` (created in Phase 4 of the commercialization plan) — include the DeepSeek API key provisioning step.
4. **Verify Mode 3 E2E path.** Phase 4 of the commercialization plan (Supervisor Deployment) includes an acceptance criterion to run an adversarial agent end-to-end against real DeepSeek. This ADR does not ship until that test passes. If it fails, the fallback is documented in the Risk section below.
5. **Update ADR-014.** Add a link at the top of ADR-014 Gate 4 pointing to this amendment.

### Future migrations

- **v1.2:** Add `LOOPSTORM_SUPERVISOR_LLM_API_KEY` as an alias env var. Keep `ANTHROPIC_API_KEY` readable for backward compatibility. Add `LOOPSTORM_SUPERVISOR_LLM_PROVIDER` runtime selector if demand warrants.
- **v1.2:** Port `AnthropicProvider` to plain `fetch` (remove the `@anthropic-ai/sdk` Mode 1 setup friction).
- **v2.0:** If horizontal scaling is introduced, provider selection may become per-tenant (some tenants on DeepSeek, some on Anthropic). This requires session-level provider selection, not startup-level. Revisit at that time.

---

## Risk: DeepSeek V3.2 Tool-Calling Compatibility (R7 from commercialization plan)

**Risk:** DeepSeek V3.2's OpenAI-compatible tool-calling API may not be 100% compatible with our 13-tool catalog. Specific concerns:

1. **Tool schema differences.** OpenAI's `tools` schema uses JSON Schema for parameters. DeepSeek claims OpenAI compatibility, but subtle differences (e.g., how enums, oneOf, or nullable fields are handled) may cause DeepSeek to refuse tools or produce malformed tool calls.
2. **Tool call sequencing.** The supervisor's session loop expects a specific `stop_reason` vocabulary (`end_turn`, `tool_use`, `max_tokens`). DeepSeek returns OpenAI's vocabulary (`stop`, `tool_calls`, `length`). The `DeepSeekProvider` must normalize these.
3. **Multi-turn tool results.** After a tool call, the supervisor sends the tool result back for the next turn. DeepSeek's tool-result message format must match what the `DeepSeekProvider` sends.
4. **Cost reporting accuracy.** DeepSeek's response `usage` field must populate `input_tokens` and `output_tokens` correctly; if it uses different field names, the `DeepSeekProvider` must map them.

**Mitigation:**
1. **Phase 4 E2E test.** The commercialization plan's Phase 4 includes an acceptance criterion that runs an adversarial agent end-to-end, triggers the supervisor, and verifies all 13 tools execute correctly against real DeepSeek. This test must pass before Mode 3 ships.
2. **Fallback path.** If DeepSeek V3.2 tool-calling is incompatible with non-trivial tools, the fallback is:
   - For interpret-only calls (no tools), use DeepSeek.
   - For tool-requiring calls, fall back to Anthropic.
   - This requires wiring both providers at runtime and selecting per-call. This is a larger change — tracked as a contingency, not a plan.
3. **Tool schema tests.** Unit tests in `apps/supervisor/tests/llm/` must exercise each of the 13 tools with a mocked DeepSeek response to verify serialization and parsing on both directions.
4. **Monitoring in staging.** Before production rollout, the supervisor runs against DeepSeek in staging for at least one week with a representative workload. Any tool-call failure is treated as a release blocker.

This risk is documented as R7 in the OSS/SaaS commercialization plan. This ADR proceeds under the assumption that DeepSeek V3.2 is compatible enough; the Phase 4 test is the gate.

---

## Acceptance Criteria

- **AC-17-1:** `apps/supervisor/src/llm/deepseek.ts` exists, implements `LLMProvider`, and uses plain `fetch` (no proprietary SDK).
- **AC-17-2:** `apps/supervisor/src/index.ts` instantiates `DeepSeekProvider` at startup by default for Mode 3 SaaS.
- **AC-17-3:** `apps/supervisor/src/config.ts` default model is `deepseek-chat`.
- **AC-17-4:** `@anthropic-ai/sdk` is removed from `apps/supervisor/package.json` and the lockfile.
- **AC-17-5:** `apps/supervisor/src/llm/anthropic.ts` still exists and still implements `LLMProvider` (retained as Mode 1 alternate).
- **AC-17-6:** The supervisor reads the LLM API key from `ANTHROPIC_API_KEY` regardless of provider.
- **AC-17-7:** `docs/secrets-inventory.md` documents that `ANTHROPIC_API_KEY` holds the active provider's key (DeepSeek in Mode 3, Anthropic in Mode 1).
- **AC-17-8:** The supervisor's $2.00/session hard budget cap is enforced before any DeepSeek API call, using DeepSeek-specific pricing constants.
- **AC-17-9:** All 13 supervisor tools execute end-to-end against a real DeepSeek endpoint in Phase 4 acceptance testing.
- **AC-17-10:** ADR-014 is amended with a note pointing to ADR-017.
- **AC-17-11:** No supervisor source file outside `apps/supervisor/src/llm/` imports a provider SDK directly. All consumers depend only on the `LLMProvider` interface.
- **AC-17-12:** `supervisor_tool_call` events contain `input_tokens`, `output_tokens`, and `cost_usd` regardless of provider.

---

## References

- ADR-012 — AI Supervisor architecture (enforcement/observation plane separation, $2.00 budget cap)
- ADR-014 — v1.1 Gate Resolutions (Gate 4 is amended by this ADR)
- `docs/oss-saas-business-model.md` — commercial strategy requiring cheaper LLM per-session cost
- `HANDOFF.md` §2, §3 — documents the uncommitted DeepSeek swap and the env var naming decision
- `apps/supervisor/src/llm/deepseek.ts` — concrete DeepSeek implementation (uncommitted as of this ADR)
- `apps/supervisor/src/llm/anthropic.ts` — concrete Anthropic implementation (retained)
- `apps/supervisor/src/llm/provider.ts` — `LLMProvider` interface
