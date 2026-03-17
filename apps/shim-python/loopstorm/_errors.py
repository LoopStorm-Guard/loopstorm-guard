# SPDX-License-Identifier: MIT
"""Exception hierarchy for the LoopStorm Guard Python shim."""

from __future__ import annotations


class LoopStormError(Exception):
    """Base exception for all LoopStorm shim errors."""


class EngineUnavailableError(LoopStormError):
    """Engine is not running or connection failed (fail_open=False)."""


class PolicyDeniedError(LoopStormError):
    """Tool call was denied by policy."""

    def __init__(self, rule_id: str | None = None, reason: str | None = None) -> None:
        self.rule_id = rule_id
        self.reason = reason
        parts = ["policy denied"]
        if rule_id:
            parts.append(f"rule={rule_id}")
        if reason:
            parts.append(reason)
        super().__init__(": ".join(parts))


class CooldownError(LoopStormError):
    """Loop detected; agent should retry after cooldown_ms."""

    def __init__(self, cooldown_ms: int, message: str | None = None) -> None:
        self.cooldown_ms = cooldown_ms
        self.message = message
        msg = f"cooldown {cooldown_ms}ms"
        if message:
            msg += f": {message}"
        super().__init__(msg)


class RunTerminatedError(LoopStormError):
    """Run was killed (budget exceeded, policy kill, audit failure)."""

    def __init__(self, rule_id: str | None = None, reason: str | None = None) -> None:
        self.rule_id = rule_id
        self.reason = reason
        parts = ["run terminated"]
        if rule_id:
            parts.append(f"rule={rule_id}")
        if reason:
            parts.append(reason)
        super().__init__(": ".join(parts))


class ApprovalRequiredError(LoopStormError):
    """Human approval is required before this call can proceed (v1.1)."""

    def __init__(
        self, approval_id: str, timeout_ms: int, timeout_action: str
    ) -> None:
        self.approval_id = approval_id
        self.timeout_ms = timeout_ms
        self.timeout_action = timeout_action
        super().__init__(
            f"approval required: id={approval_id}, "
            f"timeout={timeout_ms}ms, action={timeout_action}"
        )


class ConnectionClosedError(LoopStormError):
    """Engine closed the connection unexpectedly."""


class MessageTooLargeError(LoopStormError):
    """Message exceeds 64 KiB limit."""

    def __init__(self, size: int) -> None:
        self.size = size
        super().__init__(f"message size {size} exceeds 65536 byte limit")
