# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| main (pre-release) | ✅ |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security vulnerabilities by emailing:

**security@loopstorm.dev**

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected component (engine, shim, backend, web)
- Potential impact assessment

You will receive an acknowledgment within 48 hours and a resolution timeline
within 7 days.

## Scope

This security policy covers:
- `loopstorm-engine` — Rust enforcement binary
- `loopstorm-py` — Python shim
- `loopstorm-ts` — TypeScript shim
- `packages/backend` — Hono API server
- `packages/web` — Next.js frontend
- JSON schemas and policy evaluation logic

## Security Architecture

LoopStorm Guard is a security enforcement layer. Its threat model is documented in:
- [`docs/guides/threat-model.md`](docs/guides/threat-model.md) — trust boundaries and 9 threat categories
- [`docs/owasp-agentic-mapping.md`](docs/owasp-agentic-mapping.md) — OWASP Agentic Top 10 coverage
- [`docs/adrs/ADR-002-fail-closed-default.md`](docs/adrs/ADR-002-fail-closed-default.md) — fail-closed enforcement
- [`docs/adrs/ADR-012-ai-supervisor-architecture.md`](docs/adrs/ADR-012-ai-supervisor-architecture.md) — enforcement/observation plane separation

The enforcement plane and observation plane are architecturally separated.
The AI Supervisor cannot make enforcement decisions. This separation is inviolable.

## Key Security Properties

- **Fail-closed**: if the policy cannot be loaded or no rule matches, the decision is deny
- **Hash-chain audit log**: SHA-256 chain detects tampering; `loopstorm verify` checks integrity
- **`escalate_to_human` invariant**: agents can always request human help; no policy can block it
- **Secret redaction**: API keys, bearer tokens, JWTs, and AWS credentials are automatically
  redacted from audit logs before writing
- **Socket permissions**: IPC socket is created at mode 0600 (owner-only)
- **Tenant isolation**: PostgreSQL RLS on all tenant-scoped tables (Mode 2+)
