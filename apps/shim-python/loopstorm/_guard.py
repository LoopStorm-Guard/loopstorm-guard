# SPDX-License-Identifier: MIT
"""Guard class — the primary entry point for wrapping agent tool calls."""

from __future__ import annotations

import functools
from typing import Any, Callable


class Guard:
    """
    Wraps agent tool calls with LoopStorm enforcement.

    The Guard communicates with the loopstorm-engine binary over a Unix
    Domain Socket. The engine must be running before any wrapped calls
    are made. In Mode 0, start the engine via:

        loopstorm run --policy policy.yaml -- <agent-command>

    Args:
        policy: Path to a policy YAML file. Required in Mode 0.
        socket_path: Path to the engine UDS. Defaults to
                     /tmp/loopstorm-engine.sock (or LOOPSTORM_SOCKET env var).
    """

    def __init__(
        self,
        policy: str | None = None,
        socket_path: str | None = None,
    ) -> None:
        self.policy = policy
        self.socket_path = socket_path
        # TODO(shim-python): resolve socket path from env / default
        # TODO(shim-python): establish UDS connection, verify engine is alive

    def wrap(self, fn: Callable[..., Any]) -> Callable[..., Any]:
        """Decorator: wraps a tool call function with enforcement."""

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            # TODO(shim-python): build DecisionRequest, send over UDS
            # TODO(shim-python): block on DecisionResponse
            # TODO(shim-python): if deny/kill, raise EnforcementError
            # TODO(shim-python): if cooldown, sleep then retry
            return fn(*args, **kwargs)

        return wrapper
