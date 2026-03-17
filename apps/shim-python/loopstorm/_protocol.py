# SPDX-License-Identifier: MIT
"""DecisionRequest/Response dataclasses and NDJSON serialization."""

from __future__ import annotations

import json
from dataclasses import dataclass, fields
from typing import Any


@dataclass
class DecisionRequest:
    """IPC request sent from the shim to the engine."""

    schema_version: int
    run_id: str
    seq: int
    tool: str
    args_hash: str
    ts: str
    args_redacted: dict[str, Any] | None = None
    agent_role: str | None = None
    agent_name: str | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    estimated_cost_usd: float | None = None
    environment: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict for JSON encoding, omitting None fields."""
        d: dict[str, Any] = {
            "schema_version": self.schema_version,
            "run_id": self.run_id,
            "seq": self.seq,
            "tool": self.tool,
            "args_hash": self.args_hash,
            "ts": self.ts,
        }
        for name in (
            "args_redacted",
            "agent_role",
            "agent_name",
            "model",
            "input_tokens",
            "output_tokens",
            "estimated_cost_usd",
            "environment",
        ):
            val = getattr(self, name)
            if val is not None:
                d[name] = val
        return d

    def to_ndjson(self) -> bytes:
        """Serialize to NDJSON line (UTF-8 bytes with trailing newline)."""
        payload = json.dumps(self.to_dict(), separators=(",", ":"), ensure_ascii=False)
        return payload.encode("utf-8") + b"\n"


@dataclass
class DecisionResponse:
    """IPC response sent from the engine to the shim."""

    schema_version: int
    run_id: str
    seq: int
    decision: str
    rule_id: str | None = None
    reason: str | None = None
    cooldown_ms: int | None = None
    cooldown_message: str | None = None
    approval_id: str | None = None
    approval_timeout_ms: int | None = None
    approval_timeout_action: str | None = None
    budget_remaining: dict[str, Any] | None = None
    ts: str | None = None

    _field_names: set[str] | None = None

    @classmethod
    def _get_field_names(cls) -> set[str]:
        if cls._field_names is None:
            cls._field_names = {f.name for f in fields(cls) if f.name != "_field_names"}
        return cls._field_names

    @classmethod
    def from_json(cls, json_str: str) -> DecisionResponse:
        """Deserialize from a JSON string, ignoring unknown fields."""
        data = json.loads(json_str)
        known = cls._get_field_names()
        return cls(**{k: v for k, v in data.items() if k in known})
