// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Background dispatch worker for the AI Supervisor trigger queue.
 *
 * Reads TriggerMessages from the TriggerQueue singleton and sends HTTP POST
 * requests to the supervisor process. The supervisor is advisory — its
 * unavailability does not affect enforcement.
 *
 * Dispatch loop:
 *   - Polls the queue every 500 ms.
 *   - Sends HTTP POST to the supervisor's /api/trigger endpoint.
 *   - If the supervisor is unavailable, the trigger is dropped with a warning log.
 *   - Never blocks or throws — errors are logged and the loop continues.
 *
 * Startup: called from the backend's main src/index.ts after the HTTP server starts.
 * Shutdown: returns a stop() function that clears the interval.
 */

import type { TriggerMessage } from "./trigger-queue.js";
import { triggerQueue } from "./trigger-queue.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Polling interval for the dispatch loop (ms). */
const POLL_INTERVAL_MS = 500;

/** HTTP request timeout for the supervisor endpoint (ms). */
const DISPATCH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Dispatch worker
// ---------------------------------------------------------------------------

/**
 * Start the trigger dispatch background worker.
 *
 * The worker polls the TriggerQueue and dispatches HTTP POST requests to the
 * supervisor process. If the supervisor is not configured (no URL/key), the
 * worker starts but does nothing (triggers are silently consumed from the
 * queue to prevent unbounded growth).
 *
 * @returns A `stop()` function to shut down the worker cleanly.
 */
export function startTriggerDispatch(): { stop: () => void } {
  const supervisorUrl = process.env.LOOPSTORM_SUPERVISOR_URL ?? null;
  const supervisorKey = process.env.LOOPSTORM_SUPERVISOR_INTERNAL_KEY ?? null;

  if (!supervisorUrl) {
    console.warn(
      "[trigger-dispatch] LOOPSTORM_SUPERVISOR_URL not set — trigger dispatch is disabled. " +
        "Triggers will be evaluated but not dispatched."
    );
  }

  const intervalId = setInterval(() => {
    void drainQueue(supervisorUrl, supervisorKey);
  }, POLL_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(intervalId);
    },
  };
}

/**
 * Drain all currently-queued triggers in a single pass.
 * Called on each poll interval.
 */
async function drainQueue(
  supervisorUrl: string | null,
  supervisorKey: string | null
): Promise<void> {
  let message = triggerQueue.dequeue();
  while (message) {
    if (supervisorUrl) {
      await dispatchTrigger(supervisorUrl, supervisorKey, message);
    }
    // If no supervisor URL, we just consume and discard.
    message = triggerQueue.dequeue();
  }
}

/**
 * Send a single trigger to the supervisor process via HTTP POST.
 *
 * Fire-and-forget: errors are logged, never thrown.
 */
async function dispatchTrigger(
  supervisorUrl: string,
  supervisorKey: string | null,
  message: TriggerMessage
): Promise<void> {
  const url = `${supervisorUrl}/api/trigger`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (supervisorKey) {
    headers.Authorization = `Bearer ${supervisorKey}`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        trigger: message.trigger,
        trigger_run_id: message.trigger_run_id,
        tenant_id: message.tenant_id,
        priority: message.priority,
        backend_url: process.env.LOOPSTORM_BACKEND_URL ?? "http://localhost:3001",
        api_key: process.env.LOOPSTORM_API_KEY ?? "",
      }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(
        `[trigger-dispatch] Supervisor returned ${response.status} for trigger=${message.trigger} ` +
          `run=${message.trigger_run_id}. Trigger dropped.`
      );
    }
  } catch (err) {
    // Supervisor unavailable — expected when supervisor is not deployed.
    // Log at warn level (not error) to avoid alert fatigue.
    console.warn(
      `[trigger-dispatch] Failed to dispatch trigger=${message.trigger} ` +
        `run=${message.trigger_run_id}: ${err instanceof Error ? err.message : String(err)}. Trigger dropped.`
    );
  }
}
