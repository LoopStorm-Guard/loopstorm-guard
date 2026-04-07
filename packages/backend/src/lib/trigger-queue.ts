// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bounded in-process trigger queue for the AI Supervisor dispatch pipeline.
 *
 * The queue decouples trigger evaluation (synchronous, inline in event ingest)
 * from trigger dispatch (asynchronous HTTP POST to the supervisor process).
 *
 * ADR-014 Gate 3: in-process bounded async channel, cap 100.
 *
 * The queue is intentionally simple — a bounded array with FIFO semantics.
 * When the queue is full, new triggers are dropped (logged, not thrown).
 * This prevents a slow/unavailable supervisor from back-pressuring ingest.
 *
 * Deduplication: triggers for the same run_id within a 60-second window
 * are suppressed, keeping only the highest-priority trigger.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriggerMessage {
  trigger: string;
  trigger_run_id: string;
  tenant_id: string;
  priority: number;
  enqueued_at: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Deduplication entry
// ---------------------------------------------------------------------------

interface DedupeEntry {
  priority: number;
  timestamp: number; // Date.now() ms
}

// ---------------------------------------------------------------------------
// TriggerQueue
// ---------------------------------------------------------------------------

/** Default maximum queue capacity. */
const DEFAULT_CAPACITY = 100;

/** Deduplication window in milliseconds (60 seconds). */
const DEDUP_WINDOW_MS = 60_000;

export class TriggerQueue {
  private readonly queue: TriggerMessage[] = [];
  private readonly capacity: number;

  /**
   * Deduplication map: trigger_run_id → last-enqueued entry.
   * Triggers for the same run within DEDUP_WINDOW_MS are suppressed unless
   * the new trigger has a higher priority (lower number).
   */
  private readonly dedup: Map<string, DedupeEntry> = new Map();

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  /**
   * Enqueue a trigger message.
   *
   * @returns `true` if enqueued, `false` if the queue is full or deduplicated.
   */
  enqueue(message: TriggerMessage): boolean {
    const now = Date.now();

    // --- Deduplication ---
    const existing = this.dedup.get(message.trigger_run_id);
    if (existing && now - existing.timestamp < DEDUP_WINDOW_MS) {
      // A trigger for this run was recently enqueued.
      // Only allow if the new trigger has HIGHER priority (lower number).
      if (message.priority >= existing.priority) {
        return false; // suppressed — existing trigger has equal or higher priority
      }
      // Higher-priority trigger replaces the existing dedup entry
      // (but does not remove the existing message from the queue — it will
      // be dispatched as-is; the dedup entry just controls future suppression).
    }

    // --- Capacity check ---
    if (this.queue.length >= this.capacity) {
      return false; // queue full — caller should log a warning
    }

    this.queue.push(message);
    this.dedup.set(message.trigger_run_id, {
      priority: message.priority,
      timestamp: now,
    });

    // Periodic dedup map cleanup (every 50 enqueues)
    if (this.queue.length % 50 === 0) {
      this.cleanupDedup(now);
    }

    return true;
  }

  /**
   * Dequeue the next trigger message (FIFO).
   *
   * @returns The next message, or `null` if the queue is empty.
   */
  dequeue(): TriggerMessage | null {
    return this.queue.shift() ?? null;
  }

  /** Current number of messages in the queue. */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Remove expired dedup entries to prevent unbounded map growth.
   */
  private cleanupDedup(now: number): void {
    for (const [key, entry] of this.dedup) {
      if (now - entry.timestamp >= DEDUP_WINDOW_MS) {
        this.dedup.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Global trigger queue instance. Shared by the ingest handler and dispatch worker. */
export const triggerQueue = new TriggerQueue();
