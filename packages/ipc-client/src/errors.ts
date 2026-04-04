// SPDX-License-Identifier: MIT
/**
 * Exception hierarchy for the LoopStorm Guard TypeScript shim.
 */

export class LoopStormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopStormError";
  }
}

export class EngineUnavailableError extends LoopStormError {
  constructor(message?: string) {
    super(message ?? "Engine is not running or connection failed");
    this.name = "EngineUnavailableError";
  }
}

export class PolicyDeniedError extends LoopStormError {
  readonly ruleId: string | undefined;
  readonly reason: string | undefined;

  constructor(ruleId?: string, reason?: string) {
    const parts = ["policy denied"];
    if (ruleId) parts.push(`rule=${ruleId}`);
    if (reason) parts.push(reason);
    super(parts.join(": "));
    this.name = "PolicyDeniedError";
    this.ruleId = ruleId;
    this.reason = reason;
  }
}

export class CooldownError extends LoopStormError {
  readonly cooldownMs: number;
  readonly cooldownMessage: string | undefined;

  constructor(cooldownMs: number, message?: string) {
    const msg = `cooldown ${cooldownMs}ms${message ? `: ${message}` : ""}`;
    super(msg);
    this.name = "CooldownError";
    this.cooldownMs = cooldownMs;
    this.cooldownMessage = message;
  }
}

export class RunTerminatedError extends LoopStormError {
  readonly ruleId: string | undefined;
  readonly reason: string | undefined;

  constructor(ruleId?: string, reason?: string) {
    const parts = ["run terminated"];
    if (ruleId) parts.push(`rule=${ruleId}`);
    if (reason) parts.push(reason);
    super(parts.join(": "));
    this.name = "RunTerminatedError";
    this.ruleId = ruleId;
    this.reason = reason;
  }
}

export class ApprovalRequiredError extends LoopStormError {
  readonly approvalId: string;
  readonly timeoutMs: number;
  readonly timeoutAction: string;

  constructor(approvalId: string, timeoutMs: number, timeoutAction: string) {
    super(`approval required: id=${approvalId}, timeout=${timeoutMs}ms, action=${timeoutAction}`);
    this.name = "ApprovalRequiredError";
    this.approvalId = approvalId;
    this.timeoutMs = timeoutMs;
    this.timeoutAction = timeoutAction;
  }
}

export class ConnectionClosedError extends LoopStormError {
  constructor() {
    super("Engine closed the connection unexpectedly");
    this.name = "ConnectionClosedError";
  }
}

export class MessageTooLargeError extends LoopStormError {
  readonly size: number;

  constructor(size: number) {
    super(`message size ${size} exceeds 65536 byte limit`);
    this.name = "MessageTooLargeError";
    this.size = size;
  }
}
