# SPDX-License-Identifier: MIT
"""UDS connection management for the LoopStorm engine."""

from __future__ import annotations

import logging
import os
import socket
import sys

from loopstorm._errors import (
    ConnectionClosedError,
    EngineUnavailableError,
    MessageTooLargeError,
)
from loopstorm._protocol import DecisionRequest, DecisionResponse

_MAX_MESSAGE_SIZE = 65_536  # 64 KiB
_RECV_CHUNK = 4096

logger = logging.getLogger("loopstorm")


def resolve_socket_path(socket_path: str | None) -> str:
    """Resolve the engine socket path from arg, env, or platform default."""
    if socket_path is not None:
        return socket_path
    env = os.environ.get("LOOPSTORM_SOCKET")
    if env:
        return env
    if sys.platform == "win32":
        return r"\\.\pipe\loopstorm-engine"
    return "/tmp/loopstorm-engine.sock"


class EngineConnection:
    """Manages a UDS connection to the loopstorm-engine process."""

    def __init__(self, socket_path: str, timeout: float) -> None:
        self._socket_path = socket_path
        self._timeout = timeout
        self._sock: socket.socket | None = None
        self._buffer = b""

    def _connect(self) -> None:
        """Establish the UDS connection."""
        if not hasattr(socket, "AF_UNIX"):
            raise EngineUnavailableError(
                "Unix domain sockets are not supported on this platform"
            )
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self._timeout)
        sock.connect(self._socket_path)
        self._sock = sock
        self._buffer = b""

    def _ensure_connected(self) -> None:
        """Lazy connect: establish connection if not already connected."""
        if self._sock is None:
            self._connect()

    def send_request(self, request: DecisionRequest) -> None:
        """Serialize request as NDJSON and send over UDS."""
        self._ensure_connected()
        line = request.to_ndjson()
        if len(line) > _MAX_MESSAGE_SIZE:
            raise MessageTooLargeError(len(line))
        assert self._sock is not None  # ensured by _ensure_connected
        self._sock.sendall(line)

    def recv_response(self) -> DecisionResponse:
        """Read one NDJSON line from the socket and deserialize."""
        assert self._sock is not None
        while b"\n" not in self._buffer:
            chunk = self._sock.recv(_RECV_CHUNK)
            if not chunk:
                raise ConnectionClosedError()
            self._buffer += chunk
            if len(self._buffer) > _MAX_MESSAGE_SIZE:
                raise MessageTooLargeError(len(self._buffer))
        idx = self._buffer.index(b"\n")
        line = self._buffer[:idx]
        self._buffer = self._buffer[idx + 1 :]
        return DecisionResponse.from_json(line.decode("utf-8"))

    def request(self, req: DecisionRequest) -> DecisionResponse:
        """Send a request and return the response."""
        self.send_request(req)
        return self.recv_response()

    def reconnect(self) -> None:
        """Close and reestablish the connection."""
        self.close()
        self._connect()

    def close(self) -> None:
        """Close the UDS connection."""
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
            self._buffer = b""

    @property
    def connected(self) -> bool:
        """Return True if a socket connection exists."""
        return self._sock is not None

    def fileno(self) -> int:
        """Return the socket file descriptor (for testing)."""
        if self._sock is None:
            raise ValueError("not connected")
        return self._sock.fileno()
