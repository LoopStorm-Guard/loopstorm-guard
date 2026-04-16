// SPDX-License-Identifier: MIT
// Pre-built ESM entry point for Node.js consumers (e.g. Vercel serverless).
// Bun consumers use index.ts (via the "bun" exports condition) which runs
// TypeScript natively. Node.js cannot execute .ts files, so this file
// inlines the JSON schemas as plain JavaScript objects to avoid any
// runtime file-loading or import-attribute compatibility concerns.

export const policySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.loopstorm.dev/policy/policy.schema.json",
  title: "LoopStorm Policy Pack",
  description:
    "Schema for policy YAML files that define enforcement rules, budget caps, and agent identity. The single source of truth for all consumers (ADR-003). CI enforces SHA-256 hash match with engine/build.rs.",
  type: "object",
  required: ["schema_version", "rules"],
  properties: {
    schema_version: {
      type: "integer",
      const: 1,
      description: "Policy schema version. Engine rejects packs with unsupported versions.",
    },
    name: { type: "string", description: "Human-readable name for this policy pack." },
    description: { type: "string", description: "Description of this policy pack's purpose." },
    agent_role: {
      type: "string",
      description:
        "The agent role this policy pack applies to (ADR-008). Optional in schema_version 1, required in schema_version 2.",
    },
    environment: {
      type: "string",
      description:
        "Default environment tag for this policy pack. Can be overridden per-rule.",
    },
    rules: {
      type: "array",
      minItems: 1,
      description:
        "Ordered list of policy rules. First match wins. If no rule matches, the decision is deny (ADR-002).",
      items: { $ref: "#/$defs/rule" },
    },
    budget: {
      $ref: "#/$defs/budget",
      description: "Budget configuration for runs using this policy pack (ADR-007).",
    },
    loop_detection: {
      $ref: "#/$defs/loop_detection",
      description: "Loop detection configuration. Optional — defaults apply if omitted.",
    },
    redaction: {
      $ref: "#/$defs/redaction",
      description: "Redaction patterns configuration. Optional — defaults apply if omitted.",
    },
  },
  additionalProperties: false,
  $defs: {
    rule: {
      type: "object",
      required: ["name", "action"],
      properties: {
        name: {
          type: "string",
          minLength: 1,
          description: "Unique name for this rule within the policy pack.",
        },
        action: {
          type: "string",
          enum: ["allow", "deny", "require_approval"],
          description: "The enforcement action when this rule matches.",
        },
        tool: {
          type: "string",
          description: "Exact tool name to match. Mutually exclusive with tool_pattern.",
        },
        tool_pattern: {
          type: "string",
          description:
            "Glob pattern to match tool names (e.g., 'db.*', 'http.request'). Mutually exclusive with tool.",
        },
        conditions: {
          type: "array",
          description: "Additional conditions that must all be true for this rule to match.",
          items: { $ref: "#/$defs/condition" },
        },
        timeout: {
          type: "integer",
          minimum: 1,
          description:
            "Timeout in seconds for require_approval decisions. If no human response within this time, timeout_action applies.",
        },
        timeout_action: {
          type: "string",
          enum: ["deny", "allow", "kill"],
          description:
            "Action when a require_approval decision times out. Defaults to 'deny'.",
        },
        reason: {
          type: "string",
          description:
            "Human-readable reason included in deny/require_approval responses.",
        },
        priority: {
          type: "integer",
          description:
            "Optional explicit priority. Lower numbers match first. If omitted, rules are evaluated in array order.",
        },
      },
      additionalProperties: false,
      allOf: [
        {
          if: {
            properties: { action: { const: "require_approval" } },
            required: ["action"],
          },
          then: { required: ["timeout", "timeout_action"] },
        },
      ],
      not: { required: ["tool", "tool_pattern"] },
    },
    condition: {
      type: "object",
      required: ["field", "operator"],
      properties: {
        field: {
          type: "string",
          description:
            "The field to evaluate. Supports: 'agent_role', 'environment', 'tool', 'url', or dot-notation into args_redacted (e.g., 'args.url').",
        },
        operator: {
          type: "string",
          enum: ["equals", "not_equals", "matches", "not_matches", "in", "not_in"],
          description:
            "Comparison operator. 'matches'/'not_matches' use glob patterns.",
        },
        value: {
          description:
            "The value to compare against. String for equals/matches, array for in/not_in.",
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        pattern: {
          type: "string",
          description:
            "Glob or regex pattern for matches/not_matches operators. Alternative to 'value' for pattern-based matching.",
        },
      },
      additionalProperties: false,
    },
    budget: {
      type: "object",
      description:
        "Multi-dimensional budget configuration (ADR-007). All dimensions are optional.",
      properties: {
        cost_usd: { $ref: "#/$defs/budget_dimension_float" },
        input_tokens: { $ref: "#/$defs/budget_dimension_int" },
        output_tokens: { $ref: "#/$defs/budget_dimension_int" },
        call_count: { $ref: "#/$defs/budget_dimension_int" },
      },
      additionalProperties: false,
    },
    budget_dimension_float: {
      type: "object",
      required: ["hard"],
      properties: {
        soft: { type: "number", minimum: 0, description: "Soft cap — emits warning event but run continues." },
        hard: { type: "number", minimum: 0, description: "Hard cap — run is terminated." },
      },
      additionalProperties: false,
    },
    budget_dimension_int: {
      type: "object",
      required: ["hard"],
      properties: {
        soft: { type: "integer", minimum: 0, description: "Soft cap — emits warning event but run continues." },
        hard: { type: "integer", minimum: 0, description: "Hard cap — run is terminated." },
      },
      additionalProperties: false,
    },
    loop_detection: {
      type: "object",
      description: "Loop detection configuration.",
      properties: {
        enabled: { type: "boolean", default: true, description: "Enable or disable loop detection." },
        identical_call_window_seconds: {
          type: "integer",
          minimum: 1,
          default: 120,
          description: "Rolling window in seconds for identical call detection (Heuristic 1).",
        },
        identical_call_threshold: {
          type: "integer",
          minimum: 2,
          default: 3,
          description: "Number of identical calls within the window before the heuristic fires.",
        },
        identical_error_threshold: {
          type: "integer",
          minimum: 2,
          default: 3,
          description:
            "Number of identical error responses without intervening success before the heuristic fires (Heuristic 2).",
        },
        cooldown_ms: {
          type: "integer",
          minimum: 100,
          default: 5000,
          description: "Cooldown pause in milliseconds on first loop detection trigger.",
        },
      },
      additionalProperties: false,
    },
    redaction: {
      type: "object",
      description: "Redaction configuration.",
      properties: {
        enabled: { type: "boolean", default: true, description: "Enable or disable redaction." },
        additional_patterns: {
          type: "array",
          description: "Additional regex patterns for secret detection beyond the defaults.",
          items: {
            type: "object",
            required: ["name", "pattern"],
            properties: {
              name: { type: "string", description: "Human-readable name for this pattern." },
              pattern: { type: "string", description: "Regex pattern to match sensitive values." },
              replacement: {
                type: "string",
                default: "[REDACTED]",
                description: "Replacement string for matched values.",
              },
            },
            additionalProperties: false,
          },
        },
        key_patterns: {
          type: "array",
          description: "JSON key names that should always be redacted.",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
  },
};

export const decisionRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.loopstorm.dev/ipc/decision-request.schema.json",
  title: "LoopStorm DecisionRequest",
  description:
    "Request sent from the shim to the engine for every intercepted tool call. See ADR-001.",
  type: "object",
  required: ["schema_version", "run_id", "seq", "tool", "args_hash", "ts"],
  properties: {
    schema_version: {
      type: "integer",
      const: 1,
      description:
        "Schema version for forward compatibility. Engine rejects unsupported versions.",
    },
    run_id: {
      type: "string",
      format: "uuid",
      description: "Client-generated UUID v7 identifying this run. See ADR-004.",
    },
    seq: {
      type: "integer",
      minimum: 1,
      description: "Monotonically increasing sequence number within this run. Starts at 1.",
    },
    tool: {
      type: "string",
      minLength: 1,
      description: "The name of the tool being called (e.g., 'http.request', 'db.query', 'file.write').",
    },
    args_hash: {
      type: "string",
      pattern: "^[0-9a-f]{64}$",
      description:
        "SHA-256 hex digest of RFC 8785 (JCS) canonical JSON serialization of the tool call arguments. Computed by the shim before sending.",
    },
    args_redacted: {
      type: "object",
      description:
        "Tool call arguments after shim-side redaction. Optional — the engine performs its own redaction pass. If omitted, the engine treats arguments as unavailable for condition matching.",
      additionalProperties: true,
    },
    agent_role: {
      type: "string",
      description:
        "The agent's role tag for policy matching. See ADR-008. Optional in v1, required in v1.1.",
    },
    agent_name: {
      type: "string",
      description: "Human-readable agent name for display and baseline lookups.",
    },
    model: {
      type: "string",
      description:
        "The LLM model identifier (e.g., 'gpt-4o', 'claude-3-5-sonnet'). Used for cost estimation.",
    },
    input_tokens: {
      type: "integer",
      minimum: 0,
      description: "Input/prompt token count for this call, if known.",
    },
    output_tokens: {
      type: "integer",
      minimum: 0,
      description: "Output/completion token count for this call, if known.",
    },
    estimated_cost_usd: {
      type: "number",
      minimum: 0,
      description: "Shim-estimated cost for this call in USD, if computed.",
    },
    environment: {
      type: "string",
      description:
        "Deployment environment tag (e.g., 'production', 'staging', 'development'). Used in policy condition matching.",
    },
    ts: {
      type: "string",
      format: "date-time",
      description: "ISO 8601 timestamp of when the shim intercepted the call.",
    },
  },
  additionalProperties: false,
};

export const decisionResponseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.loopstorm.dev/ipc/decision-response.schema.json",
  title: "LoopStorm DecisionResponse",
  description:
    "Response sent from the engine to the shim after evaluating a tool call. See ADR-001.",
  type: "object",
  required: ["schema_version", "run_id", "seq", "decision"],
  properties: {
    schema_version: {
      type: "integer",
      const: 1,
      description: "Schema version matching the request.",
    },
    run_id: {
      type: "string",
      format: "uuid",
      description: "Echo of the run_id from the request.",
    },
    seq: {
      type: "integer",
      minimum: 1,
      description: "Echo of the seq from the request.",
    },
    decision: {
      type: "string",
      enum: ["allow", "deny", "cooldown", "kill", "require_approval"],
      description:
        "The enforcement decision. allow: call proceeds. deny: call blocked. cooldown: loop detected, pause. kill: run terminated. require_approval: held for human approval (v1.1).",
    },
    rule_id: {
      type: "string",
      description: "The ID of the policy rule that produced this decision, if applicable.",
    },
    reason: {
      type: "string",
      description: "Human-readable explanation of the decision.",
    },
    cooldown_ms: {
      type: "integer",
      minimum: 0,
      description:
        "Milliseconds the shim should pause before allowing the agent to retry. Only meaningful when decision is 'cooldown'.",
    },
    cooldown_message: {
      type: "string",
      description:
        "Corrective context message to inject into the agent's context during cooldown. Only meaningful when decision is 'cooldown'.",
    },
    approval_id: {
      type: "string",
      description:
        "Identifier for the pending approval request. Only present when decision is 'require_approval'. The shim polls or subscribes for approval resolution.",
    },
    approval_timeout_ms: {
      type: "integer",
      minimum: 0,
      description:
        "Maximum time to wait for human approval before applying timeout_action. Only meaningful when decision is 'require_approval'.",
    },
    approval_timeout_action: {
      type: "string",
      enum: ["deny", "allow", "kill"],
      description:
        "Action to take if approval times out. Only meaningful when decision is 'require_approval'.",
    },
    budget_remaining: {
      type: "object",
      description: "Current budget state after this decision. Provided for shim-side visibility.",
      properties: {
        cost_usd: { type: "number" },
        input_tokens: { type: "integer" },
        output_tokens: { type: "integer" },
        call_count: { type: "integer" },
      },
      additionalProperties: false,
    },
    ts: {
      type: "string",
      format: "date-time",
      description: "ISO 8601 timestamp of when the engine produced the decision.",
    },
  },
  additionalProperties: false,
};

export const eventSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.loopstorm.dev/events/event.schema.json",
  title: "LoopStorm Event",
  description:
    "Schema for events written to the JSONL audit log and forwarded to the hosted backend. Each line in the JSONL file is one event conforming to this schema.",
  type: "object",
  required: ["schema_version", "event_type", "run_id", "seq", "hash", "ts"],
  properties: {
    schema_version: { type: "integer", const: 1, description: "Event schema version." },
    event_type: {
      type: "string",
      enum: [
        "run_started",
        "policy_decision",
        "budget_update",
        "budget_soft_cap_warning",
        "budget_exceeded",
        "loop_detected",
        "run_ended",
        "system_event",
        "supervisor_run_started",
        "supervisor_tool_call",
        "supervisor_proposal_created",
        "supervisor_escalation_created",
      ],
      description:
        "The type of event. Supervisor event types (supervisor_*) are reserved for the AI Supervisor's own audit trail.",
    },
    run_id: {
      type: "string",
      format: "uuid",
      description: "The run this event belongs to. Client-generated UUID v7 (ADR-004).",
    },
    seq: {
      type: "integer",
      minimum: 1,
      description:
        "Monotonically increasing sequence number within this run. Canonical ordering field.",
    },
    hash: {
      type: "string",
      pattern: "^[0-9a-f]{64}$",
      description:
        "SHA-256 hex digest of this event's payload (all fields except 'hash' and 'hash_prev').",
    },
    hash_prev: {
      type: ["string", "null"],
      pattern: "^[0-9a-f]{64}$",
      description:
        "SHA-256 hash of the previous event in this run's chain. Null for the first event (seq=1).",
    },
    ts: {
      type: "string",
      format: "date-time",
      description: "ISO 8601 timestamp of when this event was created by the engine.",
    },
    agent_name: { type: "string", description: "Human-readable name of the agent." },
    agent_role: { type: "string", description: "The agent's role tag (ADR-008)." },
    tool: {
      type: "string",
      description: "Tool name. Present on policy_decision, supervisor_tool_call events.",
    },
    args_hash: {
      type: "string",
      pattern: "^[0-9a-f]{64}$",
      description:
        "SHA-256 of RFC 8785 canonical JSON of the original (pre-redaction) tool arguments.",
    },
    args_redacted: {
      type: "object",
      description: "Tool arguments after redaction. Sensitive values replaced with typed markers.",
      additionalProperties: true,
    },
    decision: {
      type: "string",
      enum: ["allow", "deny", "cooldown", "kill", "require_approval"],
      description: "The enforcement decision for this call. Present on policy_decision events.",
    },
    rule_id: { type: "string", description: "The policy rule that produced the decision." },
    reason: { type: "string", description: "Human-readable reason for the decision or event." },
    budget: {
      type: "object",
      description: "Current budget state at the time of this event.",
      properties: {
        cost_usd: {
          type: "object",
          properties: {
            current: { type: "number" },
            soft: { type: "number" },
            hard: { type: "number" },
          },
          additionalProperties: false,
        },
        input_tokens: {
          type: "object",
          properties: {
            current: { type: "integer" },
            soft: { type: "integer" },
            hard: { type: "integer" },
          },
          additionalProperties: false,
        },
        output_tokens: {
          type: "object",
          properties: {
            current: { type: "integer" },
            soft: { type: "integer" },
            hard: { type: "integer" },
          },
          additionalProperties: false,
        },
        call_count: {
          type: "object",
          properties: {
            current: { type: "integer" },
            soft: { type: "integer" },
            hard: { type: "integer" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    dimension: {
      type: "string",
      description:
        "The budget dimension that triggered a warning or exceeded event (e.g., 'cost_usd', 'call_count').",
    },
    loop_rule: {
      type: "string",
      description: "The loop detection rule that fired. Present on loop_detected events.",
    },
    loop_action: {
      type: "string",
      enum: ["cooldown", "kill"],
      description: "The action taken in response to loop detection.",
    },
    cooldown_ms: { type: "integer", minimum: 0, description: "Cooldown duration applied." },
    run_status: {
      type: "string",
      enum: [
        "started",
        "completed",
        "terminated_budget",
        "terminated_loop",
        "terminated_policy",
        "abandoned",
        "error",
      ],
      description: "Run lifecycle status. Present on run_started and run_ended events.",
    },
    system_event_type: {
      type: "string",
      description:
        "Subtype for system_event events (e.g., 'queue_backpressure_activated', 'engine_started', 'safe_partial_output').",
    },
    model: { type: "string", description: "LLM model identifier." },
    input_tokens: { type: "integer", minimum: 0, description: "Input tokens for this call." },
    output_tokens: { type: "integer", minimum: 0, description: "Output tokens for this call." },
    estimated_cost_usd: {
      type: "number",
      minimum: 0,
      description: "Estimated cost for this call.",
    },
    latency_ms: { type: "number", minimum: 0, description: "Engine processing latency in milliseconds." },
    policy_pack_id: { type: "string", description: "Identifier of the active policy pack." },
    environment: { type: "string", description: "Deployment environment tag." },
    supervisor_run_id: {
      type: "string",
      description: "Supervisor run identifier. Present on supervisor_* events.",
    },
    trigger: {
      type: "string",
      description: "What triggered the supervisor run. Present on supervisor_run_started.",
    },
    trigger_run_id: {
      type: "string",
      description: "The run_id that triggered the supervisor. Present on supervisor_run_started.",
    },
    proposal_id: {
      type: "string",
      description: "Proposal identifier. Present on supervisor_proposal_created.",
    },
    proposal_type: {
      type: "string",
      description:
        "Type of proposal (e.g., 'budget_adjustment'). Present on supervisor_proposal_created.",
    },
    target_agent: {
      type: "string",
      description: "The agent targeted by a supervisor proposal.",
    },
    rationale: {
      type: "string",
      description: "Supervisor's rationale for a proposal.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Supervisor's confidence in a proposal or assessment.",
    },
    supporting_runs: {
      type: "array",
      items: { type: "string" },
      description: "Run IDs supporting a supervisor proposal.",
    },
    status: {
      type: "string",
      description:
        "Status of a proposal or escalation (e.g., 'pending_approval', 'approved', 'denied').",
    },
    escalation_id: {
      type: "string",
      description: "Escalation identifier. Present on supervisor_escalation_created.",
    },
    severity: {
      type: "string",
      enum: ["low", "medium", "high", "critical"],
      description: "Severity of an escalation or flag.",
    },
    recommendation: {
      type: "string",
      description: "Supervisor's recommendation in an escalation.",
    },
    timeout_seconds: {
      type: "integer",
      minimum: 0,
      description: "Timeout for human response on an escalation.",
    },
    timeout_action: {
      type: "string",
      enum: ["deny", "allow", "kill"],
      description: "Action if escalation times out without human response.",
    },
    call_seq_fingerprint: {
      type: "string",
      pattern: "^[0-9a-f]{64}$",
      description:
        "SHA-256 of the last N (tool, args_hash) tuples in this run. Rolling window N=5. See specs/behavioral-telemetry.md.",
    },
    inter_call_ms: {
      type: "integer",
      minimum: 0,
      description:
        "Milliseconds since the previous DecisionRequest in this run. 0 for the first call. See specs/behavioral-telemetry.md.",
    },
    token_rate_delta: {
      type: "number",
      minimum: 0,
      description:
        "Ratio of this call's token consumption to the run's rolling average. 1.0 = baseline. See specs/behavioral-telemetry.md.",
    },
    param_shape_hash: {
      type: "string",
      pattern: "^[0-9a-f]{64}$",
      description:
        "SHA-256 of the sorted top-level keys of args_redacted. See specs/behavioral-telemetry.md.",
    },
  },
  additionalProperties: false,
};
