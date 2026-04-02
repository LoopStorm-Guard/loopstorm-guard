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

## Coding Standards

- **Commit style:** Conventional Commits — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- **Package manager:** Bun exclusively. Never npm, yarn, or pnpm.
- **Formatting:** Biome (2-space indent). Run `bunx biome check --write` before committing.
- **Rust:** `cargo fmt` + `cargo clippy` must pass.
- **Python:** ruff + mypy --strict.
- **TypeScript:** strict mode with `exactOptionalPropertyTypes`.
- **SPDX headers:** Required on every source file. MIT for `apps/` and `packages/schemas/`,
  AGPL-3.0-only for `packages/backend/` and `packages/web/`.

## Absolute Rules

1. **Enforcement/observation plane separation is inviolable.** The AI Supervisor never
   touches the enforcement path. Any PR that blurs this boundary will be rejected.
2. **Fail-closed always.** Any ambiguity in policy evaluation results in deny.
3. **`escalate_to_human` can never be blocked** by any policy rule.
4. **Better Auth only** — never Supabase Auth / GoTrue.
5. **Mode 0 first** — everything must work air-gapped before adding network features.

## Certificate of Origin

By contributing to this project, you certify that your contribution is made under
the terms of the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO). The [DCO GitHub App](https://github.com/apps/dco) is installed on this
repository and **enforces a valid `Signed-off-by` line on every commit in every PR**.
A PR cannot be merged until all commits carry a matching signature.

### How to sign off

**New commits** — use `-s` (short for `--signoff`) or the long form:

```bash
git commit -s -m "feat: add new feature"
# or
git commit --signoff -m "feat: add new feature"
```

Git automatically appends the trailer using your configured `user.name` and
`user.email`:

```
Signed-off-by: Ada Lovelace <ada@example.com>
```

**Amending a commit that is missing a sign-off** — if the DCO check flags an
existing commit you can amend it without changing anything else:

```bash
git commit --amend --signoff --no-edit
git push --force-with-lease origin <your-branch>
```

**Signing off multiple commits at once** — if several commits in your branch are
missing the trailer, use an interactive rebase:

```bash
# Replace N with the number of commits to touch
git rebase HEAD~N --exec 'git commit --amend --no-edit --signoff'
git push --force-with-lease origin <your-branch>
```

**Configure Git once so you never forget:**

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

> The DCO is not a CLA — you are not assigning copyright to GMW Solutions LLC.
> You are simply certifying that you have the right to submit the code under the
> license that governs the file you are editing (MIT or AGPL-3.0-only, per ADR-013).

## Pull Request Guidelines

- Keep PRs focused — one concern per PR
- All CI checks must pass (license headers, schema hash, tests)
- ADR changes require the lead architect's approval
- Schema changes require sign-off from all consumer teams
- Include `Signed-off-by` in commit messages (DCO)
