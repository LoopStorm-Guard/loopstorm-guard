---
name: Feature Request
about: Suggest an enhancement or new feature for LoopStorm Guard
title: "[Feature] "
labels: enhancement
assignees: ""
---

## Summary

A clear, one-paragraph description of the feature you are proposing.

## Motivation

Why is this feature needed? What problem does it solve?

## Component

Which component(s) would this affect?

- [ ] Engine (`apps/engine`)
- [ ] CLI (`apps/cli`)
- [ ] Python shim (`apps/shim-python`)
- [ ] TypeScript shim (`apps/shim-ts`)
- [ ] Backend (`packages/backend`)
- [ ] Web UI (`packages/web`)
- [ ] Schemas (`packages/schemas`)
- [ ] New component

## Deployment Mode Compatibility

Which deployment modes should this feature work with?

- [ ] Mode 0 (air-gapped, no network)
- [ ] Mode 1 (self-hosted control plane)
- [ ] Mode 2 (LoopStorm-hosted control plane)
- [ ] Mode 3 (AI Supervisor active)

## Proposed Solution

Describe how you think this could work. Include API sketches, config examples,
or architecture notes if you have them.

## Alternatives Considered

Other approaches you considered and why you prefer your proposed solution.

## Additional Context

Any other context, screenshots, or references.

## Checklist (for maintainers)

- [ ] Does this work in Mode 0 (air-gapped)?
- [ ] Does this maintain enforcement/observation plane separation?
- [ ] Does this require a schema change?
- [ ] Does this require an ADR?
