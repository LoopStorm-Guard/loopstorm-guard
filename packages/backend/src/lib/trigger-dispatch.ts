// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Trigger dispatch for the AI Supervisor.
 *
 * Two dispatch modes (ADR-015):
 *
 * 1. **Vercel Functions (production, ADR-015 AC-15-6):** `dispatchTriggerDirect()`
 *    is called synchronously from `events.ingest` after the transaction commits.
 *    No in-process queue. The HTTP POST fires with a 3-second timeout. Errors
 *    are logged and swallowed — a failed dispatch does NOT fail the ingest
 *    request. Same loss tolerance as ADR-014 Gate 3: "if the backend restarts,
 *    pending triggers are lost, but the same conditions will re-trigger on the
 *    next relevant event."
 *
 * 2. **Bun long-lived process (local dev, Mode 1):** `startTriggerDispatch()`
 *    polls the TriggerQueue every 500 ms and drains it via
 *    `dispatchTriggerDirect()`. Called from `src/index.ts` after the HTTP
 *    server starts. Shutdown: call `stop()`.
 *
 * Enforcement/observation plane separation (ADR-012): this module is on the
 * OBSERVATION PLANE. It reports to the supervisor. It never intercepts or
 * modifies enforcement decisions.
 */

import type { TriggerMessage } from "./trigger-queue.js";
import { triggerQueue } from "./trigger-queue.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Polling interval for the dispatch loop (ms). Used in Bun mode only. */
const POLL_INTERVAL_MS = 500;

/** HTTP request timeout for the supervisor endpoint (ms). */
const DISPATCH_TIMEOUT_MS = 3_000;

// ---------------------------------------------------------------------------
// Public: single-trigger direct dispatch (used by events.ingest, ADR-015)
// ---------------------------------------------------------------------------

/**
 * Dispatch a single trigger to the supervisor via HTTP POST.
 *
 * Fire-and-forget: errors are logged at warn level and never thrown.
 * Uses a 3-second AbortSignal timeout to prevent slow supervisors from
 * blocking the ingest request path.
 *
 * Callers should use `void dispatchTriggerDirect(...)` — do not await.
 */
export async function dispatchTriggerDirect(message: TriggerMessage): Promise<void> {
  const supervisorUrl = process.env.LOOPSTORM_SUPERVISOR_URL ?? null;
  const supervisorKey = process.env.LOOPSTORM_SUPERVISOR_INTERNAL_KEY ?? null;

  if (!supervisorUrl) {
    // Supervisor not configured — expected in local dev / Mode 0.
    // Trigger is silently dropped (no-op).
    return;
  }

  await dispatchTrigger(supervisorUrl, supervisorKey, message);
}

// ---------------------------------------------------------------------------
// Public: background dispatch worker (used by src/index.ts in Bun mode)
// ---------------------------------------------------------------------------

/**
 * Start the trigger dispatch background worker (Bun long-lived process mode only).
 *
 * Polls the TriggerQueue and dispatches HTTP POST requests to the supervisor.
 * If the supervisor is not configured, the worker starts but silently consumes
 * the queue (prevents unbounded growth).
 *
 * NOT used on Vercel — `dispatchTriggerDirect()` handles that context.
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

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Drain all currently-queued triggers in a single pass.
 * Called on each poll interval in Bun process mode.
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
 * Fire-and-forget: errors are logged at warn level, never thrown.
 * Uses DISPATCH_TIMEOUT_MS (3 seconds) to prevent blocking the caller.
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
