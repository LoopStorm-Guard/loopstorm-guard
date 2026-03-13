# SPDX-License-Identifier: MIT
"""
LoopStorm Guard Python shim.

Wraps agent tool calls and forwards them to the loopstorm-engine binary
over a Unix Domain Socket (or named pipe on Windows) for enforcement.

Mode 0 (air-gapped): the engine binary is bundled in loopstorm/bin/.
                     No network calls are made by this package.
Mode 2+ (cloud):     events are forwarded by the engine; this package
                     only handles local IPC.

Usage:
    from loopstorm import Guard

    guard = Guard(policy="path/to/policy.yaml")

    @guard.wrap
    def my_tool_call(args):
        ...
"""

from loopstorm._guard import Guard
from loopstorm._version import __version__

__all__ = ["Guard", "__version__"]
