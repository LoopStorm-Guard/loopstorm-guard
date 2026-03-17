# SPDX-License-Identifier: MIT
"""Tests for UDS connection management."""

from __future__ import annotations

import sys

import pytest

from loopstorm._connection import EngineConnection, resolve_socket_path
from loopstorm._errors import MessageTooLargeError
from loopstorm._protocol import DecisionRequest


class TestResolveSocketPath:
    def test_explicit_path(self) -> None:
        assert resolve_socket_path("/custom/path.sock") == "/custom/path.sock"

    def test_env_variable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("LOOPSTORM_SOCKET", "/env/path.sock")
        assert resolve_socket_path(None) == "/env/path.sock"

    def test_explicit_overrides_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("LOOPSTORM_SOCKET", "/env/path.sock")
        assert resolve_socket_path("/explicit.sock") == "/explicit.sock"

    @pytest.mark.skipif(sys.platform == "win32", reason="Unix default test")
    def test_unix_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("LOOPSTORM_SOCKET", raising=False)
        assert resolve_socket_path(None) == "/tmp/loopstorm-engine.sock"


class TestEngineConnection:
    def test_not_connected_initially(self) -> None:
        conn = EngineConnection("/nonexistent.sock", timeout=1.0)
        assert not conn.connected

    @pytest.mark.skipif(sys.platform == "win32", reason="UDS not supported")
    def test_connect_failure(self) -> None:
        conn = EngineConnection("/nonexistent.sock", timeout=1.0)
        with pytest.raises(OSError):
            conn._connect()

    @pytest.mark.skipif(sys.platform == "win32", reason="UDS not supported")
    def test_send_message_too_large(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        conn = EngineConnection(mock_engine.socket_path, timeout=5.0)
        conn._connect()
        try:
            # Create a request with args_redacted large enough to exceed 64 KiB
            big_args = {"data": "x" * 70_000}
            req = DecisionRequest(
                schema_version=1,
                run_id="test",
                seq=1,
                tool="test",
                args_hash="aa" * 32,
                ts="2026-03-17T00:00:00+00:00",
                args_redacted=big_args,
            )
            with pytest.raises(MessageTooLargeError):
                conn.send_request(req)
        finally:
            conn.close()

    @pytest.mark.skipif(sys.platform == "win32", reason="UDS not supported")
    def test_close_idempotent(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        conn = EngineConnection(mock_engine.socket_path, timeout=5.0)
        conn._connect()
        conn.close()
        conn.close()  # Should not raise
        assert not conn.connected

    @pytest.mark.skipif(sys.platform == "win32", reason="UDS not supported")
    def test_send_recv_round_trip(self, mock_engine) -> None:  # type: ignore[no-untyped-def]
        conn = EngineConnection(mock_engine.socket_path, timeout=5.0)
        try:
            req = DecisionRequest(
                schema_version=1,
                run_id="round-trip-test",
                seq=1,
                tool="test.tool",
                args_hash="bb" * 32,
                ts="2026-03-17T00:00:00+00:00",
            )
            resp = conn.request(req)
            assert resp.decision == "allow"
            assert resp.run_id == "round-trip-test"
            assert resp.seq == 1
        finally:
            conn.close()
