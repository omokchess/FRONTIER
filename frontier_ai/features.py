from __future__ import annotations
from .game import GameState, KINDS, PIECE_VALUES, opp

FEATURE_NAMES = (
    [f"board_{k}" for k in KINDS] + [f"hand_{k}" for k in KINDS] +
    ["line2", "line3", "line4", "line5", "opp_line2", "opp_line3", "opp_line4", "opp_line5",
     "give_check", "receive_check", "my_check_streak", "opp_check_streak", "my_total_checks", "opp_total_checks",
     "mobility", "opp_mobility", "center", "opp_center", "king_placed", "opp_king_placed", "tempo", "bias"]
)
FEATURE_DIM = len(FEATURE_NAMES)


def _line_counts(state: GameState, color: str) -> list[float]:
    counts = [0.0, 0.0, 0.0, 0.0]
    for r in range(8):
        for c in range(8):
            for dr, dc in ((0,1),(1,0),(1,1),(1,-1)):
                cells = []
                for n in range(5):
                    rr, cc = r + n * dr, c + n * dc
                    if 0 <= rr < 8 and 0 <= cc < 8:
                        cells.append(state.board[rr][cc])
                    else:
                        cells = []
                        break
                if not cells: continue
                mine = sum(1 for p in cells if p and p.color == color)
                theirs = sum(1 for p in cells if p and p.color != color)
                if theirs == 0 and 2 <= mine <= 5:
                    counts[mine - 2] += 1
    return [min(v / 12.0, 2.0) for v in counts]


def encode(state: GameState, perspective: str) -> list[float]:
    enemy = opp(perspective)
    x: list[float] = []
    for kind in KINDS:
        value = PIECE_VALUES.get(kind, 1.0) or 1.0
        mine = sum(1 for row in state.board for p in row if p and p.color == perspective and p.kind == kind)
        theirs = sum(1 for row in state.board for p in row if p and p.color == enemy and p.kind == kind)
        x.append((mine - theirs) * value / 12.0)
    for kind in KINDS:
        value = PIECE_VALUES.get(kind, 1.0) or 1.0
        x.append((state.hands[perspective].get(kind, 0) - state.hands[enemy].get(kind, 0)) * value / 12.0)
    x.extend(_line_counts(state, perspective))
    x.extend(_line_counts(state, enemy))
    x.extend([1.0 if state.is_in_check(enemy) else 0.0, 1.0 if state.is_in_check(perspective) else 0.0])
    x.extend([state.check_streak[perspective] / 3.0, state.check_streak[enemy] / 3.0,
              state.total_checks[perspective] / 5.0, state.total_checks[enemy] / 5.0])
    # Exact mobility is expensive in search; pseudo mobility retains useful signal.
    x.extend([min(len(state.pseudo_actions(perspective)) / 100.0, 2.0), min(len(state.pseudo_actions(enemy)) / 100.0, 2.0)])
    center = lambda col: sum(1 for r in range(2,6) for c in range(2,6) if state.board[r][c] and state.board[r][c].color == col) / 12.0
    x.extend([center(perspective), center(enemy), float(state.king_placed[perspective]), float(state.king_placed[enemy]),
              1.0 if state.turn == perspective else -1.0, 1.0])
    assert len(x) == FEATURE_DIM
    return x
