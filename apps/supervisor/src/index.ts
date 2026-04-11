// SPDX-License-Identifier: MIT
/**
 * AI Supervisor HTTP server entry point.
 *
 * Exposes:
 *   POST /api/trigger  — receive trigger messages from the backend
 *   GET  /api/health   — liveness check
 *
 * The server runs as a long-lived Bun process. It receives triggers from
 * the backend's TriggerDispatch worker and creates SupervisorSessions.
 *
 * Concurrency: max 5 concurrent sessions, queue up to 50 pending.
 * Graceful shutdown on SIGTERM/SIGINT.
 *
 * Spec reference: specs/task-briefs/v1.1-ai-supervisor.md, Task SUP-B10.
 */

import { parseConfig } from "./config.js";
import { createBackendClient } from "./lib/backend-client.js";
import { DeepSeekProvider } from "./llm/deepseek.js";
import { MockLLMProvider } from "./llm/mock.js";
import type { LLMProvider } from "./llm/provider.js";
import { SupervisorSession } from "./session.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const config = parseConfig();

// ---------------------------------------------------------------------------
// LLM Provider
// ---------------------------------------------------------------------------

let llmProvider: LLMProvider;
if (config.mockMode) {
  console.warn("[supervisor] Running in MOCK mode — no real LLM calls");
  llmProvider = new MockLLMProvider([]);
} else {
  llmProvider = new DeepSeekProvider(config.llmApiKey as string);
}

// ---------------------------------------------------------------------------
// Concurrency control
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 5;
const MAX_QUEUE = 50;

let activeSessions = 0;

interface QueuedTrigger {
  trigger: string;
  trigger_run_id: string;
  tenant_id: string;
  priority: number;
}

const pendingQueue: QueuedTrigger[] = [];

async function processTrigger(msg: QueuedTrigger): Promise<void> {
  activeSessions++;
  try {
    const client = createBackendClient(config.backendUrl, config.apiKey);
    const session = new SupervisorSession({
      trigger: msg.trigger,
      triggerRunId: msg.trigger_run_id,
      tenantId: msg.tenant_id,
      config,
      llmProvider,
      backendClient: client,
    });

    const result = await session.execute();
    console.warn(
      `[supervisor] Session ${result.supervisorRunId} completed: ` +
        `trigger=${result.trigger}, tools=${result.toolCallCount}, ` +
        `cost=$${result.estimatedCostUsd.toFixed(4)}, reason=${result.terminationReason}`
    );
  } catch (err) {
    console.error("[supervisor] Session error:", err instanceof Error ? err.message : String(err));
  } finally {
    activeSessions--;
    drainQueue();
  }
}

function drainQueue(): void {
  while (activeSessions < MAX_CONCURRENT && pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    if (next) {
      void processTrigger(next);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);

    // --- Health check ---
    if (url.pathname === "/api/health" && req.method === "GET") {
      return Response.json({
        status: "ok",
        active_sessions: activeSessions,
        queued: pendingQueue.length,
      });
    }

    // --- Trigger endpoint ---
    if (url.pathname === "/api/trigger" && req.method === "POST") {
      // Auth check
      if (config.internalKey) {
        const authHeader = req.headers.get("authorization");
        if (authHeader !== `Bearer ${config.internalKey}`) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
      }

      let body: QueuedTrigger;
      try {
        body = (await req.json()) as QueuedTrigger;
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }

      if (!body.trigger || !body.trigger_run_id || !body.tenant_id) {
        return Response.json(
          { error: "Missing required fields: trigger, trigger_run_id, tenant_id" },
          { status: 400 }
        );
      }

      // Check queue capacity
      if (activeSessions >= MAX_CONCURRENT && pendingQueue.length >= MAX_QUEUE) {
        return Response.json({ error: "Queue full", queued: pendingQueue.length }, { status: 503 });
      }

      // Start or queue the session
      if (activeSessions < MAX_CONCURRENT) {
        void processTrigger(body);
      } else {
        pendingQueue.push(body);
      }

      return Response.json({
        accepted: true,
        active_sessions: activeSessions,
        queued: pendingQueue.length,
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.warn(`[supervisor] Listening on port ${server.port}`);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown() {
  console.warn("[supervisor] Shutting down...");
  server.stop();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
