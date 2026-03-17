# SPDX-License-Identifier: MIT
"""Public result dataclasses for the LoopStorm Guard Python shim."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class BudgetRemaining:
    """Current budget state after a decision."""

    cost_usd: float | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    call_count: int | None = None


@dataclass(frozen=True)
class DecisionResult:
    """Result of a guard.check() call."""

    decision: str
    rule_id: str | None = None
    reason: str | None = None
    cooldown_ms: int | None = None
    cooldown_message: str | None = None
    budget_remaining: BudgetRemaining | None = None
    extra: dict[str, object] = field(default_factory=dict)
