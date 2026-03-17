# SPDX-License-Identifier: MIT
"""
LoopStorm Guard Python shim.

Wraps agent tool calls and forwards them to the loopstorm-engine binary
over a Unix Domain Socket for enforcement.

Usage::

    from loopstorm import Guard

    guard = Guard()

    @guard.wrap("file_read")
    def read_file(path: str) -> str:
        return open(path).read()

    # Or use check() for imperative control:
    result = guard.check("file_read", args={"path": "/etc/passwd"})

    # Or wrap an OpenAI client:
    guarded = guard.openai(openai_client)
"""

from loopstorm._errors import (
    ApprovalRequiredError,
    ConnectionClosedError,
    CooldownError,
    EngineUnavailableError,
    LoopStormError,
    MessageTooLargeError,
    PolicyDeniedError,
    RunTerminatedError,
)
from loopstorm._guard import Guard
from loopstorm._types import BudgetRemaining, DecisionResult
from loopstorm._version import __version__

__all__ = [
    "Guard",
    "__version__",
    "DecisionResult",
    "BudgetRemaining",
    "LoopStormError",
    "EngineUnavailableError",
    "PolicyDeniedError",
    "CooldownError",
    "RunTerminatedError",
    "ApprovalRequiredError",
    "ConnectionClosedError",
    "MessageTooLargeError",
]
