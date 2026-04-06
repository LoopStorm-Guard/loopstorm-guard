// SPDX-License-Identifier: MIT

import { createReadStream, unwatchFile, watchFile } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import type { ParsedEvent, RequiredField } from "./types.js";
import { REQUIRED_EVENT_FIELDS } from "./types.js";

export type EventHandler = (event: ParsedEvent) => void;

export interface JsonlReaderOptions {
  pollIntervalMs?: number;
}

interface ReaderState {
  cursor: number;
  lineNumber: number;
  partial: string;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;

/**
 * Tail-follow JSONL file reader with cursor persistence.
 *
 * Architecture:
 * - Initial read: reads all existing lines from cursor position.
 * - Tail-follow: polls via fs.watchFile every pollIntervalMs.
 * - Cursor: persisted to {inputPath}.otel-cursor for crash recovery.
 * - File rotation: if size < cursor, reset to 0 and re-process.
 * - Malformed lines: logged and skipped.
 *
 * Spec: Gate OTEL-G4, Task OTEL-8
 */
export class JsonlReader {
  private inputPath: string;
  private cursorPath: string;
  private onEvent: EventHandler;
  private pollIntervalMs: number;
  private stopped = false;
  private state: ReaderState = { cursor: 0, lineNumber: 0, partial: "" };

  constructor(inputPath: string, onEvent: EventHandler, options?: JsonlReaderOptions) {
    this.inputPath = inputPath;
    this.cursorPath = `${inputPath}.otel-cursor`;
    this.onEvent = onEvent;
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Start reading (initial + tail-follow).
   * Returns a promise that resolves when stop() is called.
   */
  async start(): Promise<void> {
    await this.loadCursor();
    await this.readNewBytes();

    return new Promise<void>((resolve) => {
      watchFile(
        this.inputPath,
        { interval: this.pollIntervalMs, persistent: false },
        (_curr, _prev) => {
          if (this.stopped) {
            unwatchFile(this.inputPath);
            resolve();
            return;
          }
          this.readNewBytes().catch((err: unknown) => {
            console.warn(`[loopstorm-otel] poll error on ${this.inputPath}:`, err);
          });
        }
      );
    });
  }

  /**
   * Process the file once (--once mode) and return.
   */
  async processOnce(): Promise<void> {
    await this.loadCursor();
    await this.readNewBytes();
    await this.saveCursor();
  }

  /**
   * Stop the reader.
   */
  stop(): void {
    this.stopped = true;
    unwatchFile(this.inputPath);
  }

  private async loadCursor(): Promise<void> {
    try {
      const raw = await readFile(this.cursorPath, "utf8");
      const value = Number.parseInt(raw.trim(), 10);
      if (!Number.isNaN(value) && value >= 0) {
        // Verify file is at least this large (handles rotation)
        try {
          const fileStat = await stat(this.inputPath);
          if (fileStat.size >= value) {
            this.state.cursor = value;
            return;
          }
          // File smaller than cursor — rotation detected
          console.info(
            `[loopstorm-otel] cursor (${value}) > file size (${fileStat.size}), resetting to 0`
          );
          this.state.cursor = 0;
          await this.saveCursor();
        } catch {
          // File doesn't exist yet — start from 0
          this.state.cursor = 0;
        }
      } else {
        console.warn(`[loopstorm-otel] corrupted cursor file ${this.cursorPath}, starting from 0`);
        this.state.cursor = 0;
        await this.saveCursor();
      }
    } catch {
      // No cursor file — start from 0
      this.state.cursor = 0;
    }
  }

  private async saveCursor(): Promise<void> {
    try {
      await writeFile(this.cursorPath, String(this.state.cursor), "utf8");
    } catch (err) {
      console.warn("[loopstorm-otel] failed to save cursor:", err);
    }
  }

  private async readNewBytes(): Promise<void> {
    let fileStat: { size: number };
    try {
      fileStat = await stat(this.inputPath);
    } catch {
      // File does not exist yet — wait for next poll
      console.warn(`[loopstorm-otel] file not found: ${this.inputPath}, will retry`);
      return;
    }

    // File rotation detection: size < cursor
    if (fileStat.size < this.state.cursor) {
      console.info(
        `[loopstorm-otel] file rotation detected (size=${fileStat.size} < cursor=${this.state.cursor}), resetting`
      );
      this.state.cursor = 0;
      this.state.partial = "";
      await this.saveCursor();
    }

    if (fileStat.size <= this.state.cursor) {
      // No new bytes
      return;
    }

    // Read new bytes from cursor
    const chunk = await this.readChunk(this.state.cursor, fileStat.size);
    this.state.cursor = fileStat.size;

    // Process lines
    const raw = this.state.partial + chunk;
    const lines = raw.split("\n");

    // Last element may be partial (file written mid-line)
    this.state.partial = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed.length === 0) continue;
      this.state.lineNumber++;
      this.parseLine(trimmed, this.state.lineNumber);
    }

    await this.saveCursor();
  }

  private async readChunk(start: number, end: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(this.inputPath, {
        start,
        end: end - 1,
        encoding: undefined,
      });
      stream.on("data", (chunk: Buffer | string) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else {
          chunks.push(Buffer.from(chunk, "utf8"));
        }
      });
      stream.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      stream.on("error", reject);
    });
  }

  private parseLine(line: string, lineNumber: number): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.warn(
        `[loopstorm-otel] malformed JSON at line ${lineNumber} (offset ~${this.state.cursor}), skipping`
      );
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      console.warn(
        `[loopstorm-otel] expected JSON object at line ${lineNumber}, got ${typeof parsed}, skipping`
      );
      return;
    }

    // Validate required fields
    const obj = parsed as Record<string, unknown>;
    for (const field of REQUIRED_EVENT_FIELDS as ReadonlyArray<RequiredField>) {
      if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
        console.warn(
          `[loopstorm-otel] missing required field '${field}' at line ${lineNumber}, skipping`
        );
        return;
      }
    }

    this.onEvent(obj as unknown as ParsedEvent);
  }
}

/**
 * Utility: read a JSONL file line-by-line using readline (for processOnce mode
 * without cursor). Used in tests.
 */
export async function readJsonlFile(filePath: string, onEvent: EventHandler): Promise<void> {
  const reader = new JsonlReader(filePath, onEvent, {
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  });
  await reader.processOnce();
}
