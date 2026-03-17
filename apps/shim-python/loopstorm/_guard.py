# SPDX-License-Identifier: MIT
"""Guard class — the primary entry point for wrapping agent tool calls."""

from __future__ import annotations

import datetime
import functools
import inspect
import logging
import time
import uuid
from collections.abc import Callable
from typing import Any, TypeVar

from loopstorm._args_hash import args_hash
from loopstorm._connection import EngineConnection, resolve_socket_path
from loopstorm._errors import (
    ApprovalRequiredError,
    CooldownError,
    EngineUnavailableError,
    PolicyDeniedError,
    RunTerminatedError,
)
from loopstorm._openai import OpenAIGuardedClient
from loopstorm._protocol import DecisionRequest, DecisionResponse
from loopstorm._types import BudgetRemaining, DecisionResult

logger = logging.getLogger("loopstorm")

F = TypeVar("F", bound=Callable[..., Any])


class Guard:
    """Wraps agent tool calls with LoopStorm enforcement.

    The Guard communicates with the loopstorm-engine binary over a Unix
    Domain Socket. The engine must be running before any wrapped calls
    are made (or ``fail_open=True`` must be set to allow unguarded execution).

    Not thread-safe in v1 — external synchronization required.
    """

    def __init__(
        self,
        *,
        socket_path: str | None = None,
        fail_open: bool = True,
        run_id: str | None = None,
        agent_role: str | None = None,
        agent_name: str | None = None,
        environment: str | None = None,
        model: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._socket_path = resolve_socket_path(socket_path)
        self._fail_open = fail_open
        self._run_id = run_id or str(uuid.uuid4())
        self._agent_role = agent_role
        self._agent_name = agent_name
        self._environment = environment
        self._model = model
        self._timeout = timeout
        self._seq = 0
        self._conn = EngineConnection(self._socket_path, self._timeout)

    @property
    def run_id(self) -> str:
        """The run_id for this Guard instance (fixed for its lifetime)."""
        return self._run_id

    def wrap(self, tool_name: str) -> Callable[[F], F]:
        """Decorator: wraps a tool call function with enforcement.

        Usage::

            @guard.wrap("file_read")
            def read_file(path: str) -> str:
                return open(path).read()
        """

        def decorator(fn: F) -> F:
            @functools.wraps(fn)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                # Build args dict from positional + keyword args
                call_args = _build_args_dict(fn, args, kwargs)
                # This raises on deny/kill/cooldown
                self.check(tool_name, args=call_args)
                return fn(*args, **kwargs)

            return wrapper  # type: ignore[return-value]

        return decorator

    def check(
        self,
        tool_name: str,
        *,
        args: dict[str, Any] | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        estimated_cost_usd: float | None = None,
    ) -> DecisionResult:
        """Send a decision request to the engine and enforce the result.

        Returns a ``DecisionResult`` on allow. Raises on deny, cooldown,
        kill, or require_approval.
        """
        self._seq += 1
        seq = self._seq

        hash_val = args_hash(args)
        ts = datetime.datetime.now(datetime.timezone.utc).isoformat()

        request = DecisionRequest(
            schema_version=1,
            run_id=self._run_id,
            seq=seq,
            tool=tool_name,
            args_hash=hash_val,
            ts=ts,
            args_redacted=args,
            agent_role=self._agent_role,
            agent_name=self._agent_name,
            model=self._model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_usd=estimated_cost_usd,
            environment=self._environment,
        )

        response = self._send(request)
        if response is None:
            # Engine unavailable, fail_open allowed the call
            return DecisionResult(decision="allow")

        # Verify seq and run_id echo
        if response.seq != seq or response.run_id != self._run_id:
            logger.error(
                "protocol error: seq/run_id mismatch "
                "(expected seq=%d run_id=%s, got seq=%d run_id=%s)",
                seq,
                self._run_id,
                response.seq,
                response.run_id,
            )
            raise RunTerminatedError(
                reason="protocol error: seq/run_id mismatch in engine response"
            )

        return self._handle_decision(response)

    def openai(self, client: Any) -> OpenAIGuardedClient:
        """Wrap an OpenAI client to gate tool calls.

        Returns a proxy that intercepts ``chat.completions.create()``
        responses and checks each tool call through this Guard.
        Synchronous only in v1.
        """
        return OpenAIGuardedClient(client, self)

    def close(self) -> None:
        """Close the UDS connection."""
        self._conn.close()

    def __enter__(self) -> Guard:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def _send(self, request: DecisionRequest) -> DecisionResponse | None:
        """Send request to engine. Returns None if fail_open and engine unavailable."""
        try:
            return self._conn.request(request)
        except Exception as exc:
            # First failure: try one reconnect
            logger.debug("connection error, attempting reconnect: %s", exc)
            try:
                self._conn.reconnect()
                return self._conn.request(request)
            except Exception as retry_exc:
                if self._fail_open:
                    logger.warning(
                        "engine unavailable (fail_open=True, allowing call): %s",
                        retry_exc,
                    )
                    return None
                raise EngineUnavailableError(str(retry_exc)) from retry_exc

    def _handle_decision(self, response: DecisionResponse) -> DecisionResult:
        """Enforce the engine's decision."""
        budget = None
        if response.budget_remaining:
            budget = BudgetRemaining(
                cost_usd=response.budget_remaining.get("cost_usd"),
                input_tokens=response.budget_remaining.get("input_tokens"),
                output_tokens=response.budget_remaining.get("output_tokens"),
                call_count=response.budget_remaining.get("call_count"),
            )

        result = DecisionResult(
            decision=response.decision,
            rule_id=response.rule_id,
            reason=response.reason,
            cooldown_ms=response.cooldown_ms,
            cooldown_message=response.cooldown_message,
            budget_remaining=budget,
        )

        if response.decision == "allow":
            return result

        if response.decision == "deny":
            raise PolicyDeniedError(response.rule_id, response.reason)

        if response.decision == "cooldown":
            ms = response.cooldown_ms or 0
            if ms > 0:
                time.sleep(ms / 1000.0)
            raise CooldownError(ms, response.cooldown_message)

        if response.decision == "kill":
            raise RunTerminatedError(response.rule_id, response.reason)

        if response.decision == "require_approval":
            raise ApprovalRequiredError(
                approval_id=response.approval_id or "",
                timeout_ms=response.approval_timeout_ms or 0,
                timeout_action=response.approval_timeout_action or "deny",
            )

        # Unknown decision — fail closed
        raise RunTerminatedError(reason=f"unknown decision: {response.decision}")


def _build_args_dict(
    fn: Callable[..., Any],
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> dict[str, Any]:
    """Convert positional + keyword arguments into a dict using the function's signature."""
    try:
        sig = inspect.signature(fn)
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()
        return dict(bound.arguments)
    except (ValueError, TypeError):
        # Fallback: return kwargs if signature binding fails
        return kwargs
