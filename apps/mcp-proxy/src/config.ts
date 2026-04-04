// SPDX-License-Identifier: MIT
/**
 * Proxy configuration parser.
 * Spec: specs/mcp-proxy-mode.md Section 6
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export interface UpstreamTransportConfig {
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

export interface UpstreamConfig {
  id: string;
  transport: UpstreamTransportConfig;
  prefix: boolean;
}

export interface ProxyTransportConfig {
  type: "stdio" | "http";
  port: number;
  host: string;
}

export interface ProxyConfig {
  schema_version: number;
  engine_socket: string;
  transport: ProxyTransportConfig;
  agent_name?: string;
  agent_role?: string;
  environment?: string;
  upstreams: UpstreamConfig[];
}

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "localhost", "::1"]);

export function loadConfig(configPath: string): ProxyConfig {
  const raw = readFileSync(configPath, "utf-8");
  const doc = parseYaml(raw) as Record<string, unknown>;
  return validateConfig(doc);
}

export function validateConfig(doc: Record<string, unknown>): ProxyConfig {
  if (doc.schema_version !== 1) {
    throw new Error(`Unsupported schema_version: ${doc.schema_version} (expected 1)`);
  }

  const transport = doc.transport as Record<string, unknown> | undefined;
  if (!transport || !transport.type) {
    throw new Error("transport.type is required (stdio or http)");
  }
  if (transport.type !== "stdio" && transport.type !== "http") {
    throw new Error(`Invalid transport.type: ${transport.type} (expected stdio or http)`);
  }

  const host = (transport.host as string) ?? "127.0.0.1";
  if (transport.type === "http" && !LOOPBACK_ADDRESSES.has(host)) {
    throw new Error(
      `Non-loopback transport.host "${host}" is not supported in v1.1. Use 127.0.0.1, localhost, or ::1.`
    );
  }

  const upstreams = doc.upstreams as unknown[] | undefined;
  if (!upstreams || !Array.isArray(upstreams) || upstreams.length === 0) {
    throw new Error("At least one upstream is required");
  }

  const parsedUpstreams: UpstreamConfig[] = upstreams.map((u, i) => {
    const up = u as Record<string, unknown>;
    if (!up.id || typeof up.id !== "string") {
      throw new Error(`upstreams[${i}].id is required`);
    }
    const ut = up.transport as Record<string, unknown> | undefined;
    if (!ut || !ut.type) {
      throw new Error(`upstreams[${i}].transport.type is required`);
    }
    if (ut.type !== "stdio" && ut.type !== "http" && ut.type !== "sse") {
      throw new Error(`Invalid upstreams[${i}].transport.type: ${ut.type}`);
    }
    if (ut.type === "stdio" && !ut.command) {
      throw new Error(`upstreams[${i}].transport.command is required for stdio transport`);
    }
    if ((ut.type === "http" || ut.type === "sse") && !ut.url) {
      throw new Error(`upstreams[${i}].transport.url is required for ${ut.type} transport`);
    }
    return {
      id: up.id as string,
      transport: {
        type: ut.type as "stdio" | "http" | "sse",
        command: ut.command as string | undefined,
        args: (ut.args as string[]) ?? [],
        url: ut.url as string | undefined,
        headers: ut.headers as Record<string, string> | undefined,
      },
      prefix: (up.prefix as boolean) ?? false,
    };
  });

  const engineSocket =
    (doc.engine_socket as string) ??
    (process.platform === "win32" ? "\\\\.\\pipe\\loopstorm-engine" : "/tmp/loopstorm-engine.sock");

  return {
    schema_version: 1,
    engine_socket: engineSocket,
    transport: {
      type: transport.type as "stdio" | "http",
      port: (transport.port as number) ?? 3100,
      host,
    },
    agent_name: doc.agent_name as string | undefined,
    agent_role: doc.agent_role as string | undefined,
    environment: doc.environment as string | undefined,
    upstreams: parsedUpstreams,
  };
}
