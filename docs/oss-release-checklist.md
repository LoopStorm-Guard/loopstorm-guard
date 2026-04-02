<!-- SPDX-License-Identifier: MIT -->
# LoopStorm Guard -- OSS Release Checklist

**Version:** 1.0
**Date:** 2026-03-13
**Status:** Hard gate before any v1 tag is pushed

---

This checklist must be completed in full before tagging any v1 release. Each item has a responsible owner and a verification method. No item may be skipped or deferred.

---

## 1. Licensing and Legal

- [ ] Every source file has a valid SPDX license header matching its path's license assignment (ADR-013).
- [ ] CI enforces SPDX header presence and correctness on every PR.
- [ ] `LICENSE-MIT` file exists at repo root.
- [ ] `LICENSE-AGPL-3.0` file exists at repo root.
- [ ] `packages/schemas/`, `apps/engine/`, `apps/cli/`, `apps/shim-python/`, `apps/shim-ts/` -- all MIT.
- [ ] `packages/backend/`, `packages/web/` -- all AGPL-3.0-only.
- [ ] No AGPL code is imported or linked by any MIT component.
- [x] Contributor License Agreement (CLA) or DCO process is configured. (DCO — Probot app `.github/dco.yml`, sign-off instructions in `CONTRIBUTING.md`)
- [ ] Third-party dependency license audit completed (no GPL-incompatible deps in MIT components).

## 2. Schemas and Specifications

- [ ] `schemas/ipc/decision-request.schema.json` published and validates against JSON Schema Draft 2020-12.
- [ ] `schemas/ipc/decision-response.schema.json` published and validates against JSON Schema Draft 2020-12.
- [ ] `schemas/events/event.schema.json` published and validates against JSON Schema Draft 2020-12.
- [ ] `schemas/policy/policy.schema.json` published and validates against JSON Schema Draft 2020-12.
- [ ] All schemas have `schema_version` field at version 1.
- [ ] SHA-256 hash of `policy.schema.json` matches pinned hash in `engine/build.rs` (ADR-003).
- [ ] CI asserts schema hash match on every build.
- [ ] Backward-compatibility fixture tests exist for all schemas.

## 3. Architecture Decision Records

- [ ] ADR-001 through ADR-013 published in `docs/adrs/`.
- [ ] Every ADR has: Context, Decision, Consequences, Migration Path.
- [ ] ADR-002 (fail-closed) verified by test: empty policy pack prevents run start.
- [ ] ADR-005 (JSONL fail-closed) verified by test: write failure returns kill decision.
- [ ] ADR-012 (AI Supervisor) verified: `escalate_to_human` cannot be denied by any policy configuration.

## 4. Engine (Rust)

- [ ] Engine builds on Linux and macOS (static binary, no runtime deps).
- [ ] Engine passes all unit tests.
- [ ] Engine passes all integration tests against the four case study scenarios.
- [ ] Policy evaluator is fail-closed (verified by test).
- [ ] Budget engine enforces multi-dimensional hard caps (verified by test).
- [ ] Loop detection fires on identical call fingerprint (verified by test).
- [ ] Loop detection fires on identical error response (verified by test).
- [ ] Hash chain is correct (verified by replay CLI against generated JSONL).
- [ ] Redaction replaces default patterns (API keys, bearer tokens, JWTs, AWS credentials).
- [ ] args_hash is SHA-256 of RFC 8785 canonical JSON (verified by cross-language test).
- [ ] IPC protocol matches `decision-request.schema.json` and `decision-response.schema.json`.
- [ ] Queue backpressure activates at 10,000 events (ADR-006) (verified by test).
- [ ] JSONL write failure returns kill decision (ADR-005) (verified by test).

## 5. Python Shim

- [ ] Shim installs via pip with post-install binary download.
- [ ] Shim uses stdlib only (no third-party dependencies).
- [ ] Shim connects to engine via UDS (Unix) or named pipe (Windows).
- [ ] OpenAI adapter wraps tool calls correctly.
- [ ] Generic tool wrapper works with custom tools.
- [ ] Fail-open mode: engine unavailable produces warning, agent continues.
- [ ] Fail-closed mode: engine unavailable raises EngineUnavailableError.
- [ ] `loopstorm.wrap()` API works as documented.
- [ ] args_hash computation matches engine (cross-validated).

## 6. CLI

- [ ] `loopstorm replay <file>` verifies hash chain and exits 0 (valid) or 1 (broken).
- [ ] `loopstorm verify <file>` reports chain break position on failure.
- [ ] `loopstorm filter --event-type <type> <file>` filters events correctly.
- [ ] `loopstorm import <file> --api-key <key>` imports JSONL to hosted backend.
- [ ] CLI is bundled with engine binary in releases.

## 7. Case Studies (Mandatory End-to-End Tests)

- [ ] Case Study 1: SSRF tool call blocked by policy deny rule.
- [ ] Case Study 2: Runaway cost stopped by budget hard cap with safe partial output.
- [ ] Case Study 3: Looping agent detected and terminated after cooldown recovery fails.
- [ ] Case Study 4: Hash chain verified by replay CLI (valid chain exits 0, modified chain exits 1).

## 8. Documentation

- [ ] `docs/control-philosophy.md` published (five-stage model).
- [ ] `docs/owasp-agentic-mapping.md` published with honest coverage claims.
- [ ] `docs/oss-release-checklist.md` is this document.
- [ ] README.md at repo root with: installation, quick start, Mode 0 deployment, link to docs.
- [ ] Policy authoring guide with examples.
- [ ] Budget configuration guide with recommended defaults.
- [ ] Integration guide (Python shim setup, routing validation).
- [ ] JSONL event schema reference.
- [ ] Trust boundaries and threat model summary (from product document Section 7).

## 9. Security

- [ ] No secrets, credentials, or API keys in the repository.
- [ ] JSONL redaction covers: API keys, bearer tokens, JWTs, AWS credential formats.
- [ ] UDS socket created at mode 0600.
- [ ] `escalate_to_human` is always allowed regardless of policy (fixture test).
- [ ] Policy schema validation rejects rules that would deny `escalate_to_human`.
- [ ] OWASP mapping document reviewed by at least one person other than the author.

## 10. CI/CD

- [ ] CI runs on every PR: build, test, lint, SPDX header check, schema hash check.
- [ ] Release pipeline produces: engine binary (Linux amd64, Linux arm64, macOS amd64, macOS arm64), Python package (sdist + wheel), CLI binary.
- [ ] Release artifacts are signed or checksummed.
- [ ] GitHub release notes template includes: changelog, migration notes, known issues.

## 11. Repository Hygiene

- [ ] `.gitignore` covers build artifacts, IDE files, OS files, `.env`.
- [ ] No binary blobs in the repository (engine binaries are release artifacts, not committed).
- [ ] Branch protection on `main`: require PR review, require CI pass, no force push.
- [ ] Issue templates for: bug report, feature request, security vulnerability.
- [ ] `SECURITY.md` with responsible disclosure instructions.
- [ ] `CONTRIBUTING.md` with development setup, coding standards, and CLA/DCO instructions.

---

## Sign-Off

All items above must be checked before the v1 tag is created. The release is blocked until this checklist is complete.

| Role | Name | Date | Signature |
|---|---|---|---|
| Lead Architect | | | |
| Engine Lead | | | |
| Product Owner | | | |
