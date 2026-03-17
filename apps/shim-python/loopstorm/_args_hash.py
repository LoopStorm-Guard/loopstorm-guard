# SPDX-License-Identifier: MIT
"""Compute args_hash: SHA-256 of RFC 8785 (JCS) canonical JSON."""

from __future__ import annotations

import hashlib
from typing import Any

from loopstorm._jcs import jcs_serialize


def args_hash(args: Any) -> str:
    """Compute the args_hash for a tool call's arguments.

    Returns the lowercase hex SHA-256 digest of the JCS canonical form.
    If args is None, hashes the string "null".
    """
    canonical = jcs_serialize(args)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
