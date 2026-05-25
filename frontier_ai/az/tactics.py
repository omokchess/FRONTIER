"""Rule-level tactical shortcuts for AlphaZero play and self-play."""
from __future__ import annotations

from ..game import Action, GameState, opp


def _winning_action(state: GameState, color: str | None = None) -> Action | None:
    """Return a legal action that wins immediately for the side to move."""
    mover = color or state.turn
    for action in state.legal_actions():
        nxt = state.clone()
        result = nxt.apply(action)
        if result.ok and result.winner == mover:
            return action
    return None


def _opponent_threat_state(state: GameState) -> GameState:
    probe = state.clone()
    probe.turn = opp(state.turn)
    return probe


def tactical_action(state: GameState) -> tuple[Action | None, str | None]:
    """Find an urgent tactical action before consulting the neural MCTS.

    Priority:
      1. Win immediately if possible.
      2. If the opponent has an immediate win on the current board, play a move
         that removes all opponent immediate wins.
    """
    mover = state.turn
    win = _winning_action(state, mover)
    if win is not None:
        return win, "win"

    if _winning_action(_opponent_threat_state(state), opp(mover)) is None:
        return None, None

    for action in state.legal_actions():
        nxt = state.clone()
        result = nxt.apply(action)
        if result.ok and not nxt.terminal and _winning_action(nxt, nxt.turn) is None:
            return action, "block_win"
    return None, None
