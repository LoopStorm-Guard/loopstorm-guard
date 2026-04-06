// SPDX-License-Identifier: MIT

import type { Attributes } from "@opentelemetry/api";
import type { ParsedEvent } from "./types.js";

/**
 * Build OTel Attributes from a parsed event.
 *
 * Rules (spec Gate OTEL-G3):
 * - Null/undefined fields are OMITTED (not set as empty).
 * - Exception: hash_prev null -> set loopstorm.hash_prev = "" (always expected).
 * - args_redacted serialized as JSON string.
 * - supporting_runs array serialized as JSON string.
 * - budget object flattened to loopstorm.budget.* dot-separated keys.
 * - JSON types mapped: string->STRING, integer->INT64, float->DOUBLE,
 *   object->STRING (serialized), array->STRING (serialized).
 */
export function buildAttributes(event: ParsedEvent): Attributes {
  const attrs: Attributes = {};

  // Core attributes (all spans)
  attrs["loopstorm.schema_version"] = event.schema_version;
  attrs["loopstorm.hash"] = event.hash;

  // hash_prev: null -> "" (exception rule per spec)
  attrs["loopstorm.hash_prev"] = event.hash_prev ?? "";

  // Policy decision attributes
  if (event.decision !== undefined) {
    attrs["loopstorm.decision"] = event.decision;
  }
  if (event.rule_id !== undefined) {
    attrs["loopstorm.rule_id"] = event.rule_id;
  }
  if (event.reason !== undefined) {
    attrs["loopstorm.reason"] = event.reason;
  }
  if (event.tool !== undefined) {
    attrs["loopstorm.tool"] = event.tool;
  }
  if (event.args_hash !== undefined) {
    attrs["loopstorm.args_hash"] = event.args_hash;
  }
  if (event.args_redacted !== undefined) {
    attrs["loopstorm.args_redacted"] = JSON.stringify(event.args_redacted);
  }
  if (event.model !== undefined) {
    attrs["loopstorm.model"] = event.model;
  }
  if (event.input_tokens !== undefined) {
    attrs["loopstorm.input_tokens"] = event.input_tokens;
  }
  if (event.output_tokens !== undefined) {
    attrs["loopstorm.output_tokens"] = event.output_tokens;
  }
  if (event.estimated_cost_usd !== undefined) {
    attrs["loopstorm.estimated_cost_usd"] = event.estimated_cost_usd;
  }
  if (event.latency_ms !== undefined) {
    attrs["loopstorm.latency_ms"] = event.latency_ms;
  }

  // Budget object: flatten to loopstorm.budget.*
  if (event.budget !== undefined) {
    const b = event.budget;
    if (b.cost_usd !== undefined) {
      if (b.cost_usd.current !== undefined) {
        attrs["loopstorm.budget.cost_usd.current"] = b.cost_usd.current;
      }
      if (b.cost_usd.soft !== undefined) {
        attrs["loopstorm.budget.cost_usd.soft"] = b.cost_usd.soft;
      }
      if (b.cost_usd.hard !== undefined) {
        attrs["loopstorm.budget.cost_usd.hard"] = b.cost_usd.hard;
      }
    }
    if (b.input_tokens !== undefined) {
      if (b.input_tokens.current !== undefined) {
        attrs["loopstorm.budget.input_tokens.current"] = b.input_tokens.current;
      }
      if (b.input_tokens.soft !== undefined) {
        attrs["loopstorm.budget.input_tokens.soft"] = b.input_tokens.soft;
      }
      if (b.input_tokens.hard !== undefined) {
        attrs["loopstorm.budget.input_tokens.hard"] = b.input_tokens.hard;
      }
    }
    if (b.output_tokens !== undefined) {
      if (b.output_tokens.current !== undefined) {
        attrs["loopstorm.budget.output_tokens.current"] = b.output_tokens.current;
      }
      if (b.output_tokens.soft !== undefined) {
        attrs["loopstorm.budget.output_tokens.soft"] = b.output_tokens.soft;
      }
      if (b.output_tokens.hard !== undefined) {
        attrs["loopstorm.budget.output_tokens.hard"] = b.output_tokens.hard;
      }
    }
    if (b.call_count !== undefined) {
      if (b.call_count.current !== undefined) {
        attrs["loopstorm.budget.call_count.current"] = b.call_count.current;
      }
      if (b.call_count.soft !== undefined) {
        attrs["loopstorm.budget.call_count.soft"] = b.call_count.soft;
      }
      if (b.call_count.hard !== undefined) {
        attrs["loopstorm.budget.call_count.hard"] = b.call_count.hard;
      }
    }
  }
  if (event.dimension !== undefined) {
    attrs["loopstorm.budget.dimension"] = event.dimension;
  }

  // Loop detection attributes
  if (event.loop_rule !== undefined) {
    attrs["loopstorm.loop_rule"] = event.loop_rule;
  }
  if (event.loop_action !== undefined) {
    attrs["loopstorm.loop_action"] = event.loop_action;
  }
  if (event.cooldown_ms !== undefined) {
    attrs["loopstorm.cooldown_ms"] = event.cooldown_ms;
  }

  // Lifecycle attributes
  if (event.run_status !== undefined) {
    attrs["loopstorm.run_status"] = event.run_status;
  }
  if (event.system_event_type !== undefined) {
    attrs["loopstorm.system_event_type"] = event.system_event_type;
  }

  // Behavioral telemetry (v1.1) — loopstorm.telemetry.*
  if (event.call_seq_fingerprint !== undefined) {
    attrs["loopstorm.telemetry.call_seq_fingerprint"] = event.call_seq_fingerprint;
  }
  if (event.inter_call_ms !== undefined) {
    attrs["loopstorm.telemetry.inter_call_ms"] = event.inter_call_ms;
  }
  if (event.token_rate_delta !== undefined) {
    attrs["loopstorm.telemetry.token_rate_delta"] = event.token_rate_delta;
  }
  if (event.param_shape_hash !== undefined) {
    attrs["loopstorm.telemetry.param_shape_hash"] = event.param_shape_hash;
  }

  // Supervisor attributes
  if (event.supervisor_run_id !== undefined) {
    attrs["loopstorm.supervisor.run_id"] = event.supervisor_run_id;
  }
  if (event.trigger !== undefined) {
    attrs["loopstorm.supervisor.trigger"] = event.trigger;
  }
  if (event.trigger_run_id !== undefined) {
    attrs["loopstorm.supervisor.trigger_run_id"] = event.trigger_run_id;
  }
  if (event.proposal_id !== undefined) {
    attrs["loopstorm.supervisor.proposal_id"] = event.proposal_id;
  }
  if (event.proposal_type !== undefined) {
    attrs["loopstorm.supervisor.proposal_type"] = event.proposal_type;
  }
  if (event.target_agent !== undefined) {
    attrs["loopstorm.supervisor.target_agent"] = event.target_agent;
  }
  if (event.rationale !== undefined) {
    attrs["loopstorm.supervisor.rationale"] = event.rationale;
  }
  if (event.confidence !== undefined) {
    attrs["loopstorm.supervisor.confidence"] = event.confidence;
  }
  if (event.supporting_runs !== undefined) {
    attrs["loopstorm.supervisor.supporting_runs"] = JSON.stringify(event.supporting_runs);
  }
  if (event.status !== undefined) {
    attrs["loopstorm.supervisor.status"] = event.status;
  }
  if (event.escalation_id !== undefined) {
    attrs["loopstorm.supervisor.escalation_id"] = event.escalation_id;
  }
  if (event.severity !== undefined) {
    attrs["loopstorm.supervisor.severity"] = event.severity;
  }
  if (event.recommendation !== undefined) {
    attrs["loopstorm.supervisor.recommendation"] = event.recommendation;
  }
  if (event.timeout_seconds !== undefined) {
    attrs["loopstorm.supervisor.timeout_seconds"] = event.timeout_seconds;
  }
  if (event.timeout_action !== undefined) {
    attrs["loopstorm.supervisor.timeout_action"] = event.timeout_action;
  }

  return attrs;
}
