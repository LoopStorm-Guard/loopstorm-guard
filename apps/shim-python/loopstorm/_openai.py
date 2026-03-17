# SPDX-License-Identifier: MIT
"""OpenAI client adapter — gates tool calls without importing openai."""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from loopstorm._guard import Guard

logger = logging.getLogger("loopstorm")


class OpenAIGuardedCompletions:
    """Proxy for client.chat.completions that gates tool calls."""

    def __init__(self, completions: Any, guard: Guard) -> None:
        self._completions = completions
        self._guard = guard

    def create(self, **kwargs: Any) -> Any:
        """Call the underlying create() and gate any tool calls in the response."""
        response = self._completions.create(**kwargs)
        self._check_tool_calls(response)
        return response

    def _check_tool_calls(self, response: Any) -> None:
        """Iterate over tool calls in all choices and check each one."""
        for choice in response.choices:
            msg = getattr(choice, "message", None)
            if msg is None:
                continue
            tool_calls = getattr(msg, "tool_calls", None)
            if tool_calls is None:
                continue
            for tc in tool_calls:
                args = json.loads(tc.function.arguments)
                self._guard.check(tc.function.name, args=args)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._completions, name)


class OpenAIGuardedChat:
    """Proxy for client.chat that provides guarded completions."""

    def __init__(self, chat: Any, guard: Guard) -> None:
        self._chat = chat
        self._guard = guard

    @property
    def completions(self) -> OpenAIGuardedCompletions:
        return OpenAIGuardedCompletions(self._chat.completions, self._guard)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._chat, name)


class OpenAIGuardedClient:
    """Proxy wrapping an OpenAI client to gate tool calls via LoopStorm Guard.

    Usage::

        guarded = guard.openai(client)
        response = guarded.chat.completions.create(model="gpt-4o", ...)

    Only ``chat.completions.create()`` is intercepted.
    All other attributes/methods pass through to the underlying client.
    Synchronous only in v1 — async and streaming are out of scope.
    """

    def __init__(self, client: Any, guard: Guard) -> None:
        self._client = client
        self._guard = guard

    @property
    def chat(self) -> OpenAIGuardedChat:
        return OpenAIGuardedChat(self._client.chat, self._guard)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)
