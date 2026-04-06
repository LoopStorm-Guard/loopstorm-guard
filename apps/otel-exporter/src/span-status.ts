// SPDX-License-Identifier: MIT

import { SpanStatusCode } from "@opentelemetry/api";

export interface SpanStatusResult {
  code: SpanStatusCode;
  message?: string;
}

/**
 * Map a policy_decision event's `decision` field to an OTel SpanStatus.
 * Spec: otel-span-mapping.md Sections 5.0-5.1
 */
export function decisionToSpanStatus(decision: string, reason?: string): SpanStatusResult {
  switch (decision) {
    case "allow":
      return { code: SpanStatusCode.OK };
    case "deny":
      return { code: SpanStatusCode.ERROR, message: reason ?? "" };
    case "cooldown":
      return { code: SpanStatusCode.OK };
    case "kill":
      return { code: SpanStatusCode.ERROR, message: reason ?? "" };
    case "require_approval":
      return { code: SpanStatusCode.UNSET };
    default:
      return { code: SpanStatusCode.UNSET };
  }
}

/**
 * Map an event_type (and optional run_status) to an OTel SpanStatus.
 * Spec: otel-span-mapping.md Section 5.2
 */
export function eventTypeToSpanStatus(eventType: string, runStatus?: string): SpanStatusResult {
  switch (eventType) {
    case "run_started":
      return { code: SpanStatusCode.UNSET };
    case "run_ended":
      if (runStatus === "completed") {
        return { code: SpanStatusCode.OK };
      }
      return { code: SpanStatusCode.ERROR };
    case "budget_update":
      return { code: SpanStatusCode.UNSET };
    case "budget_soft_cap_warning":
      return { code: SpanStatusCode.UNSET };
    case "budget_exceeded":
      return { code: SpanStatusCode.ERROR };
    case "loop_detected":
      return { code: SpanStatusCode.UNSET };
    case "system_event":
      return { code: SpanStatusCode.UNSET };
    case "supervisor_run_started":
      return { code: SpanStatusCode.UNSET };
    case "supervisor_tool_call":
      return { code: SpanStatusCode.OK };
    case "supervisor_proposal_created":
      return { code: SpanStatusCode.OK };
    case "supervisor_escalation_created":
      return { code: SpanStatusCode.OK };
    default:
      return { code: SpanStatusCode.UNSET };
  }
}

/**
 * Compute the span status for any event.
 * Uses decision mapping for policy_decision events; event_type mapping otherwise.
 */
export function spanStatusForEvent(
  eventType: string,
  decision?: string,
  reason?: string,
  runStatus?: string
): SpanStatusResult {
  if (eventType === "policy_decision" && decision !== undefined) {
    return decisionToSpanStatus(decision, reason);
  }
  return eventTypeToSpanStatus(eventType, runStatus);
}
