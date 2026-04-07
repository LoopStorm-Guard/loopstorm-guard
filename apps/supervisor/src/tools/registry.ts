// SPDX-License-Identifier: MIT
/**
 * Tool registry for the AI Supervisor.
 *
 * Maps tool names to handler functions and Claude tool schema definitions.
 * The session manager uses this to dispatch tool calls and generate the
 * tools array for Claude API requests.
 */

import type { BackendClient } from "../lib/backend-client.js";
import type { ToolDefinition } from "../llm/provider.js";
import { escalateToHuman } from "./escalation.js";
import {
  analyzeLoopPatternTool,
  computeRiskScoreTool,
  evaluateRecoveryEffectivenessTool,
} from "./interpretation.js";
import {
  recordIncidentPattern,
  recordInterventionOutcome,
  updateAgentProfile,
} from "./learning.js";
import {
  querySimilarRuns,
  readAgentBaseline,
  readPolicyPack,
  readRunEvents,
} from "./observation.js";
import { flagForReview, proposeBudgetAdjustment } from "./proposal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolHandler = (
  client: BackendClient,
  supervisorRunId: string,
  params: Record<string, unknown>
) => Promise<unknown>;

interface ToolEntry {
  handler: ToolHandler;
  schema: ToolDefinition;
}

// ---------------------------------------------------------------------------
// Handler wrappers (adapt per-tool signatures to unified ToolHandler)
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: tool params are dynamically typed from LLM
function wrap(fn: (client: BackendClient, params: any) => Promise<unknown>): ToolHandler {
  return (client, _supervisorRunId, params) => fn(client, params);
}

// biome-ignore lint/suspicious/noExplicitAny: tool params are dynamically typed from LLM
function wrapWithRunId(
  fn: (client: BackendClient, supervisorRunId: string, params: any) => Promise<unknown>
): ToolHandler {
  return (client, supervisorRunId, params) => fn(client, supervisorRunId, params);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TOOL_REGISTRY: Record<string, ToolEntry> = {
  // --- Observation tools ---
  read_run_events: {
    handler: wrap(readRunEvents),
    schema: {
      name: "read_run_events",
      description:
        "Read events from a specific agent run. Returns paginated events sorted by sequence number.",
      input_schema: {
        type: "object",
        properties: {
          run_id: { type: "string", description: "UUID of the run to read events from" },
          event_type: {
            type: "string",
            description: "Filter by event type (e.g., 'policy_decision', 'loop_detected')",
          },
          offset_seq: {
            type: "integer",
            description: "Start reading from this sequence number (for pagination)",
          },
          limit: {
            type: "integer",
            description: "Maximum number of events to return (default 500, max 1000)",
          },
        },
        required: ["run_id"],
      },
    },
  },

  read_agent_baseline: {
    handler: wrap(readAgentBaseline),
    schema: {
      name: "read_agent_baseline",
      description:
        "Get aggregate baseline statistics for a named agent. Includes average cost, deny rate, call counts over a lookback window.",
      input_schema: {
        type: "object",
        properties: {
          agent_name: { type: "string", description: "Name of the agent to look up" },
          lookback_days: {
            type: "integer",
            description: "Number of days to look back (default 30, max 365)",
          },
        },
        required: ["agent_name"],
      },
    },
  },

  read_policy_pack: {
    handler: wrap(readPolicyPack),
    schema: {
      name: "read_policy_pack",
      description:
        "Fetch a policy pack by its UUID. Returns the full policy configuration including rules and budget settings.",
      input_schema: {
        type: "object",
        properties: {
          policy_pack_id: { type: "string", description: "UUID of the policy pack to fetch" },
        },
        required: ["policy_pack_id"],
      },
    },
  },

  query_similar_runs: {
    handler: wrap(querySimilarRuns),
    schema: {
      name: "query_similar_runs",
      description:
        "Find runs with similar behavioral fingerprints. Uses call_seq_fingerprint prefix matching.",
      input_schema: {
        type: "object",
        properties: {
          fingerprint: { type: "string", description: "64-char hex fingerprint to match against" },
          scope: {
            type: "string",
            enum: ["customer", "anonymous_aggregate"],
            description: "Search scope (default: customer)",
          },
          top_k: { type: "integer", description: "Maximum number of runs to return (default 10)" },
        },
        required: ["fingerprint"],
      },
    },
  },

  // --- Interpretation tools ---
  compute_risk_score: {
    handler: wrap(computeRiskScoreTool),
    schema: {
      name: "compute_risk_score",
      description:
        "Compute a deterministic risk score for a run. Returns score (0-100), tier (LOW/MEDIUM/HIGH/CRITICAL), signals, and narrative.",
      input_schema: {
        type: "object",
        properties: {
          run_id: { type: "string", description: "UUID of the run to assess" },
        },
        required: ["run_id"],
      },
    },
  },

  analyze_loop_pattern: {
    handler: wrap(analyzeLoopPatternTool),
    schema: {
      name: "analyze_loop_pattern",
      description:
        "Analyze loop detection patterns in a run. Identifies repeated tool sequences and whether cooldowns were effective.",
      input_schema: {
        type: "object",
        properties: {
          run_id: { type: "string", description: "UUID of the run to analyze" },
        },
        required: ["run_id"],
      },
    },
  },

  evaluate_recovery_effectiveness: {
    handler: wrap(evaluateRecoveryEffectivenessTool),
    schema: {
      name: "evaluate_recovery_effectiveness",
      description:
        "Evaluate whether an intervention (cooldown, deny) changed agent behavior. Compares events before and after the intervention point.",
      input_schema: {
        type: "object",
        properties: {
          run_id: { type: "string", description: "UUID of the run" },
          intervention_seq: {
            type: "integer",
            description: "Sequence number of the intervention event",
          },
        },
        required: ["run_id", "intervention_seq"],
      },
    },
  },

  // --- Proposal tools ---
  propose_budget_adjustment: {
    handler: wrapWithRunId(proposeBudgetAdjustment),
    schema: {
      name: "propose_budget_adjustment",
      description:
        "Propose a budget adjustment for an agent. Requires human approval. Include supporting evidence from multiple runs.",
      input_schema: {
        type: "object",
        properties: {
          target_agent: { type: "string", description: "Name of the agent to adjust" },
          dimension: {
            type: "string",
            description: "Budget dimension (e.g., 'cost_usd', 'call_count')",
          },
          current_value: { type: "number", description: "Current budget value" },
          proposed_value: { type: "number", description: "Proposed new budget value" },
          rationale: { type: "string", description: "Explanation for the proposed change" },
          confidence: { type: "number", description: "Confidence score 0.0-1.0" },
          supporting_run_ids: {
            type: "array",
            items: { type: "string" },
            description: "Run IDs that support this proposal (minimum 2)",
          },
          trigger_run_id: { type: "string", description: "UUID of the triggering run" },
        },
        required: [
          "target_agent",
          "dimension",
          "current_value",
          "proposed_value",
          "rationale",
          "confidence",
          "supporting_run_ids",
        ],
      },
    },
  },

  flag_for_review: {
    handler: wrapWithRunId(flagForReview),
    schema: {
      name: "flag_for_review",
      description:
        "Flag an issue for human review. Use when you identify a pattern that needs attention but don't have a specific budget adjustment to propose.",
      input_schema: {
        type: "object",
        properties: {
          target_agent: { type: "string", description: "Name of the agent (optional)" },
          rationale: { type: "string", description: "Description of the issue" },
          confidence: { type: "number", description: "Confidence score 0.0-1.0" },
          supporting_run_ids: {
            type: "array",
            items: { type: "string" },
            description: "Run IDs that demonstrate the issue",
          },
          recommendation: { type: "string", description: "Specific recommended action" },
          trigger_run_id: { type: "string", description: "UUID of the triggering run" },
        },
        required: ["rationale", "confidence", "supporting_run_ids", "recommendation"],
      },
    },
  },

  // --- Escalation tool ---
  escalate_to_human: {
    handler: wrapWithRunId(escalateToHuman),
    schema: {
      name: "escalate_to_human",
      description:
        "Escalate an issue to a human operator for immediate attention. Use for CRITICAL risk or when uncertain. This tool ALWAYS succeeds.",
      input_schema: {
        type: "object",
        properties: {
          severity: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
            description: "Severity level",
          },
          rationale: { type: "string", description: "Why this needs human attention" },
          recommendation: { type: "string", description: "Recommended action for the operator" },
          confidence: { type: "number", description: "Confidence score 0.0-1.0" },
          supporting_run_ids: {
            type: "array",
            items: { type: "string" },
            description: "Run IDs as evidence",
          },
          timeout_seconds: {
            type: "integer",
            description: "Seconds before timeout_action is taken (optional)",
          },
          timeout_action: {
            type: "string",
            enum: ["deny", "allow", "kill"],
            description: "Action on timeout (optional)",
          },
          trigger_run_id: { type: "string", description: "UUID of the triggering run" },
        },
        required: ["severity", "rationale", "confidence", "supporting_run_ids"],
      },
    },
  },

  // --- Learning tools ---
  record_incident_pattern: {
    handler: wrapWithRunId(recordIncidentPattern),
    schema: {
      name: "record_incident_pattern",
      description:
        "Record a newly observed incident pattern for future reference. Auto-approved (observation, not a change request).",
      input_schema: {
        type: "object",
        properties: {
          target_agent: { type: "string", description: "Agent name (optional)" },
          pattern_description: {
            type: "string",
            description: "Description of the observed pattern",
          },
          confidence: { type: "number", description: "Confidence score 0.0-1.0" },
          supporting_run_ids: {
            type: "array",
            items: { type: "string" },
            description: "Run IDs where this pattern was observed",
          },
          trigger_run_id: { type: "string", description: "UUID of the triggering run" },
        },
        required: ["pattern_description", "confidence", "supporting_run_ids"],
      },
    },
  },

  update_agent_profile: {
    handler: wrapWithRunId(updateAgentProfile),
    schema: {
      name: "update_agent_profile",
      description:
        "Update the supervisor's notes about an agent's typical behavior. Auto-approved (observation, not a change request).",
      input_schema: {
        type: "object",
        properties: {
          target_agent: { type: "string", description: "Agent name" },
          profile_update: {
            type: "object",
            description: "Key-value pairs to update in the agent profile",
          },
          rationale: { type: "string", description: "Why this update is relevant" },
          confidence: { type: "number", description: "Confidence score 0.0-1.0" },
          supporting_run_ids: {
            type: "array",
            items: { type: "string" },
            description: "Run IDs that support this profile update",
          },
          trigger_run_id: { type: "string", description: "UUID of the triggering run" },
        },
        required: [
          "target_agent",
          "profile_update",
          "rationale",
          "confidence",
          "supporting_run_ids",
        ],
      },
    },
  },

  record_intervention_outcome: {
    handler: wrapWithRunId(recordInterventionOutcome),
    schema: {
      name: "record_intervention_outcome",
      description:
        "Record the outcome of a previous supervisor intervention. Helps calibrate future recommendations. Auto-approved.",
      input_schema: {
        type: "object",
        properties: {
          target_agent: { type: "string", description: "Agent name (optional)" },
          intervention_type: {
            type: "string",
            description:
              "Type of intervention (e.g., 'budget_adjustment', 'loop_threshold_change')",
          },
          outcome: {
            type: "string",
            description: "Observed outcome (e.g., 'effective', 'ineffective', 'partial')",
          },
          rationale: { type: "string", description: "Detailed explanation of the outcome" },
          confidence: { type: "number", description: "Confidence score 0.0-1.0" },
          supporting_run_ids: {
            type: "array",
            items: { type: "string" },
            description: "Run IDs showing the outcome",
          },
          trigger_run_id: { type: "string", description: "UUID of the triggering run" },
        },
        required: ["intervention_type", "outcome", "rationale", "confidence", "supporting_run_ids"],
      },
    },
  },
};

/**
 * Get all tool definitions for Claude API requests.
 */
export function getToolDefinitions(): ToolDefinition[] {
  return Object.values(TOOL_REGISTRY).map((entry) => entry.schema);
}
