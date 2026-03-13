<!-- SPDX-License-Identifier: MIT -->
# ADR-008: agent_role as Flat Tag

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

Enterprise security reviews require an identity axis in the policy schema. The question is: "What is the identity of this agent, and how does your enforcement layer scope permissions to that identity?"

The `agent_role` field could be modeled as:

1. A hierarchical identity (e.g., `org.team.agent.role`) with inheritance semantics.
2. A structured object with multiple fields (name, team, permissions).
3. A flat string tag with no hierarchy or inheritance.

---

## Decision

`agent_role` is a **flat string tag** at the top level of the policy pack and in the DecisionRequest.

```yaml
agent_role: data-processor
```

```json
{ "agent_role": "data-processor" }
```

Rules can match on `agent_role` as a condition:

```yaml
rules:
  - name: deny-db-write-for-readers
    action: deny
    tool_pattern: "db.write*"
    conditions:
      - field: agent_role
        operator: equals
        value: data-reader
```

The tag is:
- A single string, not a list. One agent has one role per run.
- Opaque to the engine. The engine does string equality and glob matching on it. It does not interpret the value.
- Set by the shim at run start. It is not mutable during a run.
- Optional in v1 (for backward compatibility). Required in v1.1 policy schema version.

There is no role hierarchy, no role inheritance, no role composition, and no role registry. The operator defines roles by convention. The engine enforces them by exact match or glob.

---

## Consequences

**Positive:**
- Minimal schema complexity. A flat string adds one field, not a subsystem.
- Sufficient for the v1.1 requirement: scope rules by agent identity.
- Compatible with Zero Trust conversations: "agent X has role Y, role Y is denied tool Z."
- No ontology to design, maintain, or explain to operators.

**Negative:**
- No inheritance means operators must duplicate rules for related roles (e.g., `data-reader` and `data-writer` cannot share a parent role's rules). This is acceptable at v1.1 scale; a role hierarchy is a v2 consideration if operator feedback demands it.
- Typos in role strings cause silent policy mismatches. Mitigation: the CLI should validate that every `agent_role` referenced in conditions exists as a role in at least one policy pack in the project.

---

## Migration Path

If a future version requires structured identity (e.g., team membership, permission sets), the `agent_role` field can be extended to accept either a string or an object. The engine would treat a string value as shorthand for `{ "role": "<value>" }`. Existing policy files with string values would remain valid.

A role registry (a file listing valid roles with descriptions) is a v2 consideration that would enable validation without changing the schema.
