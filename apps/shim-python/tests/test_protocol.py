# SPDX-License-Identifier: MIT
"""Tests for DecisionRequest/DecisionResponse and NDJSON serialization."""

from __future__ import annotations

import json

from loopstorm._protocol import DecisionRequest, DecisionResponse


class TestDecisionRequest:
    def test_to_dict_required_only(self) -> None:
        """P1: Only required fields in output."""
        req = DecisionRequest(
            schema_version=1,
            run_id="550e8400-e29b-41d4-a716-446655440000",
            seq=1,
            tool="file.read",
            args_hash="aabb" * 16,
            ts="2026-03-17T00:00:00+00:00",
        )
        d = req.to_dict()
        assert d == {
            "schema_version": 1,
            "run_id": "550e8400-e29b-41d4-a716-446655440000",
            "seq": 1,
            "tool": "file.read",
            "args_hash": "aabb" * 16,
            "ts": "2026-03-17T00:00:00+00:00",
        }
        # None fields must not be present
        assert "agent_role" not in d
        assert "model" not in d
        assert "environment" not in d

    def test_to_dict_all_fields(self) -> None:
        """P2: All optional fields included when set."""
        req = DecisionRequest(
            schema_version=1,
            run_id="run-1",
            seq=3,
            tool="http.request",
            args_hash="cc" * 32,
            ts="2026-03-17T12:00:00+00:00",
            args_redacted={"url": "https://example.com"},
            agent_role="researcher",
            agent_name="Agent-1",
            model="gpt-4o",
            input_tokens=100,
            output_tokens=50,
            estimated_cost_usd=0.005,
            environment="production",
        )
        d = req.to_dict()
        assert d["agent_role"] == "researcher"
        assert d["model"] == "gpt-4o"
        assert d["input_tokens"] == 100
        assert d["output_tokens"] == 50
        assert d["estimated_cost_usd"] == 0.005
        assert d["environment"] == "production"
        assert d["args_redacted"] == {"url": "https://example.com"}
        assert d["agent_name"] == "Agent-1"

    def test_omits_none_fields(self) -> None:
        """P3: None fields not in JSON."""
        req = DecisionRequest(
            schema_version=1,
            run_id="run-1",
            seq=1,
            tool="test",
            args_hash="dd" * 32,
            ts="2026-03-17T00:00:00+00:00",
            agent_role=None,
            model=None,
        )
        d = req.to_dict()
        assert "agent_role" not in d
        assert "model" not in d

    def test_to_ndjson(self) -> None:
        """NDJSON output is compact JSON + newline."""
        req = DecisionRequest(
            schema_version=1,
            run_id="run-1",
            seq=1,
            tool="test",
            args_hash="ee" * 32,
            ts="2026-03-17T00:00:00+00:00",
        )
        line = req.to_ndjson()
        assert line.endswith(b"\n")
        # Must be compact (no spaces)
        decoded = line.decode("utf-8").rstrip("\n")
        assert " " not in decoded
        parsed = json.loads(decoded)
        assert parsed["tool"] == "test"


class TestDecisionResponse:
    def test_from_json_allow(self) -> None:
        """P4: Parse allow response."""
        resp = DecisionResponse.from_json(
            '{"schema_version":1,"run_id":"r","seq":1,"decision":"allow"}'
        )
        assert resp.decision == "allow"
        assert resp.rule_id is None

    def test_from_json_deny(self) -> None:
        """P5: Parse deny response with rule_id."""
        resp = DecisionResponse.from_json(
            '{"schema_version":1,"run_id":"r","seq":1,"decision":"deny",'
            '"rule_id":"block-ssrf","reason":"SSRF blocked"}'
        )
        assert resp.decision == "deny"
        assert resp.rule_id == "block-ssrf"
        assert resp.reason == "SSRF blocked"

    def test_from_json_cooldown(self) -> None:
        """P6: Parse cooldown with cooldown_ms."""
        resp = DecisionResponse.from_json(
            '{"schema_version":1,"run_id":"r","seq":1,"decision":"cooldown",'
            '"cooldown_ms":5000,"cooldown_message":"loop detected"}'
        )
        assert resp.decision == "cooldown"
        assert resp.cooldown_ms == 5000
        assert resp.cooldown_message == "loop detected"

    def test_from_json_kill(self) -> None:
        """P7: Parse kill response."""
        resp = DecisionResponse.from_json(
            '{"schema_version":1,"run_id":"r","seq":1,"decision":"kill",'
            '"reason":"budget exceeded"}'
        )
        assert resp.decision == "kill"
        assert resp.reason == "budget exceeded"

    def test_ignores_unknown_fields(self) -> None:
        """P8: Forward compat — unknown fields are ignored."""
        resp = DecisionResponse.from_json(
            '{"schema_version":1,"run_id":"r","seq":1,"decision":"allow",'
            '"unknown_field":"value","another":123}'
        )
        assert resp.decision == "allow"
        assert not hasattr(resp, "unknown_field")

    def test_ndjson_round_trip(self) -> None:
        """P9: Serialize request + deserialize response."""
        req = DecisionRequest(
            schema_version=1,
            run_id="round-trip",
            seq=7,
            tool="test",
            args_hash="ff" * 32,
            ts="2026-03-17T00:00:00+00:00",
        )
        ndjson = req.to_ndjson()
        # Simulate engine echo
        req_data = json.loads(ndjson)
        resp_data = {
            "schema_version": req_data["schema_version"],
            "run_id": req_data["run_id"],
            "seq": req_data["seq"],
            "decision": "allow",
        }
        resp_json = json.dumps(resp_data, separators=(",", ":"))
        resp = DecisionResponse.from_json(resp_json)
        assert resp.seq == 7
        assert resp.run_id == "round-trip"

    def test_budget_remaining(self) -> None:
        """Parse response with budget_remaining."""
        resp = DecisionResponse.from_json(
            '{"schema_version":1,"run_id":"r","seq":1,"decision":"allow",'
            '"budget_remaining":{"cost_usd":1.5,"call_count":10}}'
        )
        assert resp.budget_remaining is not None
        assert resp.budget_remaining["cost_usd"] == 1.5
        assert resp.budget_remaining["call_count"] == 10
