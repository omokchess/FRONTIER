"""Board-plane input + action<->policy-index mapping for AlphaZero-style training.

Action policy space (fixed size):
  place: kind_i * 64 + (r*8 + c)                 -> 0 .. 575
  move:  576 + (fr*8+fc) * 64 + (tr*8+tc)        -> 576 .. 4671
Pawn-promotion variants collapse to a single move index (executed as auto-Q),
matching the front-end bridge which auto-promotes to Queen.
"""
from __future__ import annotations
import numpy as np
from ..game import GameState, Action, KINDS, opp

NUM_KINDS = len(KINDS)                 # 9
NUM_PLACE = NUM_KINDS * 64             # 576
NUM_MOVE = 64 * 64                     # 4096
POLICY_SIZE = NUM_PLACE + NUM_MOVE     # 4672
# planes: mine(9) + enemy(9) pieces, mine(9)+enemy(9) hands, + 6 scalar planes
NUM_PLANES = 4 * NUM_KINDS + 6         # 42

_KIND_IDX = {k: i for i, k in enumerate(KINDS)}


def action_to_index(a: Action) -> int:
    if a.type == "place":
        assert a.kind is not None and a.r is not None and a.c is not None
        return _KIND_IDX[a.kind] * 64 + (a.r * 8 + a.c)
    assert a.fr is not None and a.fc is not None and a.tr is not None and a.tc is not None
    return NUM_PLACE + (a.fr * 8 + a.fc) * 64 + (a.tr * 8 + a.tc)


def index_to_action(idx: int, color: str) -> Action:
    if idx < NUM_PLACE:
        ki, sq = divmod(idx, 64)
        return Action("place", color, kind=KINDS[ki], r=sq // 8, c=sq % 8)
    m = idx - NUM_PLACE
    frm, to = divmod(m, 64)
    return Action("move", color, fr=frm // 8, fc=frm % 8, tr=to // 8, tc=to % 8)


def legal_action_indices(state: GameState) -> tuple[list[int], dict[int, Action]]:
    """Legal actions as policy indices, collapsing promotion variants (keep one representative)."""
    mapping: dict[int, Action] = {}
    for a in state.legal_actions():
        idx = action_to_index(a)
        if idx not in mapping:
            mapping[idx] = a
    return list(mapping.keys()), mapping


def encode_planes(state: GameState, perspective: str) -> np.ndarray:
    """[NUM_PLANES, 8, 8] float32 board encoding from `perspective`'s point of view."""
    enemy = opp(perspective)
    planes = np.zeros((NUM_PLANES, 8, 8), dtype=np.float32)
    for r in range(8):
        for c in range(8):
            p = state.board[r][c]
            if p is None:
                continue
            ki = _KIND_IDX[p.kind]
            planes[ki if p.color == perspective else NUM_KINDS + ki, r, c] = 1.0
    base = 2 * NUM_KINDS
    for i, k in enumerate(KINDS):
        planes[base + i, :, :] = state.hands[perspective].get(k, 0) / 8.0
        planes[base + NUM_KINDS + i, :, :] = state.hands[enemy].get(k, 0) / 8.0
    s = 4 * NUM_KINDS
    planes[s + 0, :, :] = 1.0 if state.king_placed[perspective] else 0.0
    planes[s + 1, :, :] = 1.0 if state.king_placed[enemy] else 0.0
    planes[s + 2, :, :] = state.check_streak[perspective] / 3.0
    planes[s + 3, :, :] = state.check_streak[enemy] / 3.0
    planes[s + 4, :, :] = state.total_checks[perspective] / 5.0
    planes[s + 5, :, :] = state.total_checks[enemy] / 5.0
    return planes
