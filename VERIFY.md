# Schema Hash Verification

This file records the authoritative SHA-256 hashes of all canonical schema files.
The CI pipeline (`schema-hash-assert` job) recomputes these hashes on every push
and fails if any schema file has changed without a corresponding update to this file.

The Rust engine (`apps/engine/build.rs`) also asserts the policy schema hash at
compile time. Any change to `schemas/policy/policy.schema.json` requires:
1. Updating the hash below
2. Updating `apps/engine/build.rs`
3. Bumping `schema_version` in the affected schema file
4. Opening PRs tagged `schema-change` against all consumer teams

## Current Hashes

| Schema File | SHA-256 |
|---|---|
| `schemas/events/event.schema.json` | `8769be2fbb63f7ea17765b71d00175b67992849e5c6292f600d80160900576dd` |
| `schemas/policy/policy.schema.json` | `10725f37ecb7e82d1073afdd154a4e4d42705c806b15ce6a3a381e53be1721bb` |
| `schemas/ipc/decision-request.schema.json` | `9cd77f8f4066479d4e8e680e02a215ba179875da45b7200412ffb7cbfd11b025` |
| `schemas/ipc/decision-response.schema.json` | `5d791582820a4aaa540e09e9e7f93b3c14e80e3bb12be52ddff15e52422d8aa6` |

## Schema Versions

| Schema | Version | Last Changed |
|---|---|---|
| Event schema | 1 | 2026-03-13 |
| Policy schema | 1 | 2026-03-13 |
| IPC DecisionRequest schema | 1 | 2026-03-13 |
| IPC DecisionResponse schema | 1 | 2026-03-13 |

## How to Update

When a schema file is intentionally changed:

```bash
sha256sum schemas/events/event.schema.json
sha256sum schemas/policy/policy.schema.json
sha256sum schemas/ipc/decision-request.schema.json
sha256sum schemas/ipc/decision-response.schema.json
```

Update the table above with the new hashes, bump `schema_version` in the schema,
and update `apps/engine/build.rs` if the policy schema changed.
