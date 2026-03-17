# SPDX-License-Identifier: MIT
"""Tests for the Guard class with mock UDS engine."""

from __future__ import annotations

import sys
import uuid
from typing import Any
from unittest.mock import patch

import pytest

from loopstorm import (
    CooldownError,
    DecisionResult,
    EngineUnavailableError,
    Guard,
    PolicyDeniedError,
    RunTerminatedError,
)

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="UDS not supported")


class TestGuardAllow:
    def test_wrap_allow_calls_function(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        """G1: Allowed call executes and returns."""
        guard = Guard(socket_path=mock_engine.socket_path, timeout=5.0)
        called = False

        @guard.wrap("read_file")
        def read_file(path: str) -> str:
            nonlocal called
            called = True
            return f"contents of {path}"

        result = read_file(path="/tmp/test.txt")
        assert called
        assert result == "contents of /tmp/test.txt"
        guard.close()

    def test_check_returns_result(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        """G5: check() returns DecisionResult."""
        guard = Guard(socket_path=mock_engine.socket_path, timeout=5.0)
        result = guard.check("test_tool", args={"key": "value"})
        assert isinstance(result, DecisionResult)
        assert result.decision == "allow"
        guard.close()


class TestGuardDeny:
    def test_wrap_deny_raises(self, mock_engine_factory) -> None:  # type: ignore[no-untyped-def]
        """G2: Denied call raises PolicyDeniedError."""

        def deny_handler(req: dict[str, Any]) -> dict[str, Any]:
            return {
                "schema_version": 1,
                "run_id": req["run_id"],
                "seq": req["seq"],
                "decision": "deny",
                "rule_id": "block-ssrf",
                "reason": "SSRF blocked",
            }

        engine = mock_engine_factory(deny_handler)
        guard = Guard(socket_path=engine.socket_path, timeout=5.0)

        with pytest.raises(PolicyDeniedError) as exc_info:
            guard.check("http_request", args={"url": "http://169.254.169.254"})

        assert exc_info.value.rule_id == "block-ssrf"
        guard.close()


class TestGuardKill:
    def test_wrap_kill_raises(self, mock_engine_factory) -> None:  # type: ignore[no-untyped-def]
        """G3: Kill raises RunTerminatedError."""

        def kill_handler(req: dict[str, Any]) -> dict[str, Any]:
            return {
                "schema_version": 1,
                "run_id": req["run_id"],
                "seq": req["seq"],
                "decision": "kill",
                "reason": "budget exceeded",
            }

        engine = mock_engine_factory(kill_handler)
        guard = Guard(socket_path=engine.socket_path, timeout=5.0)

        with pytest.raises(RunTerminatedError) as exc_info:
            guard.check("expensive_tool")

        assert "budget exceeded" in str(exc_info.value)
        guard.close()


class TestGuardCooldown:
    def test_cooldown_sleeps_then_raises(self, mock_engine_factory) -> None:  # type: ignore[no-untyped-def]
        """G4: Cooldown sleeps then raises CooldownError."""

        def cooldown_handler(req: dict[str, Any]) -> dict[str, Any]:
            return {
                "schema_version": 1,
                "run_id": req["run_id"],
                "seq": req["seq"],
                "decision": "cooldown",
                "cooldown_ms": 100,
                "cooldown_message": "loop detected",
            }

        engine = mock_engine_factory(cooldown_handler)
        guard = Guard(socket_path=engine.socket_path, timeout=5.0)

        with patch("loopstorm._guard.time.sleep") as mock_sleep:
            with pytest.raises(CooldownError) as exc_info:
                guard.check("looping_tool")

            mock_sleep.assert_called_once_with(0.1)  # 100ms

        assert exc_info.value.cooldown_ms == 100
        assert exc_info.value.message == "loop detected"
        guard.close()


class TestGuardSeq:
    def test_seq_increments(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        """G6: Each call gets seq+1."""
        seqs_received: list[int] = []

        original_handler = mock_engine._handler

        def tracking_handler(req: dict[str, Any]) -> dict[str, Any]:
            seqs_received.append(req["seq"])
            return original_handler(req)

        mock_engine._handler = tracking_handler

        guard = Guard(socket_path=mock_engine.socket_path, timeout=5.0)
        guard.check("tool1")
        guard.check("tool2")
        guard.check("tool3")
        assert seqs_received == [1, 2, 3]
        guard.close()


class TestGuardFailOpen:
    def test_fail_open_engine_down(self) -> None:
        """G7: Engine unreachable, fail_open=True -> call proceeds."""
        guard = Guard(
            socket_path="/nonexistent-engine.sock",
            fail_open=True,
            timeout=1.0,
        )
        result = guard.check("some_tool", args={"key": "value"})
        assert result.decision == "allow"
        guard.close()

    def test_fail_closed_engine_down(self) -> None:
        """G8: Engine unreachable, fail_open=False -> raises."""
        guard = Guard(
            socket_path="/nonexistent-engine.sock",
            fail_open=False,
            timeout=1.0,
        )
        with pytest.raises(EngineUnavailableError):
            guard.check("some_tool")
        guard.close()


class TestGuardContextManager:
    def test_context_manager(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        """G10: Guard as context manager closes connection."""
        with Guard(socket_path=mock_engine.socket_path, timeout=5.0) as guard:
            result = guard.check("test")
            assert result.decision == "allow"
        # Connection should be closed
        assert not guard._conn.connected


class TestGuardRunId:
    def test_run_id_auto_generated(self) -> None:
        """G11: run_id is a valid UUID when not provided."""
        guard = Guard(socket_path="/tmp/test.sock")
        # Should not raise
        uuid.UUID(guard.run_id)
        guard.close()

    def test_run_id_preserved_across_calls(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        """G12: Same run_id in all requests."""
        run_ids: list[str] = []

        original_handler = mock_engine._handler

        def tracking_handler(req: dict[str, Any]) -> dict[str, Any]:
            run_ids.append(req["run_id"])
            return original_handler(req)

        mock_engine._handler = tracking_handler

        guard = Guard(socket_path=mock_engine.socket_path, timeout=5.0)
        guard.check("tool1")
        guard.check("tool2")
        assert len(run_ids) == 2
        assert run_ids[0] == run_ids[1] == guard.run_id
        guard.close()

    def test_run_id_custom(self) -> None:
        """Custom run_id is preserved."""
        guard = Guard(socket_path="/tmp/test.sock", run_id="custom-run-id")
        assert guard.run_id == "custom-run-id"
        guard.close()


class TestGuardProtocolErrors:
    def test_response_seq_mismatch_treated_as_kill(
        self, mock_engine_factory
    ) -> None:  # type: ignore[no-untyped-def]
        """G13: Protocol error handling for seq mismatch."""

        def bad_seq_handler(req: dict[str, Any]) -> dict[str, Any]:
            return {
                "schema_version": 1,
                "run_id": req["run_id"],
                "seq": req["seq"] + 999,  # Wrong seq
                "decision": "allow",
            }

        engine = mock_engine_factory(bad_seq_handler)
        guard = Guard(socket_path=engine.socket_path, timeout=5.0)

        with pytest.raises(RunTerminatedError, match="protocol error"):
            guard.check("test")
        guard.close()

    def test_response_run_id_mismatch_treated_as_kill(
        self, mock_engine_factory
    ) -> None:  # type: ignore[no-untyped-def]
        """G14: Protocol error handling for run_id mismatch."""

        def bad_run_id_handler(req: dict[str, Any]) -> dict[str, Any]:
            return {
                "schema_version": 1,
                "run_id": "wrong-run-id",
                "seq": req["seq"],
                "decision": "allow",
            }

        engine = mock_engine_factory(bad_run_id_handler)
        guard = Guard(socket_path=engine.socket_path, timeout=5.0)

        with pytest.raises(RunTerminatedError, match="protocol error"):
            guard.check("test")
        guard.close()


class TestGuardWrapArgs:
    def test_wrap_captures_positional_args(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        """wrap() converts positional args to dict using signature."""
        guard = Guard(socket_path=mock_engine.socket_path, timeout=5.0)

        @guard.wrap("my_tool")
        def my_tool(a: str, b: int) -> str:
            return f"{a}-{b}"

        result = my_tool("hello", 42)
        assert result == "hello-42"
        guard.close()

    def test_wrap_captures_kwargs(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        """wrap() passes keyword args correctly."""
        guard = Guard(socket_path=mock_engine.socket_path, timeout=5.0)

        @guard.wrap("my_tool")
        def my_tool(path: str, recursive: bool = False) -> str:
            return f"{path}:{recursive}"

        result = my_tool(path="/tmp", recursive=True)
        assert result == "/tmp:True"
        guard.close()
