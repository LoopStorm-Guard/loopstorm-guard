# SPDX-License-Identifier: MIT
"""Tests for the OpenAI client adapter (duck-typed mocks, no openai SDK)."""

from __future__ import annotations

import json
import sys
from typing import Any
from unittest.mock import MagicMock

import pytest

from loopstorm import Guard, PolicyDeniedError

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="UDS not supported")


def _make_tool_call(name: str, arguments: dict[str, Any]) -> MagicMock:
    """Create a mock OpenAI tool call object."""
    tc = MagicMock()
    tc.function.name = name
    tc.function.arguments = json.dumps(arguments)
    return tc


def _make_response(tool_calls: list[MagicMock] | None = None) -> MagicMock:
    """Create a mock OpenAI ChatCompletion response."""
    response = MagicMock()
    choice = MagicMock()
    choice.message.tool_calls = tool_calls
    response.choices = [choice]
    return response


class TestOpenAIAdapter:
    def test_no_tool_calls_passes_through(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        """O1: Response without tool calls is unmodified."""
        guard = Guard(socket_path=mock_engine.socket_path, timeout=5.0)

        mock_client = MagicMock()
        response = _make_response(tool_calls=None)
        mock_client.chat.completions.create.return_value = response

        guarded = guard.openai(mock_client)
        result = guarded.chat.completions.create(model="gpt-4o", messages=[])
        assert result is response
        guard.close()

    def test_allowed_tool_calls(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        """O2: All tool calls allowed, response returned."""
        guard = Guard(socket_path=mock_engine.socket_path, timeout=5.0)

        mock_client = MagicMock()
        tc1 = _make_tool_call("search", {"query": "test"})
        tc2 = _make_tool_call("read", {"path": "/tmp"})
        response = _make_response(tool_calls=[tc1, tc2])
        mock_client.chat.completions.create.return_value = response

        guarded = guard.openai(mock_client)
        result = guarded.chat.completions.create(model="gpt-4o", messages=[])
        assert result is response
        guard.close()

    def test_denied_tool_call_raises(self, mock_engine_factory) -> None:  # type: ignore[no-untyped-def]
        """O3: One tool call denied, PolicyDeniedError raised."""

        def deny_handler(req: dict[str, Any]) -> dict[str, Any]:
            if req["tool"] == "dangerous_tool":
                return {
                    "schema_version": 1,
                    "run_id": req["run_id"],
                    "seq": req["seq"],
                    "decision": "deny",
                    "rule_id": "block-dangerous",
                    "reason": "blocked",
                }
            return {
                "schema_version": 1,
                "run_id": req["run_id"],
                "seq": req["seq"],
                "decision": "allow",
            }

        engine = mock_engine_factory(deny_handler)
        guard = Guard(socket_path=engine.socket_path, timeout=5.0)

        mock_client = MagicMock()
        tc1 = _make_tool_call("safe_tool", {"a": 1})
        tc2 = _make_tool_call("dangerous_tool", {"b": 2})
        response = _make_response(tool_calls=[tc1, tc2])
        mock_client.chat.completions.create.return_value = response

        guarded = guard.openai(mock_client)
        with pytest.raises(PolicyDeniedError):
            guarded.chat.completions.create(model="gpt-4o", messages=[])
        guard.close()

    def test_proxies_non_chat_attrs(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        """O4: Other client attributes pass through."""
        guard = Guard(socket_path=mock_engine.socket_path, timeout=5.0)

        mock_client = MagicMock()
        mock_client.models.list.return_value = ["gpt-4o"]

        guarded = guard.openai(mock_client)
        result = guarded.models.list()
        assert result == ["gpt-4o"]
        guard.close()

    def test_chat_non_completions_attrs_pass_through(
        self, mock_engine
    ) -> None:  # type: ignore[no-untyped-def]
        """Chat attributes other than completions pass through."""
        guard = Guard(socket_path=mock_engine.socket_path, timeout=5.0)

        mock_client = MagicMock()
        mock_client.chat.some_other_method.return_value = "test"

        guarded = guard.openai(mock_client)
        result = guarded.chat.some_other_method()
        assert result == "test"
        guard.close()
