"""Outcome target shaping for AlphaZero training."""
from __future__ import annotations

from ..game import opp


def outcome_values(
    winner: str | None,
    reason: str | None,
    final_mover: str | None = None,
    threefold_contempt: float = 0.0,
) -> dict[str, float]:
    if winner == "w":
        return {"w": 1.0, "b": -1.0}
    if winner == "b":
        return {"w": -1.0, "b": 1.0}

    contempt = min(1.0, max(0.0, float(threefold_contempt or 0.0)))
    if reason == "threefold" and final_mover in ("w", "b") and contempt > 0.0:
        return {final_mover: -contempt, opp(final_mover): contempt}

    return {"w": 0.0, "b": 0.0}
