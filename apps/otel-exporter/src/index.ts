// SPDX-License-Identifier: MIT

export { traceId, spanId } from "./ids.js";
export {
  decisionToSpanStatus,
  eventTypeToSpanStatus,
  spanStatusForEvent,
} from "./span-status.js";
export { buildAttributes } from "./attributes.js";
export { buildResource, type ResourceConfig } from "./resource.js";
export {
  buildSpan,
  buildRootSpanEvent,
  finalizeRootSpan,
  buildIncompleteRootSpan,
} from "./span-builder.js";
export { TraceBuffer } from "./trace-buffer.js";
export { JsonlReader, readJsonlFile, type EventHandler } from "./jsonl-reader.js";
export {
  createExporter,
  parseOtlpHeaders,
  type ExporterConfig,
} from "./exporter-factory.js";
export { parseConfig, type OtelExporterConfig } from "./config.js";
export type {
  ParsedEvent,
  Budget,
  BudgetDimension,
  EventType,
  DecisionType,
  RunStatus,
} from "./types.js";
