// SPDX-License-Identifier: MIT
/**
 * CLI entry point for the LoopStorm MCP proxy.
 * Usage: loopstorm-mcp-proxy --config loopstorm-proxy.yaml
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../src/config.js";
import { LoopStormProxy } from "../src/proxy.js";

function parseArgs(argv: string[]): { config: string; transport?: string; port?: number } {
  let config = process.env.LOOPSTORM_PROXY_CONFIG ?? "loopstorm-proxy.yaml";
  let transport: string | undefined;
  let port: number | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--config" && argv[i + 1]) {
      config = argv[++i] ?? config;
    } else if (arg === "--transport" && argv[i + 1]) {
      transport = argv[++i];
    } else if (arg === "--port" && argv[i + 1]) {
      port = Number.parseInt(argv[++i] ?? "0", 10);
    } else if (arg === "--version") {
      console.log("loopstorm-mcp-proxy 0.1.0");
      process.exit(0);
    } else if (arg === "--help") {
      console.log(`Usage: loopstorm-mcp-proxy [options]

Options:
  --config <path>     Config file (default: loopstorm-proxy.yaml or $LOOPSTORM_PROXY_CONFIG)
  --transport <type>  Override transport (stdio or http)
  --port <number>     Override HTTP port
  --version           Show version
  --help              Show this help`);
      process.exit(0);
    }
  }
  return { config, transport, port };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const config = loadConfig(args.config);
  if (args.transport) {
    config.transport.type = args.transport as "stdio" | "http";
  }
  if (args.port !== undefined) {
    config.transport.port = args.port;
  }

  const proxy = new LoopStormProxy(config);

  // Connect to upstream MCP servers
  await proxy.connectUpstreams();

  if (config.transport.type === "stdio") {
    const transport = new StdioServerTransport();
    await proxy.getServer().connect(transport);
    console.error("[loopstorm-mcp-proxy] Running on stdio transport");
  } else {
    console.error("[loopstorm-mcp-proxy] HTTP transport not yet implemented in v1.1");
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.error("[loopstorm-mcp-proxy] Shutting down...");
    await proxy.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[loopstorm-mcp-proxy] Fatal:", err);
  process.exit(1);
});
