// SPDX-License-Identifier: MIT

import { ConsoleSpanExporter, type SpanExporter } from "@opentelemetry/sdk-trace-base";

export interface ExporterConfig {
  console: boolean;
  protocol: "http/protobuf" | "grpc";
  endpoint: string;
  headers: Record<string, string>;
}

/** Minimal interface for lazily-loaded OTLP exporters. */
interface OtlpExporterModule {
  OTLPTraceExporter: new (options: {
    url: string;
    headers?: Record<string, string>;
    metadata?: Record<string, string>;
  }) => SpanExporter;
}

/**
 * Create the appropriate OTel span exporter based on configuration.
 *
 * - console: ConsoleSpanExporter (built-in, no extra dependency)
 * - grpc: OTLPTraceExporter from @opentelemetry/exporter-trace-otlp-grpc
 * - http/protobuf (default): OTLPTraceExporter from @opentelemetry/exporter-trace-otlp-http
 *
 * Lazy loading: require() the gRPC or HTTP module at runtime so unused
 * protocol dependencies are not initialized. Spec: Gate OTEL-G9
 */
export function createExporter(config: ExporterConfig): SpanExporter {
  if (config.console) {
    return new ConsoleSpanExporter();
  }

  if (config.protocol === "grpc") {
    const grpcModule =
      require("@opentelemetry/exporter-trace-otlp-grpc") as unknown as OtlpExporterModule;
    return new grpcModule.OTLPTraceExporter({
      url: config.endpoint,
      metadata: config.headers,
    });
  }

  // Default: http/protobuf
  const httpModule =
    require("@opentelemetry/exporter-trace-otlp-http") as unknown as OtlpExporterModule;
  return new httpModule.OTLPTraceExporter({
    url: config.endpoint,
    headers: config.headers,
  });
}

/**
 * Parse the OTEL_EXPORTER_OTLP_HEADERS env var.
 * Format: key1=value1,key2=value2
 */
export function parseOtlpHeaders(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw.trim()) return result;

  for (const pair of raw.split(",")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (key) {
      result[key] = value;
    }
  }

  return result;
}
