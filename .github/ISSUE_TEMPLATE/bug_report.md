---
name: Bug Report
about: Report a bug in LoopStorm Guard
title: "[Bug] "
labels: bug
assignees: ""
---

## Description

A clear description of what the bug is.

## Component

Which component is affected?

- [ ] Engine (`apps/engine`)
- [ ] CLI (`apps/cli`)
- [ ] Python shim (`apps/shim-python`)
- [ ] TypeScript shim (`apps/shim-ts`)
- [ ] Backend (`packages/backend`)
- [ ] Web UI (`packages/web`)
- [ ] Schemas (`packages/schemas`)
- [ ] CI/CD
- [ ] Documentation

## Steps to Reproduce

1. ...
2. ...
3. ...

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened. Include error messages, stack traces, or log output if available.

## Environment

- **OS**: (e.g., Ubuntu 22.04, macOS 14, Windows 11)
- **LoopStorm version**: (e.g., v1.0.0, commit hash, or `main`)
- **Deployment mode**: (Mode 0 / Mode 1 / Mode 2 / Mode 3)
- **Rust version** (if engine/CLI): `rustc --version`
- **Python version** (if Python shim): `python --version`
- **Bun version** (if backend/web): `bun --version`

## Policy File (if applicable)

```yaml
# Paste your policy YAML here (redact any secrets)
```

## Audit Log Excerpt (if applicable)

```json
# Paste relevant JSONL lines here (redact any secrets)
```

## Additional Context

Any other context about the problem.
