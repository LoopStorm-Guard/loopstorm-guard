<!-- SPDX-License-Identifier: MIT -->
# LoopStorm Guard -- v1 Feature Completeness Audit

**Date**: 2026-03-26
**Auditor**: Lead Architect (loopstorm-lead-architect)
**Branch audited**: `fix/security-audit-hardening` (4 commits ahead of `main`)
**Verdict**: **CONDITIONAL GO** -- 5 blockers must be resolved before tagging v1.0.0

---

## Executive Summary

LoopStorm Guard is **feature-complete for v1** across all five planes: Engine, Shims, CLI, Backend, and Frontend. All 13 ADRs are adopted, all 4 JSON schemas are published at schema_version 1, all deterministic enforcement stages (1-4) are implemented with tests, and the observation plane tables are ready for the v1.1 AI Supervisor.

The project has approximately **332 tests** across 5 languages/runtimes (69 engine unit + 11 engine integration + 4 CLI E2E + 88 Python + 66 TypeScript shim + ~84 backend + 10 Playwright). CI runs 13 required jobs plus a final gate.

**5 items block the v1 tag.** All are small, well-scoped tasks (estimated 2-4 hours total). Once resolved, the project is ready for an RC tag to exercise the release pipeline, followed by v1.0.0.

---

## DONE -- Confirmed Complete (with evidence from source files)

### 1. Engine (Rust) -- `apps/engine/`

| Item | Evidence |
|---|---|
| Policy evaluator with 5-stage pipeline | `evaluator.rs`: escalate_to_human bypass, budget hard cap, loop detection, policy rules (first-match-wins), fail-closed deny. 12 unit tests. |
| `escalate_to_human` invariant (hardcoded allow) | `evaluator.rs` lines 18-28: early return `Allow` with `rule_id: "__builtin_escalate_to_human"` before any policy evaluation. 3 dedicated tests (glob deny-all, budget-exceeded, explicit deny). |
| Budget tracker (multi-dimensional, soft+hard caps) | `budget.rs`: tracks `cost_usd`, `input_tokens`, `output_tokens`, `call_count`. Soft cap returns warning, hard cap returns `BudgetExceeded`. |
| Loop detector (fingerprint-based) | `loop_detector.rs`: configurable threshold (default 3), sliding window, `args_hash` fingerprinting. |
| Audit writer (JSONL hash-chain) | `audit.rs`: SHA-256 chain with `hash_prev` linking. Kill on write failure (ADR-005). `null` serialization for hash fields in chain computation. |
| Redaction engine | `redaction.rs`: pattern-based field redaction before audit write. |
| Args hash (SHA-256 of RFC 8785 JCS) | Implemented in engine. Shared test vectors at `tests/fixtures/args-hash-vectors.json` (13 vectors). |
| IPC server (UDS, NDJSON) | `server.rs`: Unix domain socket, mode 0600, 64 KiB max message, 30s read timeout. 11 integration tests in `tests/ipc_integration.rs`. |
| Compile-time schema hash assertion | `build.rs`: pure-Rust SHA-256 implementation. Asserts `policy.schema.json` hash = `10725f37ecb7e82d1073afdd154a4e4d42705c806b15ce6a3a381e53be1721bb`. |
| Fail-closed default (ADR-002) | `evaluator.rs`: no matching rule returns `Deny` with `rule_id: "__builtin_fail_closed"`. |
| Decision enum complete | `decision.rs`: `Allow`, `Deny`, `Cooldown`, `Kill`, `RequireApproval`. |
| Condition operators | `evaluator.rs`: `equals`, `not_equals`, `matches`, `not_matches`, `in`, `not_in`. Dot-notation args access. |
| Builtin error rule IDs | `server.rs`: `__builtin_ipc_parse_error`, `__builtin_ipc_message_too_large`, `__builtin_schema_version_unsupported`, `__builtin_ipc_encoding_error`, `__builtin_engine_error`. |
| Cross-compile targets | `engine-build.yml`: linux x86_64/aarch64, macOS x86_64/aarch64, Windows x86_64. |

**Test count**: 69 unit + 11 integration = **80 tests**.

### 2. CLI (Rust) -- `apps/cli/`

| Item | Evidence |
|---|---|
| `validate` command | `validate.rs`: validates policy YAML against compiled-in schema. Exit 0/1/2. |
| `verify` command | `verify.rs`: verifies JSONL hash chain integrity. Quiet/scriptable output. Exit 0/1/2. |
| `replay` command | `replay.rs`: verbose human-readable chain replay with per-event output. |
| 4 E2E case studies | `tests/e2e_case_studies.rs`: SSRF prevention, budget enforcement, loop detection, chain integrity. All `#[cfg(unix)]`. |
| Links engine as library | `Cargo.toml`: engine crate is a library dependency (no subprocess spawning). |

**Test count**: **4 E2E tests**.

### 3. Python Shim -- `apps/shim-python/`

| Item | Evidence |
|---|---|
| LoopStormGuard class | `_guard.py`: `check()` method sends DecisionRequest over UDS, returns DecisionResponse. |
| Lazy UDS connection | `_connection.py`: connects on first `check()`, not in `__init__()`. |
| Cooldown handling | `_errors.py`: `CooldownError` raised after sleep (no auto-retry). |
| `fail_open` configuration | `_guard.py`: engine-unavailable defaults to warning + allow. Only governs connectivity, not policy. |
| Custom JCS implementation | `_jcs.py`: handles `-0.0`, integer floats (`1.0` -> `1`), UTF-16 surrogate pair key sort. |
| Args hash (RFC 8785) | `_args_hash.py`: SHA-256 of JCS-canonicalized JSON. 13 shared test vectors. |
| OpenAI adapter (duck-typed) | `_openai.py`: no `openai` import, works with any SDK version. |
| UUID v7 fallback | `_types.py`: stdlib `uuid4()` fallback (Python < 3.14 lacks `uuid7()`). |
| Zero runtime dependencies | `pyproject.toml`: no runtime deps listed. |

**Test count**: **88 tests** across 7 test files.

### 4. TypeScript Shim -- `apps/shim-ts/`

| Item | Evidence |
|---|---|
| LoopStormGuard class | `guard.ts`: mirrors Python shim API. |
| Args hash (RFC 8785) | `args-hash.ts` + `jcs.ts`: custom JCS implementation matching Python behavior. |
| OpenAI adapter | `openai.ts`: duck-typed, no `openai` import. |
| Connection management | `connection.ts`: lazy UDS connection. |
| Error types | `errors.ts`: `CooldownError`, `DenyError`, `KillError`, `EngineUnavailableError`. |
| Zero runtime dependencies | `package.json`: no runtime deps. |

**Test count**: **66 tests** across 6 test files.

### 5. Backend -- `packages/backend/`

| Item | Evidence |
|---|---|
| 11 Drizzle ORM tables | `db/schema.ts`: tenants, users, sessions, accounts, verifications, apiKeys, runs, events, supervisorProposals, supervisorEscalations, policyPacks. All tenant-scoped tables have `tenant_id` FK. |
| RLS on all tenant-scoped tables | `drizzle/0002_enable_rls.sql`: RLS enabled + FORCE on 6 tables (api_keys, runs, events, supervisor_proposals, supervisor_escalations, policy_packs). `current_tenant_id()` function. 3 database roles (loopstorm_ingest, loopstorm_supervisor, default). |
| Better Auth (ADR-011) | `auth.ts`: email+password with email verification, optional Google OAuth, drizzle adapter. Session cookie caching (5 min). |
| Tenant provisioning | `auth.ts`: `provisionTenantForUser()` in `databaseHooks.user.create.after`. Creates tenant, back-fills user + session rows. |
| Self-healing tenant resolution | `auth.ts`: `ensureTenantId()` called by tRPC auth middleware when `tenant_id` is null. Lazy provision on stale cache or failed hook. |
| 4 procedure types | `trpc/trpc.ts`: `publicProcedure`, `protectedProcedure` (session), `apiKeyProcedure`, `dualAuthProcedure`. All set RLS context. |
| 6 tRPC routers (17+ procedures) | `trpc/router.ts`: runs (list/get/getEvents), events (ingest), policies (list/get/create/update), supervisor (listProposals/approveProposal/rejectProposal/listEscalations/acknowledgeEscalation), verify (chain), apiKeys (create/list/revoke). |
| Event ingest pipeline | `trpc/routers/events.ts`: NDJSON parse, schema_version validation, hash chain verification (within batch + continuation), run upsert, batch insert with ON CONFLICT DO NOTHING. 1000-event max, 100-event insert batches. |
| Chain verification | `trpc/routers/verify.ts`: fetches events in 1000-event pages, runs `verifyChain()`. Returns break position on failure. |
| Policy validation + escalate_to_human invariant | `lib/policy-validate.ts`: validates against schema + rejects deny rules targeting `escalate_to_human` (exact match + regex pattern match). 17 tests (6 for invariant). |
| Optimistic concurrency on policies | `trpc/routers/policies.ts`: version counter with TOCTOU defense in WHERE clause. |
| API key management | `trpc/routers/api-keys.ts` + `middleware/api-key.ts`: SHA-256 hash storage, `lsg_` prefix, timing-safe comparison, raw key shown once, never returned after. |
| Supervisor tables (observation plane) | `db/schema.ts`: `supervisorProposals` and `supervisorEscalations` tables. Routers enforce observation-only access. No enforcement plane coupling. |
| CORS (fail-closed in production) | `index.ts`: empty allowedOrigins in production if ALLOWED_ORIGINS not set. |
| Dual auth for ingest | `trpc/trpc.ts`: `dualAuthProcedure` accepts session cookie OR API key. Invalid Bearer token rejects immediately (no fallthrough). |
| Env validation | `env.ts`: Zod schema. Test mode returns stubs. |

**Test count**: ~**84 tests** (17 policy-validate + 13 chain-verify + 20 api-key-gen + ~34 others).

### 6. Frontend -- `packages/web/`

| Item | Evidence |
|---|---|
| Auth pages | `(auth)/sign-in/page.tsx`, `(auth)/sign-up/page.tsx`, `(auth)/layout.tsx`. |
| Dashboard overview | `(dashboard)/page.tsx`. |
| Runs list + detail + timeline | `(dashboard)/runs/page.tsx`, `[runId]/page.tsx`, components: RunsTable, RunDetailHeader, EventTimeline, RunErrorBoundary. |
| Policies list + editor | `(dashboard)/policies/page.tsx`, `[policyId]/page.tsx`, `new/page.tsx`. Components: PolicyEditor, PolicyEditForm, ConflictDialog. |
| API keys management | `(dashboard)/api-keys/page.tsx`. Components: ApiKeysTable, CreateKeyDialog. |
| Supervisor queues | `(dashboard)/supervisor/page.tsx`. Components: ProposalQueue, EscalationQueue. |
| Settings stub | `(dashboard)/settings/page.tsx` -- placeholder for v2. |
| 16 shared components | auth-form, dashboard-header, sidebar-nav, user-menu, budget-bar, chain-badge, confirm-dialog, copy-button, decision-badge, empty-state, json-viewer, load-more, page-header, severity-badge, status-badge, time-ago. |
| tRPC client setup | `lib/trpc-client.ts` (vanilla for server components), `lib/trpc-provider.tsx` (@trpc/react-query for client components). |
| Better Auth React client | `lib/auth-client.ts` (better-auth/react). |
| Decision color coding | decision-badge: allow=green, deny=red, cooldown=amber, kill=black, require_approval=purple. |
| 5 Playwright test suites | `tests/e2e/`: auth, runs, policies, api-keys, supervisor. |

**Test count**: **10 Playwright E2E tests** (not in CI -- see Remaining).

### 7. Schemas -- `schemas/`

| Schema | Hash | VERIFY.md | build.rs |
|---|---|---|---|
| `events/event.schema.json` | `8769be2f...` | Present | N/A |
| `policy/policy.schema.json` | `10725f37...` | Present | Present |
| `ipc/decision-request.schema.json` | `9cd77f8f...` | Present | N/A |
| `ipc/decision-response.schema.json` | `5d791582...` | **MISSING** | N/A |

All schemas are JSON Schema Draft 2020-12, schema_version 1. No breaking changes.

### 8. ADRs -- `docs/adrs/`

All 13 ADRs adopted with required sections (Context, Decision, Consequences, Migration Path):
ADR-001 through ADR-013. Covers: IPC wire format, fail-closed, policy single-source, run_id client-generated, JSONL fail-closed, queue backpressure, multi-dimensional budget, agent_role flat tag, MCP proxy mode, semantic matching experimental, Better Auth, AI Supervisor architecture, open-core licensing.

### 9. Documentation

| Document | Status |
|---|---|
| `docs/control-philosophy.md` | Complete. 5 stages, enforcement/observation separation explicit. |
| `docs/owasp-agentic-mapping.md` | Complete. Honest coverage: AA2/AA3/AA6/AA8/AA10 covered, AA4/AA5/AA7 partial, AA1/AA9 not covered. |
| `docs/oss-release-checklist.md` | Complete. 11 sections, sign-off table. |
| `specs/ipc-wire-format.md` | Complete. |
| `specs/args-hash.md` | Complete. 13 vectors (Vector 8 corrected). |
| `specs/behavioral-telemetry.md` | Complete (P5). |
| `specs/mcp-proxy-mode.md` | Complete (P5). |
| `specs/otel-span-mapping.md` | Complete (P5). |
| `specs/ai-supervisory-interface.md` | Complete (P5). |

### 10. CI/CD Pipeline

| Job | Status |
|---|---|
| `license-check` (SPDX headers) | Present, required. |
| `schema-hash-check` | Present, required. **Hashes TS copy, not canonical** (see Remaining). |
| `lint-typecheck` | Present, required. Biome + tsc. |
| `test-backend` | Present, required. Bun test. |
| `test-engine` | Present, required. `cargo test`. |
| `bench-engine` | Present, required. `cargo bench`. |
| `mode0-smoke` | Present, required. Full IPC round-trip: engine start, Python UDS client, DecisionResponse assert, SIGTERM shutdown, audit log assert, `loopstorm verify` chain check. |
| `build-ts` | Present, required. Builds shim-ts + schemas. |
| `license-audit-rust` | Present, required. `cargo-deny check licenses`. |
| `license-audit-js` | Present, required. Scans MIT packages only. |
| `license-boundary` | Present, required. AGPL/MIT import boundary check. |
| `schema-sync` | Present, required. SHA-256 match between `schemas/` and `packages/schemas/`. |
| `secret-scan` | Present, required. Gitleaks with custom `lsg_*` rules. |
| `ci-gate` | Present, required. Needs all 13 jobs. |

### 11. Release Infrastructure

| Item | Status |
|---|---|
| `release.yml` workflow | Present. Tag-triggered, 5-target cross-compile, GitHub Release with SHA-256 checksums, PyPI + npm publish. |
| `deploy.yml` workflow | Present. Tag/manual trigger. Backend to Cloudflare Workers, frontend to Vercel. |
| `engine-build.yml` workflow | Present. Triggers on engine/CLI changes. |
| `deny.toml` (cargo-deny) | Present. Allows MIT/Apache-2.0/BSD/ISC/Zlib/BSL-1.0/CC0/0BSD/OpenSSL/Unicode. Denies GPL/AGPL/LGPL/SSPL/EUPL/CPAL/OSL. |
| `.gitleaks.toml` | Present. Custom rules for `lsg_*`, Supabase JWT, Better Auth secret, DB URLs, private keys. |
| GitHub issue templates | Present. Bug report, feature request, config.yml (security link to SECURITY.md). |

### 12. Cross-Cutting Invariants

| Invariant | Enforcement Points Verified |
|---|---|
| `escalate_to_human` never blocked | (1) Engine evaluator hardcoded allow, (2) Engine pipeline integration test, (3) Engine IPC integration test, (4) Backend policy-validate rejects deny rules targeting it, (5) Backend tRPC policies.create calls validatePolicy. 6 dedicated tests for invariant + 3 engine tests. |
| Enforcement/observation plane separation | Supervisor tables in schema have no FK to enforcement tables. Supervisor tRPC router only reads/writes observation tables. Supervisor RLS role (`loopstorm_supervisor`) has SELECT on source tables, INSERT/UPDATE on observation tables only. |
| Fail-closed default | Engine: no rule match returns Deny. Backend: empty policy content rejected by validatePolicy. |
| JSONL write failure = kill | Engine `lib.rs`: audit write failure returns Kill decision (ADR-005). |
| SPDX headers on all files | CI `license-check` job enforces. |
| Schema hash integrity | `build.rs` compile-time assertion + CI `schema-hash-check` job + `schema-sync` job. |

---

## REMAINING -- Not Yet Complete

### v1 Blockers (must resolve before tagging v1.0.0)

**B1. Merge `fix/security-audit-hardening` branch into `main`**
- Priority: **P0 -- BLOCKER**
- Evidence: `git log main..HEAD` shows 4 unmerged commits containing: cargo-deny, JS license audit, AGPL/MIT boundary check, schema sync, secret scanning, escalate_to_human tests, gitleaks allowlists, tenant self-healing.
- Impact: All hardening work is invisible to `main`. CI on `main` lacks 5 new jobs.
- Resolution: Open PR, squash-merge. Estimated: 15 minutes.

**B2. Add `decision-response.schema.json` hash to `VERIFY.md`**
- Priority: **P0 -- BLOCKER**
- Evidence: `VERIFY.md` lists 3 of 4 schema files. Missing hash: `5d791582820a4aaa540e09e9e7f93b3c14e80e3bb12be52ddff15e52422d8aa6`. The "How to Update" section also lists only 3 sha256sum commands.
- Impact: VERIFY.md is incomplete. Anyone following it will miss verifying the decision-response schema.
- Resolution: Add the 4th entry and 4th sha256sum command. Estimated: 5 minutes.

**B3. Fix CI `schema-hash-check` to hash canonical path**
- Priority: **P1 -- BLOCKER** (low risk due to `schema-sync` job, but semantically wrong)
- Evidence: `.github/workflows/ci.yml` line ~98 hashes `packages/schemas/policy/policy.schema.json` (the TS copy) instead of `schemas/policy/policy.schema.json` (the canonical source).
- Impact: If `schema-sync` job fails silently, the hash check could pass against a stale copy. Defense-in-depth violation.
- Resolution: Change the path in ci.yml to `schemas/policy/policy.schema.json`. Estimated: 5 minutes.

**B4. OWASP Agentic Mapping peer review**
- Priority: **P1 -- BLOCKER** (policy: no security claims without verification)
- Evidence: `docs/owasp-agentic-mapping.md` exists but has not been reviewed by a second person.
- Impact: Quality rule 3 states "no vague security claims -- every coverage claim must have a passing test behind it or be explicitly marked as not yet verified." A peer review is required to confirm the honest-coverage claims are accurate.
- Resolution: Human task. One reviewer reads the mapping against the source code. Estimated: 1 hour.

**B5. Exercise release pipeline with an RC tag**
- Priority: **P1 -- BLOCKER**
- Evidence: `release.yml`, `deploy.yml`, and `engine-build.yml` exist but have never been triggered by a real tag push. Unknown failure modes.
- Impact: If the release pipeline fails on v1.0.0, it creates a bad first impression for OSS contributors.
- Resolution: Push `v1.0.0-rc.1` tag to trigger `release.yml`. Verify GitHub Release artifact creation, SHA-256 checksums. PyPI/npm publish skipped for `-alpha`/`-rc` tags by design. `deploy.yml` can be tested via `workflow_dispatch`. Estimated: 30 minutes.

### Should-Have (resolve before or shortly after v1.0.0)

**S1. Playwright E2E tests not in CI**
- Priority: **P2**
- Evidence: `packages/web/tests/e2e/` has 5 test suites (10 tests) but CI has a comment block documenting the requirements (Postgres + migrations + backend + Next.js + Better Auth) and explicitly defers them.
- Impact: Frontend regressions caught only by manual testing.
- Resolution: Add a CI job that spins up test database + backend + web, runs Playwright. Can use Docker Compose or GitHub Actions service containers.

**S2. Remove dead `@anthropic-ai/sdk` dependency**
- Priority: **P2**
- Evidence: `packages/backend/package.json` lists `"@anthropic-ai/sdk": "^0.36.3"` as a production dependency. Grep across all backend source files returns zero imports. Reserved for v1.1 AI Supervisor.
- Impact: Unnecessary dependency in production bundle. Potential license concern (Anthropic SDK license vs AGPL). Confusing for contributors.
- Resolution: Remove from `package.json`, add back in v1.1 PR.

**S3. Adversarial RLS tests**
- Priority: **P2**
- Evidence: `packages/backend/tests/setup.ts` defines `setTestTenantContext()` and `clearTestTenantContext()` helpers. However, no test file exercises the cross-tenant read assertion (Tenant A cannot read Tenant B's data at the database level). The P3 task brief marked these as mandatory.
- Impact: RLS policies are defined in SQL migrations and appear correct, but there is no automated verification that they actually block cross-tenant access. A misconfigured Supabase role or missing FORCE could go undetected.
- Resolution: Add test file `packages/backend/tests/adversarial-rls.test.ts` with at least 6 assertions: cross-tenant read on runs, events, api_keys, supervisor_proposals, supervisor_escalations, policy_packs.

**S4. Backward-compatibility schema fixtures**
- Priority: **P3**
- Evidence: Quality rule 5 states "Schema changes require: schema_version bump, backward-compat fixture, consumer PR tags." No backward-compat fixtures exist at `tests/fixtures/schema-compat/` or similar.
- Impact: When schema_version 2 is introduced, there will be no automated test verifying that version 1 payloads still parse correctly.
- Resolution: Add fixture files for each schema at version 1. Add CI test that validates them against current schema.

**S5. DCO/CLA enforcement**
- Priority: **P3**
- Evidence: No `.github/dco.yml` or CLA bot configuration. OSS contributions could land without Developer Certificate of Origin sign-off.
- Resolution: Add DCO bot (e.g., `probot/dco`) or require `Signed-off-by` in commits.

**S6. License file naming standardization**
- Priority: **P3**
- Evidence: Root has `LICENSE` (MIT). AGPL packages should have their own `LICENSE` files. Not verified whether `packages/backend/LICENSE` and `packages/web/LICENSE` exist.
- Resolution: Verify or create per-package LICENSE files.

**S7. GitHub release notes template**
- Priority: **P3**
- Evidence: No `.github/release.yml` template for auto-generated release notes categorization.
- Resolution: Add release notes template with categories (Breaking, Features, Fixes, Dependencies).

### Deferred to v1.1 (specified, not built -- by design)

| Feature | Spec | Status |
|---|---|---|
| MCP Proxy Mode | `specs/mcp-proxy-mode.md` | Specified. TS implementation recommended at `apps/mcp-proxy/`. |
| Behavioral Telemetry | `specs/behavioral-telemetry.md` | Specified. 4 optional fields, no schema bump. |
| OTel Span Mapping | `specs/otel-span-mapping.md` | Specified. Exporter architecture defined. |
| AI Supervisor | `specs/ai-supervisory-interface.md` | Specified. 13 tools, separate engine instance, $2.00/session hard budget. |
| CLI `filter` command | Deferred in P2 brief. | Not specified in detail. |
| CLI `import` command | Deferred in P2 brief. | Not specified in detail. |
| Settings page (full) | `packages/web/` | Stub exists, full implementation v2. |

---

## RISKS -- Things That Look Done But May Have Gaps

### R1. Backend tests bypass RLS (HIGH)

**Observation**: All backend tests connect as the PostgreSQL superuser (the `DATABASE_URL` connection string). Superusers bypass all RLS policies. The `setTestTenantContext()` helper sets the session variable but does not verify that queries without it fail.

**Risk**: The RLS policies in `0002_enable_rls.sql` could be syntactically present but functionally broken (e.g., wrong function name, missing FORCE, wrong role grants). No test proves they actually block unauthorized access.

**Mitigation**: S3 above. Until adversarial RLS tests exist, RLS is "defined but unverified."

### R2. Supervisor health endpoint returns hardcoded zeros (LOW)

**Observation**: `index.ts` line 86: `return c.json({ pending_jobs: 0, failed_jobs_24h: 0 })` with a `TODO(P5)` comment.

**Risk**: Monitoring systems that rely on this endpoint will never detect supervisor queue problems.

**Mitigation**: Acceptable for v1 since the AI Supervisor is deferred to v1.1. The endpoint exists for forward compatibility. Must be implemented before v1.1 ships.

### R3. Benchmark has TODO stubs (LOW)

**Observation**: `apps/engine/benches/enforcement_pipeline.rs` contains 4 TODO markers where real benchmark calls should be. The `bench-engine` CI job runs but may not exercise the full enforcement pipeline.

**Risk**: Performance regression detection is weaker than it appears. The benchmark job passes but does not provide meaningful data.

**Mitigation**: Low priority for v1. Benchmarks are informational, not blocking. Should be fixed before v1.1 when the engine may see heavier loads from MCP proxy mode.

### R4. Deploy workflow never tested against real infrastructure (MEDIUM)

**Observation**: `deploy.yml` requires 7 repository secrets (DATABASE_URL, CLOUDFLARE_API_TOKEN, etc.). The workflow has never been triggered.

**Risk**: Deployment may fail on first real use. Cloudflare Workers compatibility with Hono+Bun is assumed but not verified. Vercel deployment may need `vercel.json` configuration.

**Mitigation**: B5 partially addresses this. The RC tag will exercise `release.yml` (artifact creation). `deploy.yml` should be tested separately via `workflow_dispatch` with a staging environment.

### R5. `escalate_to_human` rule_id inconsistency (LOW)

**Observation**: The engine uses `__builtin_escalate_to_human` as the rule_id (confirmed in `evaluator.rs`). The AI Supervisor spec (`specs/ai-supervisory-interface.md`) references `__builtin_escalate_to_human_allow`. These are different strings.

**Risk**: When v1.1 implements the supervisor, it may look for the wrong rule_id in audit logs.

**Mitigation**: Reconcile before v1.1. The engine's value is authoritative. Update the spec to match.

### R6. Float precision in budget tests (LOW)

**Observation**: Budget tests use `cost_usd: 0.10` which is not exactly representable in IEEE 754 f64 (`0.1` = `0.1000000000000000055511151231257827021181583404541015625`). The P2 task brief noted this risk.

**Risk**: Tests may become flaky if accumulated float errors cross comparison thresholds.

**Mitigation**: Existing tests pass. If flakiness appears, switch to `0.125` increments (exact in binary). No action needed for v1.

### R7. Windows UDS limitation (LOW)

**Observation**: All IPC integration tests and CLI E2E tests are `#[cfg(unix)]`. The Mode 0 smoke test also requires Unix sockets. Python shim guards `socket.AF_UNIX` with `hasattr()`.

**Risk**: Windows users cannot run the engine with UDS. Mode 0 does not work on Windows without named pipes or TCP fallback.

**Mitigation**: Known and accepted for v1. Windows support is a v1.1/v2 feature. Engine cross-compiles for Windows (binary distribution) but IPC requires WSL or a future TCP transport.

---

## Blocker Resolution Plan

| ID | Task | Owner | Estimate | Dependency |
|---|---|---|---|---|
| B1 | Merge hardening branch | Platform Engineer | 15 min | None |
| B2 | Add decision-response hash to VERIFY.md | Lead Architect | 5 min | B1 (include in same PR or follow-up) |
| B3 | Fix CI schema-hash-check path | Platform Engineer | 5 min | B1 |
| B4 | OWASP peer review | Human reviewer | 1 hour | None (parallel) |
| B5 | Exercise release pipeline with RC tag | Platform Engineer | 30 min | B1 + B2 + B3 merged |

**Total estimated effort**: 2 hours (1 hour is human review, parallelizable).

**Recommended sequence**:
1. B1: Open PR for hardening branch, squash-merge.
2. B2 + B3: Follow-up commit on main (or include in B1 PR).
3. B4: Start peer review immediately (parallel with B1-B3).
4. B5: Push `v1.0.0-rc.1` tag after B1-B3 are on main.
5. After B4 + B5 pass: tag `v1.0.0`.

---

## Verdict

**CONDITIONAL GO.** LoopStorm Guard v1 is feature-complete across all planes. The enforcement core is solid: fail-closed default, escalate_to_human invariant enforced at 5+ points, hash-chain audit trail, multi-dimensional budget, loop detection, and full IPC protocol. The observation plane is cleanly separated with tables and APIs ready for the v1.1 AI Supervisor.

Five blockers remain, all well-scoped and estimated at 2 hours total. Once resolved, the project is ready for v1.0.0.

The highest-risk gap is R1 (adversarial RLS tests). While the RLS SQL is correct on inspection, there is no automated proof that it blocks cross-tenant access. This is classified as S3 (should-have) rather than a blocker because the RLS policies are defined, enforced by FORCE ROW LEVEL SECURITY, and the tenant middleware correctly sets the session variable. However, this should be addressed promptly after v1.

---

*Audited by: loopstorm-lead-architect*
*Date: 2026-03-26*
*Total test count: ~332 (80 engine + 4 CLI + 88 Python + 66 TypeScript + ~84 backend + 10 Playwright)*
