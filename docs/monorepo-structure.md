<!-- SPDX-License-Identifier: MIT -->
# LoopStorm Guard — Monorepo Structure

**Last updated:** 2026-03-13

---

## Directory Layout

```
loopstorm-guard/
├── apps/
│   ├── engine/              # Rust — loopstorm-engine binary (MIT)
│   │   ├── src/
│   │   │   ├── main.rs      # Binary entry point
│   │   │   ├── lib.rs       # Library crate (shared with CLI)
│   │   │   ├── decision.rs  # DecisionRequest/Response types
│   │   │   └── policy.rs    # Policy pack loading + validation
│   │   ├── benches/
│   │   │   └── enforcement_pipeline.rs  # Criterion benchmarks
│   │   ├── build.rs         # Schema hash assertion (ADR-003)
│   │   └── Cargo.toml
│   │
│   ├── cli/                 # Rust — loopstorm CLI binary (MIT)
│   │   ├── src/main.rs
│   │   └── Cargo.toml
│   │
│   ├── shim-python/         # Python — loopstorm package (MIT)
│   │   ├── loopstorm/
│   │   │   ├── __init__.py
│   │   │   ├── _guard.py
│   │   │   ├── _version.py
│   │   │   └── bin/         # Engine binaries (bundled by CI, gitignored)
│   │   └── pyproject.toml
│   │
│   └── shim-ts/             # TypeScript — @loopstorm/shim-ts (MIT)
│       ├── src/
│       │   ├── index.ts
│       │   ├── guard.ts
│       │   └── types.ts
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── schemas/             # JSON schemas + TypeScript types (MIT)
│   │   ├── policy/          # policy.schema.json (single source of truth, ADR-003)
│   │   ├── ipc/             # decision-request/response schemas
│   │   ├── events/          # event.schema.json
│   │   ├── types/           # Handwritten TypeScript types matching schemas
│   │   ├── index.ts
│   │   └── package.json
│   │
│   ├── backend/             # Hono API server (AGPL-3.0-only)
│   │   ├── src/
│   │   │   └── index.ts     # Hono app, health endpoints
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                 # Next.js 15 App Router UI (AGPL-3.0-only)
│       ├── src/app/
│       │   ├── layout.tsx
│       │   └── page.tsx
│       ├── package.json
│       └── tsconfig.json
│
├── schemas/                 # ORIGINAL schemas (Lead Architect output)
│   ├── policy/              # Canonical location — packages/schemas/ is a copy
│   ├── ipc/
│   └── events/
│
├── docs/
│   ├── adrs/                # ADR-001 through ADR-013
│   ├── control-philosophy.md
│   ├── owasp-agentic-mapping.md
│   ├── oss-release-checklist.md
│   └── monorepo-structure.md  (this file)
│
├── examples/
│   └── policy-packs/
│       ├── starter.yaml         # Conservative default policy
│       └── supervisor-policy.yaml
│
├── scripts/
│   ├── add-license-headers.sh   # Mass-add missing SPDX headers
│   └── pre-commit-license-check.sh  # Install as .git/hooks/pre-commit
│
├── .github/
│   ├── workflows/
│   │   └── ci.yml               # Main CI pipeline
│   └── CODEOWNERS
│
├── Cargo.toml                   # Rust workspace root
├── package.json                 # Bun workspace root
├── turbo.json                   # Turborepo task pipeline
├── biome.json                   # Biome formatter + linter
└── .gitignore
```

---

## Licensing Boundaries (ADR-013)

The repository contains two license tiers. The CI `license-check` job enforces this on every PR.

| Path | License | SPDX Header |
|---|---|---|
| `apps/engine/` | MIT | `// SPDX-License-Identifier: MIT` |
| `apps/cli/` | MIT | `// SPDX-License-Identifier: MIT` |
| `apps/shim-python/` | MIT | `# SPDX-License-Identifier: MIT` |
| `apps/shim-ts/` | MIT | `// SPDX-License-Identifier: MIT` |
| `packages/schemas/` | MIT | `// SPDX-License-Identifier: MIT` |
| `packages/backend/` | AGPL-3.0-only | `// SPDX-License-Identifier: AGPL-3.0-only` |
| `packages/web/` | AGPL-3.0-only | `// SPDX-License-Identifier: AGPL-3.0-only` |

**Dependency direction rule (ADR-013):** AGPL components may import MIT components. MIT components must never import AGPL components.

---

## Build System

### Package Manager: Bun

All JavaScript/TypeScript dependency management uses Bun. Never use npm, yarn, or pnpm.

```bash
bun install --frozen-lockfile   # CI installs
bun install                     # local dev
```

### Task Orchestration: Turborepo

```bash
bun turbo run build             # build all packages in dependency order
bun turbo run test              # run all tests (cache disabled)
bun turbo run lint              # lint all packages
bun turbo run typecheck         # typecheck all packages
bun turbo run dev               # start all dev servers
```

Turborepo pipeline (`turbo.json`):

| Task | Depends On | Cached |
|---|---|---|
| `build` | `^build` (upstream first) | yes |
| `test` | — | no |
| `lint` | — | yes |
| `typecheck` | `^build` | yes |
| `dev` | — | no (persistent) |

### Rust Build

```bash
cargo build --workspace         # debug build
cargo build --release --workspace  # release build
cargo test --workspace          # all tests
cargo bench --bench enforcement_pipeline  # run latency benchmarks
```

The `apps/engine/build.rs` script asserts the SHA-256 hash of `packages/schemas/policy/policy.schema.json` at every build. Hash mismatch = build failure (ADR-003).

---

## CI Pipeline

See `.github/workflows/ci.yml`. Jobs:

1. **license-check** — SPDX header assertion (legal enforcement)
2. **schema-hash-check** — Policy schema hash assertion (ADR-003)
3. **lint-typecheck** — Biome lint + TypeScript typecheck
4. **test-backend** — Bun tests with Postgres service container
5. **test-engine** — `cargo test --workspace` (includes build.rs hash check)
6. **bench-engine** — `cargo bench --test` (compile + run, no timing in CI yet)
7. **mode0-smoke** — Build engine, verify air-gap operation
8. **build-ts** — `turbo run build` for all TS packages
9. **ci-gate** — Aggregates all jobs; set this as branch protection required check

---

## Schema Canonical Location

`packages/schemas/policy/policy.schema.json` is the authoritative copy used by:
- The Rust engine (embedded at compile time via `include_str!` + hash check in `build.rs`)
- The CLI (validates user policy files)
- The backend API (validates policy uploads)
- The web UI (renders policy structure)

The `schemas/` directory at the workspace root is the original Lead Architect output and is kept as a reference. `packages/schemas/` is the working copy. Both must be kept in sync — the CI `schema-hash-check` job validates this.

---

## Adding a New Package

1. Create the directory under `apps/` or `packages/`.
2. Assign a license based on the ADR-013 boundary rule.
3. Add the SPDX header to every source file.
4. Add a `package.json` with `"license"` field set.
5. Add the package to `turbo.json` if it has build/test tasks.
6. Update `CODEOWNERS`.
7. If it imports schemas, depend on `@loopstorm/schemas` (MIT) — never on the AGPL packages from MIT code.
