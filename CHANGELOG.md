# Changelog

All notable changes to LoopStorm Guard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Engine (Rust) — `apps/engine/`
- Policy evaluator: first-match rule evaluation, glob patterns, conditions
  with 6 operators (equals, not_equals, matches, not_matches, in, not_in)
- Budget tracker: 4-dimension caps (cost_usd, input_tokens, output_tokens,
  call_count) with soft warnings and hard kills
- Loop detector: identical call fingerprint + identical error response
  heuristics, cooldown → kill escalation
- Audit writer: JSONL hash-chain (SHA-256), fail-closed (ADR-005), 0600
  socket permissions
- Redaction: API keys, bearer tokens, JWTs, AWS credentials, configurable
  additional patterns and key-based redaction
- Args hashing: SHA-256 of RFC 8785 JCS canonical JSON
- IPC listener: async UDS/named pipe server, NDJSON framing (64 KiB max),
  30s read timeout, graceful SIGTERM/SIGINT shutdown, stale socket guard
- `escalate_to_human` invariant: engine rejects policies that deny it
- Queue backpressure at 10,000 events (ADR-006)
- 67 unit tests + 11 integration tests

#### CLI (Rust) — `apps/cli/`
- `loopstorm validate <policy.yaml>` — policy file validation
- `loopstorm verify <audit.jsonl>` — hash chain integrity verification
- `loopstorm replay <audit.jsonl>` — pretty-print audit log with chain check
- 4 end-to-end case study tests (SSRF block, budget kill, loop detection,
  chain verify)

#### Python Shim — `apps/shim-python/`
- `Guard` class: `wrap()`, `check()`, `openai()`, context manager
- RFC 8785 JCS canonicalization (custom, stdlib-only)
- SHA-256 args hashing (13 cross-language test vectors)
- NDJSON IPC protocol over UDS/named pipes
- OpenAI adapter (duck-typed, zero runtime dependencies)
- 7 error classes: PolicyDeniedError, CooldownError, RunTerminatedError,
  ApprovalRequiredError, EngineUnavailableError, ConnectionClosedError,
  MessageTooLargeError
- 88 test cases, mypy --strict clean, ruff clean

#### TypeScript Shim — `apps/shim-ts/`
- `Guard` class: `wrap()`, `check()`, `openai()`, `close()`
- RFC 8785 JCS canonicalization
- SHA-256 args hashing (13 cross-language test vectors pass)
- NDJSON IPC protocol over `node:net` (UDS + named pipes)
- OpenAI adapter (duck-typed, no openai dependency)
- 8 error classes matching Python hierarchy
- ESM + CJS + DTS build via tsup
- 66 tests, typecheck clean (exactOptionalPropertyTypes)

#### Backend — `packages/backend/`
- Drizzle ORM schema: 11 tables (tenants, users, sessions, accounts,
  verifications, api_keys, runs, events, supervisor_proposals,
  supervisor_escalations, policy_packs)
- SQL migrations: `0001_create_tables.sql`, `0002_enable_rls.sql`
- PostgreSQL RLS on 6 tenant-scoped tables with `current_tenant_id()` helper
- Role grants for `loopstorm_ingest` (INSERT-only) and `loopstorm_supervisor`
  (SELECT + observation-plane writes)
- Better Auth (ADR-011): email+password, optional Google OAuth, session
  cookie caching
- Post-registration tenant creation hook: auto-provisions tenant and
  back-fills tenant_id on user + session rows
- tRPC routers: events, policies, runs, api-keys, verify, supervisor
- API key authentication middleware (SHA-256 hash comparison)
- Tenant isolation middleware (SET LOCAL for RLS context)
- Hono server with health checks, Better Auth handler, tRPC mount

#### Web Dashboard — `packages/web/`
- Auth pages (sign-in, sign-up) with Better Auth client
- Dashboard layout with sidebar navigation
- Runs list with status filtering + run detail page with event timeline
- Policy management: list, create, edit with optimistic concurrency
  conflict dialog
- API keys management: list, create, revoke
- Supervisor page: escalation queue + proposal queue
- Settings page
- Shared UI components: BudgetBar, ChainBadge, StatusBadge, ConfirmDialog,
  EmptyState, PageHeader

#### Specifications
- `specs/behavioral-telemetry.md` — 4 telemetry fields for v2 anomaly
  detector, 19 test vectors
- `specs/otel-span-mapping.md` — run-to-trace, event-to-span mapping
- `specs/mcp-proxy-mode.md` — MCP protocol translation proxy architecture
- `specs/ai-supervisory-interface.md` — 13 supervisor tools, triggers,
  human approval workflow
- `specs/ipc-wire-format.md` — NDJSON over UDS protocol spec
- `specs/args-hash.md` — JCS canonicalization + SHA-256, 13 test vectors

#### CI/CD
- CI pipeline: license-check, schema-hash-check, lint-typecheck,
  test-backend, test-engine, bench-engine, mode0-smoke, build-ts, ci-gate
- Engine cross-compilation: Linux x86_64/aarch64, macOS x86_64/aarch64,
  Windows x86_64
- Release pipeline: tag-triggered, 5-target cross-platform builds, GitHub
  Release with SHA-256 checksums, PyPI + npm publish, OSS release gate,
  pre-release detection

#### Documentation
- 13 Architecture Decision Records (ADR-001 through ADR-013)
- Five-stage control philosophy (`docs/control-philosophy.md`)
- OWASP Agentic Top 10 coverage mapping (`docs/owasp-agentic-mapping.md`)
- Deployment modes guide (`docs/deployment-modes.md`)
- Trust boundaries and threat model (`docs/guides/threat-model.md`)
- Policy authoring guide (`docs/guides/policy-authoring.md`)
- Integration guide (`docs/guides/integration.md`)
- Budget configuration guide (`docs/guides/budget-configuration.md`)
- Event schema reference (`docs/guides/event-schema-reference.md`)
- OSS release checklist (`docs/oss-release-checklist.md`)

#### Schemas
- `schemas/ipc/decision-request.schema.json` — JSON Schema Draft 2020-12
- `schemas/ipc/decision-response.schema.json` — JSON Schema Draft 2020-12
- `schemas/events/event.schema.json` — JSON Schema Draft 2020-12
- `schemas/policy/policy.schema.json` — JSON Schema Draft 2020-12
- All schemas at `schema_version: 1`

#### Repository
- Monorepo: Turborepo + Bun workspaces
- License boundary: MIT (apps/, packages/schemas/) / AGPL-3.0-only
  (packages/backend/, packages/web/)
- Example policy packs: starter, supervisor
- SECURITY.md, CONTRIBUTING.md
