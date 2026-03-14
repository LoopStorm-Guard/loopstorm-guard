# Changelog

All notable changes to LoopStorm Guard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial monorepo scaffold (Turborepo, Bun workspaces)
- 13 Architecture Decision Records (ADR-001 through ADR-013)
- JSON Schema Draft 2020-12 schemas: IPC wire format, event schema, policy YAML schema
- Rust engine stub (`apps/engine`) — MIT
- Rust CLI stub (`apps/cli`) — MIT
- Python shim stub (`apps/shim-python`) — MIT
- TypeScript shim stub (`apps/shim-ts`) — MIT
- Backend package scaffold: Hono + Bun + tRPC (`packages/backend`) — AGPL-3.0-only
- Web package scaffold: Next.js 15 App Router (`packages/web`) — AGPL-3.0-only
- Shared schemas package (`packages/schemas`) — MIT
- CI pipeline with license-header-check, schema-hash-assert, mode0-smoke
- Engine cross-compilation workflow (Linux x86_64, aarch64, macOS)
- Supabase local dev configuration (Better Auth, no GoTrue)
- Example policy packs: starter, supervisor
- OWASP Agentic Top 10 coverage mapping
- OSS release checklist
- Five-stage control philosophy documentation
