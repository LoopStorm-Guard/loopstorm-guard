# Contributing to LoopStorm Guard

Thank you for your interest in contributing.

## Licensing

By contributing, you agree that your contributions will be licensed under
the same license as the package you are contributing to:

- `apps/engine`, `apps/cli`, `apps/shim-python`, `apps/shim-ts`, `packages/schemas` → **MIT**
- `packages/backend`, `packages/web` → **AGPL-3.0-only**

Every source file must carry its correct SPDX header. CI will reject files missing headers.

## Before You Contribute

1. Read the Architecture Decision Records in `docs/adrs/` — especially ADR-001, ADR-002, and ADR-012.
2. Read `docs/control-philosophy.md` — understand the enforcement/observation plane separation.
3. The enforcement plane and observation plane must never be merged. Any PR that blurs this boundary will be rejected.

## Development Setup

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Run all checks
bun turbo lint typecheck test build
```

For Rust components:
```bash
cargo build --workspace
cargo test --workspace
```

## Schema Changes

Any change to a schema file (`schemas/`) requires:
1. Bumping `schema_version` in the schema
2. Updating `VERIFY.md` with the new SHA-256 hash
3. Updating `apps/engine/build.rs` if the policy schema changed
4. Tagging all affected consumer teams in the PR

## Pull Request Guidelines

- Keep PRs focused — one concern per PR
- All CI checks must pass (license headers, schema hash, tests)
- ADR changes require the lead architect's approval
- Schema changes require sign-off from all consumer teams
