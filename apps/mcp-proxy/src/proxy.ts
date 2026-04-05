// SPDX-License-Identifier: MIT
/**
 * Core MCP proxy — intercepts tools/call, consults the LoopStorm engine,
 * forwards allowed calls to upstream MCP servers.
 * Spec: specs/mcp-proxy-mode.md
 */

import { randomUUID } from "node:crypto";
import { EngineConnection, EngineUnavailableError } from "@loopstorm/ipc-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ProxyConfig, UpstreamConfig } from "./config.js";
import { LOOPSTORM_ENGINE_UNAVAILABLE, buildErrorData } from "./errors.js";
import {
  type McpToolCallParams,
  type RunContext,
  decisionResponseToMcpError,
  mcpToolCallToDecisionRequest,
} from "./mapping.js";

interface UpstreamClient {
  config: UpstreamConfig;
  client: Client;
  transport: StdioClientTransport;
  tools: Map<string, { name: string; description?: string | undefined; inputSchema: unknown }>;
}

export class LoopStormProxy {
  private readonly config: ProxyConfig;
  private readonly server: Server;
  private readonly engine: EngineConnection;
  private readonly upstreams: UpstreamClient[] = [];

  private runId: string;
  private runIdLocked = false;
  private seq = 0;

  constructor(config: ProxyConfig) {
    this.config = config;
    this.runId = randomUUID();
    this.engine = new EngineConnection(config.engine_socket, 10_000);

    this.server = new Server(
      { name: "loopstorm-mcp-proxy", version: "0.1.0" },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // tools/list — merge upstream tool lists
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const allTools: { name: string; description?: string | undefined; inputSchema: unknown }[] =
        [];
      for (const upstream of this.upstreams) {
        for (const [displayName, tool] of upstream.tools) {
          allTools.push({
            name: displayName,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }
      }
      return { tools: allTools };
    });

    // tools/call — intercept, consult engine, forward or deny
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const params = request.params as McpToolCallParams;

      // Handle run_id override from _meta on first call
      if (!this.runIdLocked && params._meta?.loopstorm_run_id) {
        const override = params._meta.loopstorm_run_id as string;
        if (typeof override === "string" && override.length > 0) {
          this.runId = override;
        }
        this.runIdLocked = true;
      }
      if (!this.runIdLocked) {
        this.runIdLocked = true;
      }

      this.seq += 1;
      const ctx: RunContext = {
        runId: this.runId,
        seq: this.seq,
        agentName: this.config.agent_name,
        agentRole: this.config.agent_role,
        environment: this.config.environment,
      };

      const decisionReq = mcpToolCallToDecisionRequest(params, ctx);

      // Consult engine
      let response: Awaited<ReturnType<EngineConnection["request"]>>;
      try {
        response = await this.engine.request(decisionReq);
      } catch (err) {
        if (err instanceof EngineUnavailableError) {
          // Fail-closed: engine unavailable
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  code: LOOPSTORM_ENGINE_UNAVAILABLE,
                  message: "LoopStorm engine unavailable",
                  data: buildErrorData({ reason: err.message }),
                }),
              },
            ],
          };
        }
        throw err;
      }

      // Check decision
      const mcpError = decisionResponseToMcpError(response);
      if (mcpError !== null) {
        // For cooldown, pause first
        if (response.decision === "cooldown" && response.cooldownMs) {
          await new Promise<void>((r) => setTimeout(r, response.cooldownMs));
        }
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                code: mcpError.code,
                message: mcpError.message,
                data: mcpError.data,
              }),
            },
          ],
        };
      }

      // Decision is allow — forward to upstream
      const toolName = params.name;
      const upstream = this.findUpstreamForTool(toolName);
      if (!upstream) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `No upstream server found for tool: ${toolName}`,
            },
          ],
        };
      }

      // Resolve the original tool name (strip prefix if applied)
      const originalToolName = upstream.config.prefix
        ? toolName.slice(upstream.config.id.length + 1)
        : toolName;

      const result = await upstream.client.callTool({
        name: originalToolName,
        arguments: params.arguments,
      });

      return result;
    });
  }

  private findUpstreamForTool(toolName: string): UpstreamClient | undefined {
    for (const upstream of this.upstreams) {
      if (upstream.tools.has(toolName)) {
        return upstream;
      }
    }
    return undefined;
  }

  /** Connect to all upstream MCP servers and build tool catalog. */
  async connectUpstreams(): Promise<void> {
    for (const upConfig of this.config.upstreams) {
      if (upConfig.transport.type !== "stdio") {
        // Only stdio supported in v1.1
        console.error(`Skipping upstream "${upConfig.id}": only stdio transport supported in v1.1`);
        continue;
      }

      const transport = new StdioClientTransport({
        command: upConfig.transport.command ?? "",
        args: upConfig.transport.args ?? [],
      });

      const client = new Client(
        { name: `loopstorm-proxy-to-${upConfig.id}`, version: "0.1.0" },
        { capabilities: {} }
      );

      await client.connect(transport);

      // Fetch tool list
      const toolsResult = await client.listTools();
      const tools = new Map<
        string,
        { name: string; description?: string | undefined; inputSchema: unknown }
      >();

      for (const tool of toolsResult.tools) {
        const displayName = upConfig.prefix ? `${upConfig.id}.${tool.name}` : tool.name;
        tools.set(displayName, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }

      this.upstreams.push({ config: upConfig, client, transport, tools });
    }
  }

  /** Get the MCP server instance (for transport binding). */
  getServer(): Server {
    return this.server;
  }

  /** Shut down all connections. */
  async shutdown(): Promise<void> {
    for (const upstream of this.upstreams) {
      try {
        await upstream.client.close();
      } catch {
        // ignore
      }
    }
    this.engine.close();
    await this.server.close();
  }
}
