"""Small helpers for reporting AlphaZero game outcomes."""
from __future__ import annotations

from collections.abc import Iterable


REASON_LABELS = {
    "five_in_row": "five",
    "checkmate": "mate",
    "check_suicide": "suicide",
    "threefold": "3fold",
    "stalemate": "stale",
    "max_moves": "max",
    "unknown": "unknown",
}

REASON_ORDER = (
    "five_in_row",
    "checkmate",
    "check_suicide",
    "threefold",
    "stalemate",
    "max_moves",
    "unknown",
)


def new_result_stats(labels: Iterable[str]) -> dict:
    ordered = [label for label in labels if label != "draw"]
    stats = {label: 0 for label in ordered}
    stats["draw"] = 0
    stats["reasons"] = {label: {} for label in [*ordered, "draw"]}
    stats["moves"] = {"total": 0, "min": None, "max": 0}
    return stats


def record_result(stats: dict, winner_label: str | None, reason: str | None, moves: int) -> None:
    label = winner_label if winner_label in stats and winner_label != "draw" else "draw"
    reason_key = reason or "unknown"
    move_count = int(moves)

    stats[label] += 1
    reason_counts = stats.setdefault("reasons", {}).setdefault(label, {})
    reason_counts[reason_key] = reason_counts.get(reason_key, 0) + 1

    move_stats = stats.setdefault("moves", {"total": 0, "min": None, "max": 0})
    move_stats["total"] = int(move_stats.get("total", 0)) + move_count
    move_stats["min"] = move_count if move_stats.get("min") is None else min(move_stats["min"], move_count)
    move_stats["max"] = max(int(move_stats.get("max", 0)), move_count)


def counts_view(stats: dict, labels: Iterable[str]) -> dict[str, int]:
    return {label: int(stats.get(label, 0)) for label in labels}


def format_reason_stats(stats: dict, labels: Iterable[str]) -> str:
    reasons = stats.get("reasons", {})
    chunks = []
    for label in labels:
        counts = reasons.get(label, {})
        if not counts:
            continue
        ordered = [key for key in REASON_ORDER if counts.get(key)]
        ordered.extend(sorted(key for key in counts if key not in REASON_ORDER and counts[key]))
        parts = [f"{REASON_LABELS.get(key, key)}:{counts[key]}" for key in ordered]
        chunks.append(f"{label}[{','.join(parts)}]")
    return " ".join(chunks) if chunks else "-"


def format_move_stats(stats: dict, labels: Iterable[str]) -> str:
    games = sum(int(stats.get(label, 0)) for label in labels)
    if games <= 0:
        return "avg=0.0 min=0 max=0"
    move_stats = stats.get("moves", {})
    total = int(move_stats.get("total", 0))
    min_moves = move_stats.get("min")
    max_moves = int(move_stats.get("max", 0))
    return f"avg={total / games:.1f} min={int(min_moves or 0)} max={max_moves}"
