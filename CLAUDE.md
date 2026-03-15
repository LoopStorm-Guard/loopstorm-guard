# LoopStorm Guard — Claude Code Project Instructions

## Project Overview

LoopStorm Guard is a runtime enforcement layer and AI agent safety platform.
It intercepts AI agent tool calls, enforces policy rules, enforces budget caps,
detects loops, and writes tamper-evident JSONL hash-chain audit logs.

## Agent System

This project uses specialized Claude Code agents. Always invoke the correct agent:

| Agent | When to use |
|---|---|
| `loopstorm-lead-architect` | **FIRST** on any new task. ADRs, schemas, specs, gate resolutions |
| `backend-senior-engineer` | Database schema, tRPC, Hono API, Better Auth, Drizzle ORM |
| `frontend-senior-engineer` | Next.js UI, components, Playwright tests |
| `loopstorm-platform-engineer` | CI/CD, monorepo tooling, DevOps, deployment |

The lead architect must resolve all gates before implementation agents begin.

## Absolute Rules

1. **Enforcement/observation plane separation is inviolable.** The AI Supervisor never touches the enforcement path. Never merge them.
2. **Fail-closed always.** Any ambiguity in policy evaluation → deny.
3. **`escalate_to_human` can never be blocked** by any policy rule.
4. **Better Auth only** — never Supabase Auth / GoTrue. See ADR-011.
5. **Mode 0 first** — everything must work air-gapped before adding network features.
6. **SPDX headers required** on every source file. CI enforces this.
7. **Schema changes** require: `schema_version` bump + VERIFY.md update + `engine/build.rs` update.

## Tech Stack

- **Engine**: Rust (`apps/engine`) — MIT
- **CLI**: Rust (`apps/cli`) — MIT
- **Python shim**: `apps/shim-python` — MIT
- **TypeScript shim**: `apps/shim-ts` — MIT
- **Backend**: Hono + Bun + tRPC + Drizzle ORM (`packages/backend`) — AGPL-3.0-only
- **Auth**: Better Auth (ADR-011) — never Supabase Auth
- **Database**: Supabase PostgreSQL + RLS + Storage + Realtime
- **Frontend**: Next.js 15 App Router (`packages/web`) — AGPL-3.0-only
- **Deployment**: Cloudflare Workers (backend), Vercel (frontend)
- **Monorepo**: Turborepo + Bun workspaces

## Key Files

- `VERIFY.md` — authoritative SHA-256 hashes of all schema files
- `docs/adrs/` — all 13 Architecture Decision Records
- `schemas/` — canonical schema source-of-truth
- `docs/control-philosophy.md` — five-stage control model
- `docs/owasp-agentic-mapping.md` — OWASP coverage (honest, no overclaiming)
- `docs/oss-release-checklist.md` — hard gate before v1 tag

## Package Manager

Use **Bun** exclusively. Never npm, yarn, or pnpm.

## Commit Style

Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
