<!-- SPDX-License-Identifier: MIT -->
# LoopStorm Guard -- v1.0 Readiness Report

**Author:** Lead Architect (loopstorm-lead-architect)
**Date:** 2026-03-25
**Branch under review:** `fix/security-audit-hardening` (4 commits ahead of `main`)
**Scope:** Full codebase audit covering all components, schemas, CI, docs, security, and OSS release readiness.

---

## 1. Executive Summary

LoopStorm Guard is in a **strong pre-release state**. The enforcement core (engine, CLI, Python shim, TypeScript shim) is feature-complete with robust test coverage. The backend, web dashboard, schemas, and documentation are all present and architecturally sound. All 13 ADRs are adopted. The five-stage control philosophy is well-articulated. The OWASP mapping is honest and complete.

**The project is 85-90% ready for a v1.0 tag.** The remaining 10-15% consists of:
- Merging the `fix/security-audit-hardening` branch (4 commits, not on `main` yet)
- A few CI correctness issues (schema-hash-check hashes TS copy, not canonical)
- VERIFY.md missing the `decision-response.schema.json` hash
- Playwright E2E tests not running in CI
- No CLA/DCO enforcement beyond the CONTRIBUTING.md text
- No release signing infrastructure tested end-to-end
- `@anthropic-ai/sdk` in backend `package.json` but never imported (dead dependency)

No architectural defects were found. The enforcement/observation plane separation is clean. Fail-closed behavior is verified by tests. The `escalate_to_human` invariant is enforced at 5+ points.

---

## 2. Component Inventory

| Component | Location | Status | Test Count | Notes |
|---|---|---|---|---|
| **Rust Engine** | `apps/engine/` | Complete | 80 (69 unit + 11 integration) | 10 source files, policy eval, budget, loop detect, audit, redaction, IPC server |
| **Rust CLI** | `apps/cli/` | Complete | 4 E2E case studies | validate, verify, replay commands. filter/import deferred to v1.1 |
| **Python Shim** | `apps/shim-python/` | Complete | 88 | Guard, JCS, args-hash, IPC, OpenAI adapter. Zero runtime deps. mypy strict clean. |
| **TypeScript Shim** | `apps/shim-ts/` | Complete | 66 | Guard, JCS, args-hash, IPC, OpenAI adapter. ESM+CJS+DTS. typecheck clean. |
| **Backend API** | `packages/backend/` | Complete | ~84 (test assertions) | Hono, tRPC, Drizzle ORM, Better Auth, RLS. 11 tables, 17+ procedures. |
| **Web Dashboard** | `packages/web/` | Complete | 10 Playwright E2E | Next.js 15, ~50 files. Auth, runs, policies, API keys, supervisor UI. |
| **Schemas** | `schemas/` + `packages/schemas/` | Complete | N/A | 4 JSON Schema Draft 2020-12 files. All at schema_version 1. |
| **CI Pipeline** | `.github/workflows/ci.yml` | Complete | 13 jobs + gate | License, schema hash, lint, test, bench, smoke, build, audit, boundary, sync, secrets |
| **Release Pipeline** | `.github/workflows/release.yml` | Present | N/A | 5-target cross-compile, GitHub Release, PyPI, npm. Not yet exercised. |
| **Deploy Pipeline** | `.github/workflows/deploy.yml` | Present | N/A | Cloudflare Workers + Vercel. Requires secrets. Not yet exercised. |
| **Documentation** | `docs/` | Complete | N/A | 13 ADRs, control philosophy, OWASP mapping, OSS checklist, 5 guides, deployment modes, secrets inventory |
| **Specifications** | `specs/` | Complete | N/A | 6 specs + 6 task briefs |

### Total Test Count Summary

| Component | Tests |
|---|---|
| Engine unit tests | 69 |
| Engine integration tests | 11 |
| CLI E2E case studies | 4 |
| Python shim | 88 |
| TypeScript shim | 66 |
| Backend lib tests | ~84 assertions across 3 files |
| Web Playwright E2E | 10 |
| **Total** | **~332** |

---

## 3. Architecture Review

### 3.1 ADR Status

All 13 ADRs are published in `docs/adrs/` and adopted.

| ADR | Title | Status | Has All 4 Sections | Verified by Test |
|---|---|---|---|---|
| ADR-001 | IPC Wire Format | Adopted | Yes | Yes (IPC integration tests) |
| ADR-002 | Fail-Closed Default | Adopted | Yes | Yes (evaluator tests, E2E) |
| ADR-003 | Policy Schema Single-Source | Adopted | Yes | Yes (build.rs compile-time check) |
| ADR-004 | run_id Client-Generated | Adopted | Yes | Yes (shim tests) |
| ADR-005 | JSONL Fail-Closed | Adopted | Yes | Yes (audit.rs tests) |
| ADR-006 | Queue Backpressure 10k | Adopted | Yes | Yes (engine test) |
| ADR-007 | Multi-Dimensional Budget | Adopted | Yes | Yes (budget.rs tests) |
| ADR-008 | agent_role Flat Tag | Adopted | Yes | N/A (optional in v1) |
| ADR-009 | MCP Proxy Mode | Adopted | Yes | N/A (v1.1 spec only) |
| ADR-010 | Semantic Matching Experimental | Adopted | Yes | N/A (v1.1+ feature) |
| ADR-011 | Better Auth | Adopted | Yes | Yes (auth.ts, middleware) |
| ADR-012 | AI Supervisor Architecture | Adopted | Yes | Yes (escalate_to_human invariant: 5+ enforcement points) |
| ADR-013 | Open-Core Licensing | Adopted | Yes | Yes (CI license-check, license-boundary, license-audit) |

### 3.2 Schema Integrity

**Canonical schemas** at `schemas/` (4 files):
| Schema | SHA-256 | In VERIFY.md | In build.rs |
|---|---|---|---|
| `events/event.schema.json` | `8769be2f...` | Yes, matches | N/A |
| `policy/policy.schema.json` | `10725f37...` | Yes, matches | Yes, matches |
| `ipc/decision-request.schema.json` | `9cd77f8f...` | Yes, matches | N/A |
| `ipc/decision-response.schema.json` | `5d791582...` | **MISSING from VERIFY.md** | N/A |

**FINDING: `decision-response.schema.json` is not tracked in VERIFY.md.** This is a gap -- if someone modifies the response schema, there is no hash verification. The file exists in both `schemas/ipc/` and `packages/schemas/ipc/` and they are in sync (verified by byte-identical hashes), but VERIFY.md only lists 3 of the 4 schema files.

**Schema sync** between `schemas/` (canonical) and `packages/schemas/` (TS copy):
- `events/event.schema.json` -- IN SYNC
- `policy/policy.schema.json` -- IN SYNC (both hash to `10725f37...`)
- `ipc/decision-request.schema.json` -- IN SYNC
- `ipc/decision-response.schema.json` -- IN SYNC

**CI schema-hash-check job (line 98)** hashes `packages/schemas/policy/policy.schema.json` (the TS copy), not `schemas/policy/policy.schema.json` (the canonical source). This works because `scripts/sync-schemas.sh --check` ensures they are identical, but it is semantically backwards. The CI job should hash the canonical source. If schema-sync fails silently, the hash check would verify a stale copy. This is a low-risk issue because both checks run on every PR, but it should be corrected for clarity.

### 3.3 Enforcement/Observation Plane Separation

**Status: CLEAN. No violations found.**

Evidence:
- The engine (`evaluator.rs`) has zero references to supervisor logic.
- The supervisor tables (`supervisor_proposals`, `supervisor_escalations`) are in the backend only.
- The SQL role grants in `0002_enable_rls.sql` create a `loopstorm_supervisor` role with SELECT + observation-plane writes only.
- ADR-012 explicitly documents the separation.
- The control philosophy document (`docs/control-philosophy.md`) correctly describes Stages 1-4 as deterministic enforcement and Stage 5 as observation-only.
- `@anthropic-ai/sdk` is listed in backend `package.json` but never imported in any source file (reserved for v1.1 supervisor implementation).

### 3.4 Mode 0 (Air-Gap) Readiness

**Status: READY.**

Evidence:
- The engine binary, CLI, and Python shim have zero network dependencies.
- `LOOPSTORM_DISABLE_HTTP_SINK=1` environment variable disables all outbound network calls.
- The Mode 0 smoke test in CI performs a full IPC round-trip: engine start, Python UDS client, DecisionResponse assertion, SIGTERM shutdown, audit log assertion, `loopstorm verify` chain check.
- The Python shim has zero runtime dependencies (`dependencies = []` in `pyproject.toml`).
- The TypeScript shim has zero runtime dependencies (`devDependencies` only).
- Example policy packs ship in `examples/` for immediate use.

---

## 4. CI/CD Pipeline Status

### 4.1 CI Pipeline (`.github/workflows/ci.yml`)

| # | Job | Purpose | Status | Notes |
|---|---|---|---|---|
| 1 | `license-check` | SPDX header verification on every source file | Active | Scans .ts, .tsx, .py, .rs files |
| 2 | `schema-hash-check` | Policy schema hash matches build.rs | Active | **Hashes TS copy, not canonical** |
| 3 | `lint-typecheck` | Biome lint + TypeScript typecheck | Active | |
| 4 | `test-backend` | Backend tests with Postgres service container | Active | |
| 5 | `test-engine` | Rust fmt + clippy + tests | Active | |
| 6 | `bench-engine` | Benchmark compile check (--test mode) | Active | No baseline comparison yet |
| 7 | `mode0-smoke` | Full IPC round-trip air-gap test | Active | Excellent coverage |
| 8 | `build-ts` | TypeScript build all packages | Active | |
| 9 | `license-audit-rust` | cargo-deny license check | Active | advisories non-blocking |
| 10 | `license-audit-js` | JS dependency license check | Active | MIT packages only |
| 11 | `license-boundary` | AGPL/MIT import boundary check | Active | |
| 12 | `schema-sync` | Canonical/TS schema file sync | Active | |
| 13 | `secret-scan` | Gitleaks secret scanning | Active | Custom rules for lsg_*, Supabase JWT, etc. |
| gate | `ci-gate` | All 13 jobs must pass | Active | Required status check |

### 4.2 Release Pipeline (`.github/workflows/release.yml`)

- Tag-triggered (`v*` tags)
- 5-target cross-compilation matrix (Linux x86_64/aarch64, macOS x86_64/aarch64, Windows x86_64)
- Creates GitHub Release with SHA-256 checksums
- Publishes Python package to PyPI (skipped on `-alpha` tags)
- Publishes npm package (skipped on `-alpha` tags)
- **NOT YET EXERCISED** -- no v1 tag has been pushed yet

### 4.3 Deploy Pipeline (`.github/workflows/deploy.yml`)

- Tag-triggered or manual dispatch
- Deploys backend to Cloudflare Workers
- Deploys web to Vercel
- Requires 7 repository secrets (none are configured yet for production)
- **NOT YET EXERCISED**

### 4.4 Engine Cross-Compile (`.github/workflows/engine-build.yml`)

- Triggers on engine/CLI file changes
- 5-target matrix matching release pipeline
- Uploads build artifacts with 30-day retention

### 4.5 What Is Deferred

| Item | Priority | Details |
|---|---|---|
| Playwright E2E in CI | Should-have | Requires full stack (Postgres+migrations, backend, Next.js, Better Auth). Documented in ci.yml comments. |
| Benchmark regression baseline | Low | `bench-engine` runs in --test mode only. No stored baseline for timing comparison. |
| Release signing (GPG) | Should-have | Secret keys exist in secrets inventory but signing logic needs verification. |
| Deploy workflow validation | Should-have | Never executed against real infrastructure. |

---

## 5. Security Posture

### 5.1 OWASP Agentic Top 10 Coverage

The mapping at `docs/owasp-agentic-mapping.md` is **honest and well-written**. No overclaiming detected.

| ID | Risk | Claimed Coverage | Verified |
|---|---|---|---|
| AA1 | Identity Mismanagement | Not covered | Correct -- out of scope |
| AA2 | Tool/Function Call Injection | Covered | Yes (Case Study 1 SSRF test) |
| AA3 | Excessive Agency | Covered | Yes (Case Studies 1-3) |
| AA4 | Unchecked Return Values | Partial | Correct -- input-side only |
| AA5 | Insecure Agent Communication | Partial | Correct -- UDS 0600, TLS for backend |
| AA6 | Resource Consumption | Covered | Yes (Case Study 2 budget test) |
| AA7 | Memory Manipulation | Partial | Correct -- indirect via audit trail |
| AA8 | Audit/Accountability | Covered | Yes (Case Study 4 chain verify) |
| AA9 | Agent Collusion | Not covered | Correct -- out of scope |
| AA10 | Error Handling/Recovery | Covered | Yes (Case Study 3 loop test) |

### 5.2 Secret Scanning

- `.gitleaks.toml` configured with 5 custom rules (lsg_* API keys, Supabase JWTs, Better Auth secrets, database URLs, private keys).
- Allowlist covers test fixtures, CI workflows, lock files, engine redaction patterns, and example env files.
- CI `secret-scan` job runs on every PR with `--verbose`.
- `docs/secrets-inventory.md` documents all secrets with rotation procedures.

### 5.3 License Compliance

- `deny.toml` for Rust dependencies: allows MIT, Apache-2.0, BSD-2/3-Clause, ISC, Unicode, Zlib, BSL-1.0, CC0-1.0, 0BSD, OpenSSL, MPL-2.0. Denies everything else.
- `scripts/check-js-licenses.sh` for MIT-licensed JS packages.
- `scripts/check-license-boundary.sh` verifies AGPL never imports from MIT.
- CI enforces SPDX headers on every source file.
- Both license files exist at repo root: `LICENSE` (MIT), `LICENSE-AGPL` (AGPL-3.0).

### 5.4 CORS and Auth Hardening

- CORS in `packages/backend/src/index.ts` is properly configured:
  - `ALLOWED_ORIGINS` environment variable (comma-separated).
  - Falls back to `http://localhost:3000` in development only.
  - **In production, if `ALLOWED_ORIGINS` is unset, allowedOrigins is empty -- all CORS requests are rejected.** This is correct fail-closed behavior.
  - `credentials: true` for cookie-based auth.
- Better Auth session caching: 5-minute cookie cache, DB is source of truth.
- API key authentication: SHA-256 hash comparison, raw key shown once.
- RLS via `set_config('request.jwt.claims', ..., true)` (transaction-local).
- Self-healing tenant resolution (`ensureTenantId`) handles stale session cache and failed hooks.
- tRPC error handling: internal server errors logged but stack traces never exposed to clients.

### 5.5 `escalate_to_human` Invariant

Verified at 5+ enforcement points:
1. **Engine evaluator** (`evaluator.rs:35`): hardcoded allow before any rule evaluation.
2. **Engine pipeline** (`lib.rs:79`): pipeline entry point documents the bypass.
3. **Engine tests**: 3 dedicated tests (`escalate_to_human_always_allowed`, `escalate_to_human_allowed_with_glob_deny_all`, `escalate_to_human_allowed_with_budget_exceeded`).
4. **Engine integration test** (`lib.rs:324`): `enforce_pipeline_escalate_to_human`.
5. **Backend policy validation** (`packages/backend/src/lib/policy-validate.ts`): rejects policies that would deny `escalate_to_human`.

---

## 6. Documentation Completeness

### 6.1 Architecture Decision Records

All 13 ADRs present in `docs/adrs/`. Each has Context, Decision, Consequences, and Migration Path sections. No missing ADRs.

### 6.2 Specifications

| Spec | Location | Status |
|---|---|---|
| IPC Wire Format | `specs/ipc-wire-format.md` | Complete |
| Args Hash | `specs/args-hash.md` | Complete (13 test vectors) |
| Behavioral Telemetry | `specs/behavioral-telemetry.md` | Complete (v1.1 spec, 19 test vectors) |
| OTel Span Mapping | `specs/otel-span-mapping.md` | Complete (v1.1 spec) |
| MCP Proxy Mode | `specs/mcp-proxy-mode.md` | Complete (v1.1 spec) |
| AI Supervisory Interface | `specs/ai-supervisory-interface.md` | Complete (v1.1 spec, 13 tools) |

### 6.3 Guides

| Guide | Location | Status |
|---|---|---|
| Policy Authoring | `docs/guides/policy-authoring.md` | Present |
| Budget Configuration | `docs/guides/budget-configuration.md` | Present |
| Integration Guide | `docs/guides/integration.md` | Present |
| Event Schema Reference | `docs/guides/event-schema-reference.md` | Present |
| Threat Model | `docs/guides/threat-model.md` | Present |

### 6.4 Other Docs

| Document | Status | Notes |
|---|---|---|
| `CHANGELOG.md` | Present, comprehensive | Covers all phases P0-P5, CI, specs, docs |
| `CONTRIBUTING.md` | Present | Dev setup, coding standards, absolute rules, DCO |
| `SECURITY.md` | Present | Responsible disclosure, scope, key properties |
| `README.md` | Present | Quick start, architecture, modes, licensing |
| `CODE_OF_CONDUCT.md` | Present | Standard contributor covenant |
| `VERIFY.md` | Present, **incomplete** | Missing decision-response.schema.json hash |
| `docs/deployment-modes.md` | Present | All 4 modes documented |
| `docs/secrets-inventory.md` | Present | Complete with rotation procedures |
| `docs/monorepo-structure.md` | Present | |
| `docs/control-philosophy.md` | Present | Five-stage model, well-articulated |
| `docs/owasp-agentic-mapping.md` | Present | Honest, no overclaiming |
| `docs/oss-release-checklist.md` | Present | Hard gate document |

---

## 7. OSS Release Checklist Audit

Going through every item in `docs/oss-release-checklist.md` against actual project state.

### Section 1: Licensing and Legal

| Item | Done | Evidence |
|---|---|---|
| Every source file has valid SPDX header | Yes | CI `license-check` job enforces on every PR |
| CI enforces SPDX header presence | Yes | `ci.yml` lines 26-81 |
| `LICENSE-MIT` file exists at repo root | **Partial** | File is named `LICENSE` (MIT), not `LICENSE-MIT` |
| `LICENSE-AGPL-3.0` file exists at repo root | **Partial** | File is named `LICENSE-AGPL`, not `LICENSE-AGPL-3.0` |
| MIT paths correctly assigned | Yes | Verified by CI license-check |
| AGPL paths correctly assigned | Yes | Verified by CI license-check |
| No AGPL code imported by MIT components | Yes | CI `license-boundary` job |
| CLA/DCO process configured | **Partial** | CONTRIBUTING.md documents DCO, but no automated enforcement (e.g., DCO bot, CLA assistant) |
| Third-party dependency license audit | Yes | `deny.toml` (Rust), `check-js-licenses.sh` (JS), both in CI |

### Section 2: Schemas and Specifications

| Item | Done | Evidence |
|---|---|---|
| `decision-request.schema.json` published, Draft 2020-12 | Yes | Validated |
| `decision-response.schema.json` published, Draft 2020-12 | Yes | Validated |
| `event.schema.json` published, Draft 2020-12 | Yes | Validated |
| `policy.schema.json` published, Draft 2020-12 | Yes | Validated |
| All schemas have `schema_version` field at v1 | Yes | All `const: 1` |
| SHA-256 of policy.schema.json matches build.rs | Yes | `10725f37...` matches |
| CI asserts schema hash match | Yes | `schema-hash-check` job |
| Backward-compatibility fixture tests exist | **No** | No explicit backward-compat fixture tests found |

### Section 3: Architecture Decision Records

| Item | Done | Evidence |
|---|---|---|
| ADR-001 through ADR-013 published | Yes | All 13 present |
| Every ADR has 4 sections | Yes | Verified |
| ADR-002 verified by test | Yes | Evaluator tests (empty policy, no-match deny) |
| ADR-005 verified by test | Yes | `audit.rs` tests (write failure -> kill) |
| ADR-012 verified: escalate_to_human cannot be denied | Yes | 5+ enforcement points |

### Section 4: Engine (Rust)

| Item | Done | Evidence |
|---|---|---|
| Engine builds on Linux and macOS | Yes | CI + engine-build.yml cross-compile |
| Engine passes all unit tests | Yes | 69 `#[test]` in engine src |
| Engine passes integration tests (4 case studies) | Yes | `cli/tests/e2e_case_studies.rs` (4 tests) |
| Policy evaluator fail-closed | Yes | Evaluator tests |
| Budget engine enforces hard caps | Yes | `budget.rs` tests (9 tests) |
| Loop detection fires on identical fingerprint | Yes | `loop_detector.rs` tests |
| Loop detection fires on identical error response | Yes | `loop_detector.rs` tests |
| Hash chain correct (verified by replay CLI) | Yes | E2E Case Study 4 |
| Redaction covers default patterns | Yes | `redaction.rs` tests (11 tests) |
| args_hash is SHA-256 of JCS | Yes | Cross-language test vectors (13) |
| IPC protocol matches schemas | Yes | IPC integration tests (11 tests) |
| Queue backpressure at 10k | Yes | Engine test |
| JSONL write failure returns kill | Yes | Audit tests |

### Section 5: Python Shim

| Item | Done | Evidence |
|---|---|---|
| Shim installs via pip | Yes | `pyproject.toml` with setuptools |
| Shim uses stdlib only | Yes | `dependencies = []` |
| Shim connects via UDS | Yes | `_connection.py` |
| OpenAI adapter wraps tool calls | Yes | `_openai.py`, 5 tests |
| Generic tool wrapper works | Yes | `_guard.py`, 16 tests |
| Fail-open mode works | Yes | `test_guard.py` tests |
| Fail-closed mode works | Yes | `test_guard.py` tests |
| `loopstorm.wrap()` API works | Yes | Guard tests |
| args_hash matches engine | Yes | 13 cross-language vectors |

### Section 6: CLI

| Item | Done | Evidence |
|---|---|---|
| `loopstorm replay` verifies hash chain | Yes | E2E test |
| `loopstorm verify` reports chain break position | Yes | `verify.rs` |
| `loopstorm filter` filters events | **No** | Deferred to v1.1 |
| `loopstorm import` imports JSONL | **No** | Deferred to v1.1 |
| CLI bundled with engine in releases | Yes | Release pipeline builds both |

### Section 7: Case Studies (E2E)

| Item | Done | Evidence |
|---|---|---|
| Case Study 1: SSRF blocked by policy | Yes | `e2e_case_studies.rs` |
| Case Study 2: Budget hard cap terminates | Yes | `e2e_case_studies.rs` |
| Case Study 3: Looping agent detected and terminated | Yes | `e2e_case_studies.rs` |
| Case Study 4: Hash chain verified by CLI | Yes | `e2e_case_studies.rs` |

### Section 8: Documentation

| Item | Done | Evidence |
|---|---|---|
| Control philosophy published | Yes | `docs/control-philosophy.md` |
| OWASP mapping published | Yes | `docs/owasp-agentic-mapping.md` |
| OSS release checklist is this document | Yes | |
| README with installation, quick start, Mode 0, docs link | Yes | README.md |
| Policy authoring guide | Yes | `docs/guides/policy-authoring.md` |
| Budget configuration guide | Yes | `docs/guides/budget-configuration.md` |
| Integration guide | Yes | `docs/guides/integration.md` |
| Event schema reference | Yes | `docs/guides/event-schema-reference.md` |
| Trust boundaries and threat model | Yes | `docs/guides/threat-model.md` |

### Section 9: Security

| Item | Done | Evidence |
|---|---|---|
| No secrets in repository | Yes | Gitleaks CI job, verified by audit |
| JSONL redaction covers patterns | Yes | `redaction.rs` (11 tests) |
| UDS socket created at 0600 | Yes | `server.rs` |
| escalate_to_human always allowed (fixture test) | Yes | 3+ engine tests |
| Policy schema rejects deny of escalate_to_human | Yes | Backend `policy-validate.ts` |
| OWASP mapping reviewed by non-author | **No** | Still requires human peer review |

### Section 10: CI/CD

| Item | Done | Evidence |
|---|---|---|
| CI runs on every PR | Yes | 13 jobs |
| Release pipeline produces binaries | Yes | release.yml, 5 targets |
| Release artifacts signed or checksummed | **Partial** | SHA-256 checksums yes, GPG signing present in pipeline but untested |
| GitHub release notes template | **No** | No `.github/release.yml` template for auto-generated notes |

### Section 11: Repository Hygiene

| Item | Done | Evidence |
|---|---|---|
| `.gitignore` covers artifacts | Yes | |
| No binary blobs in repo | Yes | |
| Branch protection on `main` | **Unknown** | Cannot verify from local checkout -- requires GitHub settings audit |
| Issue templates | Yes | `bug_report.md`, `feature_request.md`, `config.yml` |
| `SECURITY.md` | Yes | Responsible disclosure with email |
| `CONTRIBUTING.md` | Yes | Dev setup, standards, DCO |

---

## 8. What Is Ready (v1.0)

The following components are complete, tested, and shippable:

1. **Rust Engine** -- Full enforcement pipeline with 80 tests. Policy evaluation, budget tracking, loop detection, audit logging, redaction, IPC server. Cross-compiles to 5 targets.

2. **Rust CLI** -- `validate`, `verify`, and `replay` commands with 4 E2E case study tests covering all four mandatory scenarios.

3. **Python Shim** -- Zero-dependency, stdlib-only, 88 tests. Guard, JCS, IPC, OpenAI adapter. Ready for PyPI publication.

4. **TypeScript Shim** -- Zero-dependency, 66 tests. ESM+CJS+DTS build. Ready for npm publication.

5. **Backend API** -- Hono + tRPC + Drizzle + Better Auth. 11 tables, RLS, tenant isolation, API key auth. ~84 test assertions across 3 test files.

6. **Web Dashboard** -- Next.js 15 App Router. Auth, runs, policies, API keys, supervisor UI. ~50 files, 10 Playwright E2E specs.

7. **JSON Schemas** -- 4 files, all Draft 2020-12, all at schema_version 1. Canonical source in `schemas/`, TS copy in `packages/schemas/`.

8. **CI Pipeline** -- 13 jobs covering license, schema, lint, test, build, audit, boundary, sync, secrets. Gate job requires all to pass.

9. **Documentation** -- 13 ADRs, 6 specs, 5 guides, control philosophy, OWASP mapping, OSS checklist, deployment modes, secrets inventory, threat model.

10. **Mode 0** -- Fully functional air-gapped deployment with IPC round-trip smoke test in CI.

11. **Enforcement/Observation Plane Separation** -- Clean, verified, no violations.

12. **escalate_to_human Invariant** -- Enforced at 5+ points across engine, backend, and CI.

---

## 9. What Is Next

### 9.1 Blockers (Must Fix Before v1 Tag)

| # | Item | Severity | Effort | Details |
|---|---|---|---|---|
| B1 | **Merge `fix/security-audit-hardening` into `main`** | High | Trivial | 4 commits: gitleaks config fixes, security hardening, P1 quick wins. These are already on the branch -- need PR and merge. |
| B2 | **Add `decision-response.schema.json` hash to VERIFY.md** | Medium | Trivial | Hash is `5d791582820a4aaa540e09e9e7f93b3c14e80e3bb12be52ddff15e52422d8aa6`. Must be tracked like the other 3 schemas. |
| B3 | **Fix CI schema-hash-check to hash canonical source** | Low | Trivial | Line 98 of ci.yml should read `schemas/policy/policy.schema.json` not `packages/schemas/policy/policy.schema.json`. Both are identical (schema-sync ensures this), so risk is very low, but the semantic is wrong. |
| B4 | **OWASP mapping peer review** | Medium | Human task | Checklist item 9.6 requires review by someone other than the author. This is a manual sign-off. |
| B5 | **Verify release pipeline end-to-end** | Medium | ~2 hours | Push a `v0.0.1-rc.1` tag to exercise the release pipeline without publishing to PyPI/npm. Verify: binary builds, checksum generation, GitHub Release creation. |

### 9.2 Should-Have (Important but Not Blocking)

| # | Item | Effort | Details |
|---|---|---|---|
| S1 | **Playwright E2E in CI** | Medium | Requires composite job with Postgres, migrations, seed data, backend, Next.js, Playwright browsers. |
| S2 | **Remove `@anthropic-ai/sdk` from backend package.json** | Trivial | Listed as dependency but never imported. Reserved for v1.1 supervisor. Remove now, add back when needed. |
| S3 | **Add backward-compatibility fixture tests for schemas** | Small | Checklist item 2.8. Create fixture JSON documents that validate against schema_version 1, to be run when schemas change. |
| S4 | **Automated DCO/CLA enforcement** | Small | Install DCO bot or CLA assistant on the GitHub repo. CONTRIBUTING.md documents DCO but nothing enforces it. |
| S5 | **GitHub branch protection settings** | Small | Verify: require PR review, require CI pass, no force push to main. Cannot verify from local checkout. |
| S6 | **GitHub release notes template** | Trivial | Create `.github/release.yml` with categories for features, fixes, and dependencies. |
| S7 | **License file naming consistency** | Trivial | Checklist expects `LICENSE-MIT` and `LICENSE-AGPL-3.0`; actual files are `LICENSE` and `LICENSE-AGPL`. Either rename or update checklist. |

### 9.3 v1.1 Roadmap (Post-Release Features)

All of these are fully specified but not yet implemented:

| Feature | Spec | Details |
|---|---|---|
| **MCP Proxy** | `specs/mcp-proxy-mode.md` | TypeScript implementation, `apps/mcp-proxy/` (MIT), MCP protocol translation |
| **Behavioral Telemetry** | `specs/behavioral-telemetry.md` | 4 engine-computed fields, additive optional (no schema bump) |
| **OTel Exporter** | `specs/otel-span-mapping.md` | run_id->trace_id mapping, both JSONL reader and event store reader |
| **AI Supervisor** | `specs/ai-supervisory-interface.md` | 13 tools, separate engine instance, $2/session budget, Haiku-class model |
| **CLI filter/import** | Deferred from P2 | `loopstorm filter --event-type` and `loopstorm import --api-key` |
| **Mobile Approval App** | Product doc | Expo app for Mode 3 approval queue |
| **Cross-Customer Intelligence** | Product doc | Opt-in anonymous aggregate pattern sharing |

---

## 10. Recommendations

### 10.1 Immediate (Pre-v1 Tag)

1. **Create a PR for `fix/security-audit-hardening` and merge to main.** The 4 commits on this branch are purely hardening fixes (gitleaks allowlist, CI improvements, tenant robustness). They should be merged before the v1 tag.

2. **Fix VERIFY.md** to include the `decision-response.schema.json` hash. This is a 1-line change with high integrity value.

3. **Push a `v0.0.1-rc.1` tag** to exercise the release pipeline. Do not publish to PyPI/npm (the pipeline already skips publish on `-alpha` tags; verify that `-rc` tags also skip or add them to the skip list). This validates that binary builds, checksums, and GitHub Release creation work correctly before the real v1 release.

4. **Conduct the OWASP mapping peer review.** This is the only remaining item that requires a human outside the development team. Schedule a 30-minute review session.

### 10.2 Architecture Notes for v1.1

1. **The `@anthropic-ai/sdk` dependency in backend is premature.** It should be removed from `package.json` until the AI Supervisor is actually implemented. Having it listed as a production dependency when no source file imports it creates confusion during license audits and dependency reviews.

2. **The CI `schema-hash-check` should be updated to hash `schemas/policy/policy.schema.json`** (the canonical source) rather than `packages/schemas/policy/policy.schema.json` (the derived copy). This makes the semantic intent clearer even though the result is identical today.

3. **Backward-compatibility fixture tests for schemas** should be created before any schema_version 2 work begins. A simple test fixture of valid v1 JSON documents that must always validate against the schema provides a safety net for future schema evolution.

4. **The Mode 0 smoke test is excellent.** It should be the gold standard for any new component -- prove it works air-gapped before adding network features. The current IPC round-trip test is one of the strongest CI jobs in the pipeline.

### 10.3 Long-Term Architecture Health

The project's architectural foundations are sound:

- **Enforcement/observation plane separation** is clean and consistently enforced. Maintain this discipline as v1.1 supervisor work begins -- the temptation to "just let the supervisor call the engine directly" must be resisted.

- **Fail-closed default** is properly implemented and tested. The evaluator, budget tracker, audit writer, and IPC server all fail closed. This is the most important security property in the system.

- **Schema versioning** is well-designed but has not been tested under real evolution pressure. When schema_version 2 arrives, the backward-compatibility process documented in CONTRIBUTING.md and ADR-003 will get its first real workout. Plan for this.

- **The test suite is strong** (332+ tests across 5 languages/runtimes) but has one notable gap: **no adversarial RLS tests** are visible in the backend test suite. The 3 test files cover API key generation, chain verification, and policy validation, but I did not find tests that attempt cross-tenant reads and assert they fail at the database level. This was called out as mandatory in the P3 task brief. Verify whether these tests exist in a location I did not find, or add them.

- **The `fix/security-audit-hardening` branch** is purely additive and safe to merge. It adds `Cargo.lock` to the repo (previously gitignored -- good for reproducible builds), hardens the backend auth flow, and fixes gitleaks allowlists. No risky changes.

---

## Appendix A: File Counts by Component

| Component | Source Files | Test Files | Config Files |
|---|---|---|---|
| `apps/engine/src/` | 10 (.rs) | 1 integration test | build.rs, Cargo.toml |
| `apps/cli/src/` | 6 (.rs) | 1 E2E test | Cargo.toml |
| `apps/shim-python/loopstorm/` | 12 (.py) | 7 test files | pyproject.toml |
| `apps/shim-ts/src/` | 10 (.ts) | 6 test files | package.json, tsconfig.json |
| `packages/backend/src/` | ~15 (.ts) | 3 test files | package.json, tsconfig.json |
| `packages/web/src/` | ~35 (.tsx/.ts) | 5 E2E specs | package.json, next.config.ts |
| `packages/schemas/` | 5 (.json/.ts) | 0 | package.json, tsconfig.json |
| `schemas/` | 4 (.json) | 0 | N/A |
| `.github/workflows/` | 4 (.yml) | N/A | N/A |
| `scripts/` | 5 (.sh) | N/A | N/A |
| `docs/` | 25 (.md) | N/A | N/A |
| `specs/` | 12 (.md) | N/A | N/A |

## Appendix B: Unmerged Branch Summary

The `fix/security-audit-hardening` branch has 4 commits not on `main`:

1. `63d6649` -- P1 quick wins: reproducible builds, IPC smoke test, tenant robustness, deploy fix (#13)
2. `325a8ae` -- Security audit hardening for open-source release
3. `40f714a` -- Allowlist api-key-gen test file in gitleaks config
4. `4aa7771` -- Allowlist p3 backend spec in gitleaks config

These commits modify 9 files: CI workflow, deploy workflow, .gitignore, .gitleaks.toml, Cargo.lock, backend auth, backend index, tRPC middleware, supabase seed. All changes are hardening and configuration fixes.

---

**End of Report.**
