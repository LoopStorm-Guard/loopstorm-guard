<!-- SPDX-License-Identifier: MIT -->
# ADR-013: Open-Core Licensing Model

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

LoopStorm Guard is an open-core product. The enforcement core is the distribution mechanism; the AI Supervisor and hosted control plane are the commercial moat. The licensing model must:

1. Allow free adoption, forking, and redistribution of the enforcement core.
2. Protect the commercial value of the hosted control plane and web UI.
3. Provide a clear, principled boundary that developers can understand without legal review.
4. Support Mode 0 (air-gapped, no account) as a fully functional deployment.

---

## Decision

### License Assignments

| Path | License | Rationale |
|---|---|---|
| `apps/engine` | MIT | Enforcement core must be freely adoptable |
| `apps/cli` | MIT | Developer tooling for the OSS tier |
| `apps/shim-python` | MIT | Integration layer must be freely embeddable |
| `apps/shim-ts` | MIT | Integration layer must be freely embeddable |
| `packages/schemas` | MIT | Public standards that anyone can implement against |
| `packages/backend` | AGPL-3.0-only | Commercial hosted control plane |
| `packages/web` | AGPL-3.0-only | Commercial web UI |

### SPDX Headers

Every source file must carry an SPDX license header as the first comment:

```
// SPDX-License-Identifier: MIT
```
or
```
// SPDX-License-Identifier: AGPL-3.0-only
```

CI enforces that every file in the repository has a valid SPDX header matching its path's license assignment. Files without headers fail the build.

### Shared Code Boundary

Code shared between MIT and AGPL components (e.g., type definitions, schema interfaces) must live in `packages/schemas` (MIT). AGPL components may depend on MIT packages. MIT components must never depend on AGPL packages.

The dependency direction is: `AGPL -> MIT`, never `MIT -> AGPL`.

### What the Licenses Mean in Practice

**MIT (enforcement core, shims, schemas, CLI):**
- Anyone can use, modify, distribute, and sell derivatives.
- Platform vendors can fork and offer managed LoopStorm enforcement. This is explicitly acceptable — it expands the LoopStorm event schema as a standard.
- No copyleft obligation. Embedding in proprietary agent systems is permitted.

**AGPL-3.0-only (backend, web UI):**
- Source code must be made available to users who interact with the software over a network.
- Enterprise customers who self-host the control plane (Mode 1) must comply with AGPL or obtain a commercial license.
- This creates a natural conversion point: enterprises that want to self-host without AGPL obligations purchase a commercial license.

---

## Consequences

**Positive:**
- The enforcement core's MIT license maximizes adoption. No legal friction for developers evaluating LoopStorm.
- AGPL on the hosted components creates a defensible commercial boundary without restricting the OSS tier.
- The boundary is principled: OSS gives you enforcement; commercial gives you intelligence and collaboration.
- Platform vendors hosting the enforcement core expand the standard, which makes the supervisor more valuable.

**Negative:**
- AGPL may deter some enterprises from self-hosting the control plane. This is intentional — it creates a commercial license sales opportunity.
- Maintaining two license regimes requires CI enforcement and developer awareness. The SPDX header requirement and CI checks mitigate this.
- Contributors must sign a CLA or agree to license terms that allow dual-licensing of AGPL components under a commercial license.

---

## Migration Path

The MIT license on the enforcement core is permanent. It must not be changed to a more restrictive license — this would betray the trust of adopters and contributors.

The AGPL license on the backend/web could be changed to a more permissive license if the commercial model evolves, but this is a one-way door (more permissive is safe; more restrictive is not). Any license change requires legal review and community notice.

If a new component is added to the repository, its license must be assigned before the first commit based on the principled boundary: enforcement/schema = MIT, control plane/UI = AGPL.
