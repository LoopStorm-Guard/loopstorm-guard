// SPDX-License-Identifier: MIT
/**
 * IPC connection management for the LoopStorm engine.
 *
 * Uses Node.js net.Socket for Unix Domain Socket (Linux/macOS) and
 * named pipe (Windows) connections. Both are accessed via the same
 * net.Socket API with a `path` option.
 */

import { Socket } from "node:net";
import { ConnectionClosedError, EngineUnavailableError, MessageTooLargeError } from "./errors.js";
import { type DecisionRequest, DecisionResponse } from "./protocol.js";

const MAX_MESSAGE_SIZE = 65_536; // 64 KiB

/**
 * Resolve the engine socket path from arg, env, or platform default.
 */
export function resolveSocketPath(socketPath?: string | undefined): string {
  if (socketPath) return socketPath;
  const envPath = process.env.LOOPSTORM_SOCKET;
  if (envPath) return envPath;
  if (process.platform === "win32") return "\\\\.\\pipe\\loopstorm-engine";
  return "/tmp/loopstorm-engine.sock";
}

/**
 * Manages an IPC connection to the loopstorm-engine process.
 */
export class EngineConnection {
  private readonly socketPath: string;
  private readonly timeoutMs: number;
  private socket: Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(socketPath: string, timeoutMs: number) {
    this.socketPath = socketPath;
    this.timeoutMs = timeoutMs;
  }

  /** Establish the IPC connection. */
  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sock = new Socket();
      sock.setTimeout(this.timeoutMs);

      const onError = (err: Error) => {
        sock.removeListener("error", onError);
        sock.destroy();
        reject(new EngineUnavailableError(err.message));
      };

      sock.on("error", onError);
      sock.connect({ path: this.socketPath }, () => {
        sock.removeListener("error", onError);
        this.socket = sock;
        this.buffer = Buffer.alloc(0);
        resolve();
      });
    });
  }

  /** Lazy connect: establish connection if not already connected. */
  private async ensureConnected(): Promise<void> {
    if (this.socket === null) {
      await this.connect();
    }
  }

  /** Serialize request as NDJSON and send over IPC. */
  async sendRequest(request: DecisionRequest): Promise<void> {
    await this.ensureConnected();
    const line = request.toNdjson();
    if (line.length > MAX_MESSAGE_SIZE) {
      throw new MessageTooLargeError(line.length);
    }
    return new Promise<void>((resolve, reject) => {
      this.socket?.write(line, (err?: Error | null) => {
        if (err) reject(new EngineUnavailableError(err.message));
        else resolve();
      });
    });
  }

  /** Read one NDJSON line from the socket and deserialize. */
  recvResponse(): Promise<DecisionResponse> {
    return new Promise<DecisionResponse>((resolve, reject) => {
      const sock = this.socket;
      if (!sock) {
        reject(new EngineUnavailableError("not connected"));
        return;
      }

      // Check if we already have a complete line buffered
      const existingIdx = this.buffer.indexOf(0x0a);
      if (existingIdx >= 0) {
        const line = this.buffer.subarray(0, existingIdx).toString("utf-8");
        this.buffer = this.buffer.subarray(existingIdx + 1);
        resolve(DecisionResponse.fromJson(line));
        return;
      }

      const cleanup = () => {
        sock.removeListener("data", onData);
        sock.removeListener("error", onError);
        sock.removeListener("close", onClose);
        sock.removeListener("timeout", onTimeout);
      };

      const onData = (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.buffer.length > MAX_MESSAGE_SIZE) {
          cleanup();
          reject(new MessageTooLargeError(this.buffer.length));
          return;
        }
        const idx = this.buffer.indexOf(0x0a);
        if (idx >= 0) {
          const line = this.buffer.subarray(0, idx).toString("utf-8");
          this.buffer = this.buffer.subarray(idx + 1);
          cleanup();
          resolve(DecisionResponse.fromJson(line));
        }
      };

      const onError = (err: Error) => {
        cleanup();
        reject(new EngineUnavailableError(err.message));
      };

      const onClose = () => {
        cleanup();
        reject(new ConnectionClosedError());
      };

      const onTimeout = () => {
        cleanup();
        reject(new EngineUnavailableError("socket timeout"));
      };

      sock.on("data", onData);
      sock.on("error", onError);
      sock.on("close", onClose);
      sock.on("timeout", onTimeout);
    });
  }

  /** Send a request and return the response. */
  async request(req: DecisionRequest): Promise<DecisionResponse> {
    await this.sendRequest(req);
    return this.recvResponse();
  }

  /** Close and reestablish the connection. */
  async reconnect(): Promise<void> {
    this.close();
    await this.connect();
  }

  /** Close the IPC connection. */
  close(): void {
    if (this.socket !== null) {
      try {
        this.socket.destroy();
      } catch {
        // ignore
      }
      this.socket = null;
      this.buffer = Buffer.alloc(0);
    }
  }

  /** True if a socket connection exists. */
  get connected(): boolean {
    return this.socket !== null;
  }
}
