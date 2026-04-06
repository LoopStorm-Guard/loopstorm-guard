// SPDX-License-Identifier: MIT

import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { parseConfig } from "../src/config.js";
import { createExporter } from "../src/exporter-factory.js";
import { TraceBuffer } from "../src/trace-buffer.js";
import { JsonlReader } from "../src/jsonl-reader.js";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));

  const exporter = createExporter({
    console: config.console,
    protocol: config.protocol,
    endpoint: config.endpoint,
    headers: config.headers,
  });

  const provider = new BasicTracerProvider();
  const batchProcessor = new BatchSpanProcessor(exporter, {
    maxExportBatchSize: config.batchSize,
    scheduledDelayMillis: config.flushIntervalMs,
  });
  provider.addSpanProcessor(batchProcessor);
  provider.register();

  const traceBuffer = new TraceBuffer({
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
  });

  // Flush spans to exporter
  function flushSpans(spans: ReadableSpan[]): void {
    for (const span of spans) {
      // biome-ignore lint/suspicious/noExplicitAny: accessing internal BatchSpanProcessor _exporter to export ReadableSpan objects directly
      const processor = batchProcessor as any;
      if (typeof processor.onEnd === "function") {
        processor.onEnd(span);
      }
    }
  }

  // Timeout flush interval
  let timeoutInterval: ReturnType<typeof setInterval> | null = null;
  if (!config.once) {
    timeoutInterval = setInterval(() => {
      const timedOut = traceBuffer.flushTimedOut(
        Date.now(),
        config.bufferTimeoutMs,
      );
      if (timedOut.length > 0) {
        flushSpans(timedOut);
      }
    }, Math.min(config.bufferTimeoutMs / 10, 30_000));
  }

  const reader = new JsonlReader(config.inputPath, (event) => {
    const spans = traceBuffer.addEvent(event);
    if (spans.length > 0) {
      flushSpans(spans);
    }
  }, { pollIntervalMs: config.pollIntervalMs });

  // Graceful shutdown
  async function shutdown(): Promise<void> {
    reader.stop();
    if (timeoutInterval !== null) {
      clearInterval(timeoutInterval);
    }
    const remaining = traceBuffer.flushAll();
    if (remaining.length > 0) {
      flushSpans(remaining);
    }
    await provider.shutdown();
    process.exit(0);
  }

  process.on("SIGINT", () => { shutdown().catch(console.error); });
  process.on("SIGTERM", () => { shutdown().catch(console.error); });

  if (config.once) {
    await reader.processOnce();

    // Flush timed-out and remaining
    const timedOut = traceBuffer.flushTimedOut(
      Date.now() + config.bufferTimeoutMs,
      0,
    );
    const remaining = traceBuffer.flushAll();
    flushSpans([...timedOut, ...remaining]);

    await provider.shutdown();
    return;
  }

  await reader.start();
  await shutdown();
}

main().catch((err: unknown) => {
  console.error("[loopstorm-otel] fatal error:", err);
  process.exit(1);
});
