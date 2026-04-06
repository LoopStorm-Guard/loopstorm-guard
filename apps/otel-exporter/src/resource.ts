// SPDX-License-Identifier: MIT

import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  // ATTR_DEPLOYMENT_ENVIRONMENT_NAME is the stable name introduced in
  // semantic-conventions >=1.27. Installed version uses the legacy
  // SEMRESATTRS_DEPLOYMENT_ENVIRONMENT constant.
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions";
import type { ParsedEvent } from "./types.js";

export interface ResourceConfig {
  serviceName: string;
  serviceVersion: string;
}

/**
 * Build an OTel Resource for a trace.
 *
 * The resource is constructed once per trace (on first event) and
 * reused for all spans in that trace.
 *
 * Supervisor detection: if event_type = supervisor_run_started OR
 * agent_role = "supervisor", override service.name to "loopstorm-supervisor".
 *
 * Spec: Gate OTEL-G10, Gate OTEL-G3 (resource attributes)
 */
export function buildResource(firstEvent: ParsedEvent, config: ResourceConfig): Resource {
  const isSupervisor =
    firstEvent.event_type === "supervisor_run_started" || firstEvent.agent_role === "supervisor";

  const serviceName = isSupervisor ? "loopstorm-supervisor" : config.serviceName;

  // biome-ignore lint/suspicious/noExplicitAny: OTel Resource attributes type requires any
  const attrs: Record<string, any> = {
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
  };

  if (firstEvent.agent_name !== undefined) {
    attrs["loopstorm.agent.name"] = firstEvent.agent_name;
  }
  if (firstEvent.agent_role !== undefined) {
    attrs["loopstorm.agent.role"] = firstEvent.agent_role;
  }
  if (firstEvent.policy_pack_id !== undefined) {
    attrs["loopstorm.policy_pack_id"] = firstEvent.policy_pack_id;
  }
  if (firstEvent.environment !== undefined) {
    attrs[SEMRESATTRS_DEPLOYMENT_ENVIRONMENT] = firstEvent.environment;
  }

  return new Resource(attrs);
}
