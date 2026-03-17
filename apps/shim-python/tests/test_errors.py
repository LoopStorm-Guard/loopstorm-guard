# SPDX-License-Identifier: MIT
"""Tests for the exception hierarchy."""

from __future__ import annotations

from loopstorm._errors import (
    ApprovalRequiredError,
    ConnectionClosedError,
    CooldownError,
    EngineUnavailableError,
    LoopStormError,
    MessageTooLargeError,
    PolicyDeniedError,
    RunTerminatedError,
)


class TestExceptionHierarchy:
    def test_all_inherit_from_loopstorm_error(self) -> None:
        assert issubclass(EngineUnavailableError, LoopStormError)
        assert issubclass(PolicyDeniedError, LoopStormError)
        assert issubclass(CooldownError, LoopStormError)
        assert issubclass(RunTerminatedError, LoopStormError)
        assert issubclass(ApprovalRequiredError, LoopStormError)
        assert issubclass(ConnectionClosedError, LoopStormError)
        assert issubclass(MessageTooLargeError, LoopStormError)

    def test_loopstorm_error_is_exception(self) -> None:
        assert issubclass(LoopStormError, Exception)


class TestPolicyDeniedError:
    def test_with_rule_id_and_reason(self) -> None:
        err = PolicyDeniedError(rule_id="block-ssrf", reason="SSRF blocked")
        assert err.rule_id == "block-ssrf"
        assert err.reason == "SSRF blocked"
        assert "block-ssrf" in str(err)
        assert "SSRF blocked" in str(err)

    def test_with_none_fields(self) -> None:
        err = PolicyDeniedError()
        assert err.rule_id is None
        assert err.reason is None
        assert "policy denied" in str(err)


class TestCooldownError:
    def test_attributes(self) -> None:
        err = CooldownError(cooldown_ms=5000, message="loop detected")
        assert err.cooldown_ms == 5000
        assert err.message == "loop detected"
        assert "5000ms" in str(err)

    def test_without_message(self) -> None:
        err = CooldownError(cooldown_ms=1000)
        assert err.message is None
        assert "1000ms" in str(err)


class TestRunTerminatedError:
    def test_with_reason(self) -> None:
        err = RunTerminatedError(reason="budget exceeded")
        assert err.reason == "budget exceeded"
        assert "budget exceeded" in str(err)

    def test_with_rule_id(self) -> None:
        err = RunTerminatedError(rule_id="kill-rule")
        assert err.rule_id == "kill-rule"


class TestApprovalRequiredError:
    def test_attributes(self) -> None:
        err = ApprovalRequiredError(
            approval_id="apr-123", timeout_ms=30000, timeout_action="deny"
        )
        assert err.approval_id == "apr-123"
        assert err.timeout_ms == 30000
        assert err.timeout_action == "deny"
        assert "apr-123" in str(err)


class TestMessageTooLargeError:
    def test_attributes(self) -> None:
        err = MessageTooLargeError(size=100000)
        assert err.size == 100000
        assert "65536" in str(err)
