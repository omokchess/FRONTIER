"""Rule-level tactical shortcuts for AlphaZero play and self-play."""
from __future__ import annotations

from ..game import Action, GameState, opp


def _winning_action(state: GameState, color: str | None = None) -> Action | None:
    """Return a legal action that wins immediately for the side to move.

    apply(check_terminal=True)는 매번 상대의 전체 합법수를 뽑아 체크메이트를
    판정한다 — 후보 하나당 그 비용을 물면 O(n^2)가 되어 요청당 수 초가 날아간다.
    체크메이트는 '상대가 체크일 때'만 성립하므로, 값싼 판정(오목·3연속 체크
    자멸)을 먼저 하고 체크가 걸린 수에 대해서만 비싼 검사를 한다.
    """
    mover = color or state.turn
    for action in state.legal_actions():
        nxt = state.clone()
        result = nxt.apply(action, check_terminal=False)
        if not result.ok:
            continue
        if result.winner == mover:      # 오목 / 3연속 체크 자멸
            return action
        if result.opponent_in_check and not nxt.terminal:
            if not nxt.legal_actions(validate_terminal=False):
                return action           # 체크메이트
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
        result = nxt.apply(action, check_terminal=False)
        if result.ok and not nxt.terminal and _winning_action(nxt, nxt.turn) is None:
            return action, "block_win"
    return None, None
