// SPDX-License-Identifier: MIT

import { parseArgs } from "node:util";

export interface OtelExporterConfig {
  inputPath: string;
  endpoint: string;
  protocol: "http/protobuf" | "grpc";
  console: boolean;
  once: boolean;
  serviceName: string;
  serviceVersion: string;
  batchSize: number;
  flushIntervalMs: number;
  pollIntervalMs: number;
  bufferTimeoutMs: number;
  headers: Record<string, string>;
}

const DEFAULT_HTTP_ENDPOINT = "http://localhost:4318";
const DEFAULT_GRPC_ENDPOINT = "http://localhost:4317";
const DEFAULT_SERVICE_NAME = "loopstorm-engine";
const DEFAULT_SERVICE_VERSION = "0.1.0";
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_BUFFER_TIMEOUT_MS = 300_000;

const VERSION = "0.1.0";

const HELP_TEXT = `
loopstorm-otel-export — LoopStorm Guard OTel Exporter

USAGE:
  loopstorm-otel-export --input <path> [options]

OPTIONS:
  --input <path>            Path to the JSONL audit log (required)
                            Env: LOOPSTORM_AUDIT_PATH
  --endpoint <url>          OTLP collector endpoint
                            Env: OTEL_EXPORTER_OTLP_ENDPOINT
                            Default (HTTP): ${DEFAULT_HTTP_ENDPOINT}
                            Default (gRPC): ${DEFAULT_GRPC_ENDPOINT}
  --protocol <proto>        Transport: http/protobuf | grpc
                            Env: OTEL_EXPORTER_OTLP_PROTOCOL
                            Default: http/protobuf
  --console                 Output spans to stdout (debug mode)
                            Env: OTEL_EXPORTER=console
  --once                    Process file once and exit
  --service-name <name>     OTel service.name
                            Env: OTEL_SERVICE_NAME
                            Default: ${DEFAULT_SERVICE_NAME}
  --service-version <ver>   OTel service.version
                            Env: OTEL_SERVICE_VERSION
                            Default: ${DEFAULT_SERVICE_VERSION}
  --batch-size <n>          Max spans per export batch (default: ${DEFAULT_BATCH_SIZE})
  --flush-interval <ms>     Max ms between flushes (default: ${DEFAULT_FLUSH_INTERVAL_MS})
  --poll-interval <ms>      JSONL file poll interval (default: ${DEFAULT_POLL_INTERVAL_MS})
  --buffer-timeout <ms>     Max ms to buffer incomplete trace (default: ${DEFAULT_BUFFER_TIMEOUT_MS})
  --version                 Print version and exit
  --help                    Print this help and exit
`.trim();

/**
 * Parse CLI arguments and environment variables into a typed config.
 *
 * Resolution order (highest precedence first):
 * 1. CLI flags
 * 2. Environment variables
 * 3. Defaults
 *
 * Spec: Gate OTEL-G6, Task OTEL-10
 */
export function parseConfig(argv: string[]): OtelExporterConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: "string" },
      endpoint: { type: "string" },
      protocol: { type: "string" },
      console: { type: "boolean", default: false },
      once: { type: "boolean", default: false },
      "service-name": { type: "string" },
      "service-version": { type: "string" },
      "batch-size": { type: "string" },
      "flush-interval": { type: "string" },
      "poll-interval": { type: "string" },
      "buffer-timeout": { type: "string" },
      version: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: false,
  });

  if (values.version) {
    console.log(`loopstorm-otel-export v${VERSION}`);
    process.exit(0);
  }

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // Resolve protocol
  const rawProtocol =
    (typeof values.protocol === "string" ? values.protocol : undefined) ??
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL ??
    "http/protobuf";
  const protocol: "http/protobuf" | "grpc" = rawProtocol === "grpc" ? "grpc" : "http/protobuf";

  // Resolve endpoint
  const defaultEndpoint = protocol === "grpc" ? DEFAULT_GRPC_ENDPOINT : DEFAULT_HTTP_ENDPOINT;
  const endpoint =
    (typeof values.endpoint === "string" ? values.endpoint : undefined) ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    defaultEndpoint;

  // Resolve console mode
  const consoleMode = values.console === true || process.env.OTEL_EXPORTER === "console";

  // Resolve input path
  const inputPath =
    (typeof values.input === "string" ? values.input : undefined) ??
    process.env.LOOPSTORM_AUDIT_PATH ??
    "";
  if (!inputPath) {
    console.error("Error: --input <path> is required (or set LOOPSTORM_AUDIT_PATH)");
    process.exit(1);
  }

  // Resolve service metadata
  const serviceName =
    (typeof values["service-name"] === "string" ? values["service-name"] : undefined) ??
    process.env.OTEL_SERVICE_NAME ??
    DEFAULT_SERVICE_NAME;

  const serviceVersion =
    (typeof values["service-version"] === "string" ? values["service-version"] : undefined) ??
    process.env.OTEL_SERVICE_VERSION ??
    DEFAULT_SERVICE_VERSION;

  // Resolve headers
  const rawHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "";
  const headers = parseOtlpHeadersInline(rawHeaders);

  // Resolve numeric options — cast to string | undefined (parseArgs mixes types)
  const batchSize = parseIntOr(
    typeof values["batch-size"] === "string" ? values["batch-size"] : undefined,
    DEFAULT_BATCH_SIZE
  );
  const flushIntervalMs = parseIntOr(
    typeof values["flush-interval"] === "string" ? values["flush-interval"] : undefined,
    DEFAULT_FLUSH_INTERVAL_MS
  );
  const pollIntervalMs = parseIntOr(
    typeof values["poll-interval"] === "string" ? values["poll-interval"] : undefined,
    DEFAULT_POLL_INTERVAL_MS
  );
  const bufferTimeoutMs = parseIntOr(
    typeof values["buffer-timeout"] === "string" ? values["buffer-timeout"] : undefined,
    DEFAULT_BUFFER_TIMEOUT_MS
  );

  return {
    inputPath: typeof inputPath === "string" ? inputPath : "",
    endpoint: typeof endpoint === "string" ? endpoint : defaultEndpoint,
    protocol,
    console: consoleMode,
    once: values.once === true,
    serviceName: typeof serviceName === "string" ? serviceName : DEFAULT_SERVICE_NAME,
    serviceVersion: typeof serviceVersion === "string" ? serviceVersion : DEFAULT_SERVICE_VERSION,
    batchSize,
    flushIntervalMs,
    pollIntervalMs,
    bufferTimeoutMs,
    headers,
  };
}

function parseIntOr(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? defaultValue : n;
}

function parseOtlpHeadersInline(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw.trim()) return result;
  for (const pair of raw.split(",")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}
