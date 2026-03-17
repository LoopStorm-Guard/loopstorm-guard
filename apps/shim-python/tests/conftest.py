# SPDX-License-Identifier: MIT
"""Shared test fixtures for the LoopStorm Python shim tests."""

from __future__ import annotations

import json
import socket
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

# Path to the shared test vectors at repo root
FIXTURES_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures"
VECTORS_FILE = FIXTURES_DIR / "args-hash-vectors.json"


@pytest.fixture()
def args_hash_vectors() -> list[dict[str, Any]]:
    """Load the shared args-hash test vectors."""
    return json.loads(VECTORS_FILE.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


@dataclass
class MockEngine:
    """A mock UDS engine server for integration-style unit tests."""

    socket_path: str
    server: socket.socket
    _handler: Callable[[dict[str, Any]], dict[str, Any]]
    _thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self) -> None:
        while True:
            try:
                conn, _ = self.server.accept()
            except OSError:
                break
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn: socket.socket) -> None:
        buf = b""
        try:
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    idx = buf.index(b"\n")
                    line = buf[:idx]
                    buf = buf[idx + 1 :]
                    request = json.loads(line.decode("utf-8"))
                    response = self._handler(request)
                    resp_line = (
                        json.dumps(response, separators=(",", ":")) + "\n"
                    )
                    conn.sendall(resp_line.encode("utf-8"))
        except OSError:
            pass
        finally:
            conn.close()

    def stop(self) -> None:
        self.server.close()
        if self._thread:
            self._thread.join(timeout=2)


@pytest.fixture()
def mock_engine(tmp_path: Path) -> MockEngine:
    """Create a mock UDS engine that echoes allow responses by default."""
    sock_path = str(tmp_path / "test-engine.sock")

    def default_handler(request: dict[str, Any]) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "run_id": request["run_id"],
            "seq": request["seq"],
            "decision": "allow",
        }

    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(sock_path)
    srv.listen(5)
    engine = MockEngine(
        socket_path=sock_path, server=srv, _handler=default_handler
    )
    engine.start()
    yield engine  # type: ignore[misc]
    engine.stop()


@pytest.fixture()
def mock_engine_factory(tmp_path: Path) -> Callable[..., MockEngine]:
    """Factory fixture to create mock engines with custom handlers."""
    engines: list[MockEngine] = []

    def factory(
        handler: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> MockEngine:
        sock_path = str(tmp_path / f"test-engine-{len(engines)}.sock")
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(sock_path)
        srv.listen(5)
        engine = MockEngine(socket_path=sock_path, server=srv, _handler=handler)
        engine.start()
        engines.append(engine)
        return engine

    yield factory  # type: ignore[misc]
    for e in engines:
        e.stop()
