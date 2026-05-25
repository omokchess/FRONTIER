from __future__ import annotations

from dataclasses import dataclass, field
from copy import deepcopy
from typing import Any, Iterable

COLORS = ("w", "b")
KINDS = ("K", "Q", "R", "B", "N", "P", "SH", "SN", "JP")
DEFAULT_HAND: dict[str, int] = {"K": 1, "Q": 1, "R": 2, "B": 2, "N": 2, "P": 8, "SH": 0, "SN": 0, "JP": 0}
PIECE_VALUES: dict[str, float] = {"K": 0, "Q": 9, "R": 5, "B": 3.25, "N": 3, "P": 1, "SH": 3, "SN": 5.5, "JP": 3.25}
PROMOTIONS = ("Q", "R", "B", "N")


def opp(color: str) -> str:
    return "b" if color == "w" else "w"


def in_bounds(r: int, c: int) -> bool:
    return 0 <= r < 8 and 0 <= c < 8


def parse_hand_str(value: str | None) -> dict[str, int]:
    import re
    hand = dict(DEFAULT_HAND)
    if not value:
        return hand
    for kind, count in re.findall(r"([A-Z]{1,2})(\d+)", value):
        if kind in hand:
            hand[kind] = int(count)
    return hand


@dataclass
class Piece:
    color: str
    kind: str
    attacks: int = 0

    def to_json(self) -> dict[str, Any]:
        d: dict[str, Any] = {"color": self.color, "kind": self.kind}
        if self.kind == "SN":
            d["attacks"] = self.attacks
        return d

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> "Piece":
        return cls(str(d["color"]), str(d["kind"]), int(d.get("attacks", 0)))


@dataclass(frozen=True)
class Action:
    type: str
    color: str
    kind: str | None = None
    r: int | None = None
    c: int | None = None
    fr: int | None = None
    fc: int | None = None
    tr: int | None = None
    tc: int | None = None
    promote: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if v is not None}

    @classmethod
    def from_json(cls, d: dict[str, Any], default_color: str | None = None) -> "Action":
        return cls(
            type=str(d["type"]), color=str(d.get("color", default_color)),
            kind=d.get("kind"), r=d.get("r"), c=d.get("c"),
            fr=d.get("fr"), fc=d.get("fc"), tr=d.get("tr"), tc=d.get("tc"),
            promote=d.get("promote")
        )


@dataclass
class ApplyResult:
    ok: bool
    error: str | None = None
    winner: str | None = None
    reason: str | None = None
    draw: bool = False
    opponent_in_check: bool = False


@dataclass
class GameState:
    board: list[list[Piece | None]] = field(default_factory=lambda: [[None for _ in range(8)] for _ in range(8)])
    hands: dict[str, dict[str, int]] = field(default_factory=lambda: {"w": dict(DEFAULT_HAND), "b": dict(DEFAULT_HAND)})
    turn: str = "w"
    king_placed: dict[str, bool] = field(default_factory=lambda: {"w": False, "b": False})
    check_streak: dict[str, int] = field(default_factory=lambda: {"w": 0, "b": 0})  # checks received consecutively
    total_checks: dict[str, int] = field(default_factory=lambda: {"w": 0, "b": 0})   # checks given
    history: list[str] = field(default_factory=list)
    last_move: dict[str, Any] | None = None
    terminal: bool = False
    winner: str | None = None
    end_reason: str | None = None
    potion: bool = False

    @classmethod
    def initial(cls, hand: dict[str, int] | None = None) -> "GameState":
        initial = dict(hand or DEFAULT_HAND)
        return cls(hands={"w": dict(initial), "b": dict(initial)})

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "GameState":
        if data.get("potion"):
            raise ValueError("potion mode is not supported by the Python AI v1 model")
        raw_board = data.get("board") or [[None for _ in range(8)] for _ in range(8)]
        board: list[list[Piece | None]] = []
        for row in raw_board:
            board.append([Piece.from_json(cell) if cell else None for cell in row])
        return cls(
            board=board,
            hands={c: {k: int(data.get("hands", {}).get(c, {}).get(k, 0)) for k in KINDS} for c in COLORS},
            turn=str(data.get("turn", "w")),
            king_placed={c: bool(data.get("kingPlaced", data.get("king_placed", {})).get(c, False)) for c in COLORS},
            check_streak={c: int(data.get("checkStreak", data.get("check_streak", {})).get(c, 0)) for c in COLORS},
            total_checks={c: int(data.get("totalChecks", data.get("total_checks", {})).get(c, 0)) for c in COLORS},
            history=list(data.get("history", [])),
            last_move=data.get("lastMove"),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "board": [[p.to_json() if p else None for p in row] for row in self.board],
            "hands": deepcopy(self.hands), "turn": self.turn,
            "kingPlaced": dict(self.king_placed), "checkStreak": dict(self.check_streak),
            "totalChecks": dict(self.total_checks), "history": list(self.history),
            "lastMove": deepcopy(self.last_move), "potion": False,
        }

    def clone(self) -> "GameState":
        # Hand-built copy (semantically identical to deepcopy, much faster — called per pseudo-action).
        g = GameState.__new__(GameState)
        g.board = [[Piece(p.color, p.kind, p.attacks) if p is not None else None for p in row] for row in self.board]
        g.hands = {"w": dict(self.hands["w"]), "b": dict(self.hands["b"])}
        g.turn = self.turn
        g.king_placed = dict(self.king_placed)
        g.check_streak = dict(self.check_streak)
        g.total_checks = dict(self.total_checks)
        g.history = list(self.history)
        g.last_move = None if self.last_move is None else dict(self.last_move)
        g.terminal = self.terminal
        g.winner = self.winner
        g.end_reason = self.end_reason
        g.potion = self.potion
        return g

    @staticmethod
    def in_general_zone(r: int, c: int) -> bool:
        return 2 <= r <= 5 and 1 <= c <= 6

    @staticmethod
    def in_king_zone(r: int, c: int) -> bool:
        return 2 <= r <= 5 and 2 <= c <= 5

    @staticmethod
    def in_corner_zone(r: int, c: int) -> bool:
        return r in (0, 7) and c in (0, 7)

    def can_place_here(self, color: str, kind: str, r: int, c: int) -> bool:
        if self.board[r][c] is not None:
            return False
        if not self.king_placed[color]:
            return kind == "K" and self.in_king_zone(r, c)
        if kind == "K":
            return False
        if kind == "SN":
            return self.in_corner_zone(r, c)
        return self.in_general_zone(r, c)

    def find_king(self, color: str) -> tuple[int, int] | None:
        for r in range(8):
            for c in range(8):
                p = self.board[r][c]
                if p and p.color == color and p.kind == "K":
                    return r, c
        return None

    def piece_moves(self, r: int, c: int, piece: Piece) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
        moves: list[tuple[int, int]] = []
        attacks: list[tuple[int, int]] = []
        k, color = piece.kind, piece.color
        if k == "K":
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc = r + dr, c + dc
                    if not in_bounds(nr, nc):
                        continue
                    t = self.board[nr][nc]
                    if t is None: moves.append((nr, nc))
                    elif t.color != color: attacks.append((nr, nc))
        elif k in ("Q", "R", "B"):
            dirs: list[tuple[int, int]] = []
            if k != "B": dirs += [(-1, 0), (1, 0), (0, -1), (0, 1)]
            if k != "R": dirs += [(-1, -1), (-1, 1), (1, -1), (1, 1)]
            for dr, dc in dirs:
                nr, nc = r + dr, c + dc
                while in_bounds(nr, nc):
                    t = self.board[nr][nc]
                    if t is None:
                        moves.append((nr, nc))
                    else:
                        if t.color != color: attacks.append((nr, nc))
                        break
                    nr, nc = nr + dr, nc + dc
        elif k == "N":
            for dr, dc in [(-2,-1),(-2,1),(-1,-2),(-1,2),(1,-2),(1,2),(2,-1),(2,1)]:
                nr, nc = r + dr, c + dc
                if in_bounds(nr, nc):
                    t = self.board[nr][nc]
                    if t is None: moves.append((nr, nc))
                    elif t.color != color: attacks.append((nr, nc))
        elif k == "P":
            dy = -1 if color == "w" else 1
            start = 6 if color == "w" else 1
            r1 = r + dy
            if in_bounds(r1, c) and self.board[r1][c] is None:
                moves.append((r1, c))
                r2 = r + 2 * dy
                if r == start and in_bounds(r2, c) and self.board[r2][c] is None:
                    moves.append((r2, c))
            for dc in (-1, 1):
                nr, nc = r + dy, c + dc
                if in_bounds(nr, nc):
                    t = self.board[nr][nc]
                    if t and t.color != color: attacks.append((nr, nc))
        elif k == "SH":
            dy = -1 if color == "w" else 1
            for ddy in (dy, -dy):
                nr = r + ddy
                if not in_bounds(nr, c):
                    continue
                t = self.board[nr][c]
                if t is None:
                    moves.append((nr, c))
                elif t.color != color:
                    attacks.append((nr, c))
                    moves.append((nr, c))
        elif k == "SN":
            for dr, dc, max_dist in [(-1,0,4),(1,0,4),(0,-1,4),(0,1,4),(-1,-1,3),(-1,1,3),(1,-1,3),(1,1,3)]:
                for dist in range(1, max_dist + 1):
                    nr, nc = r + dr * dist, c + dc * dist
                    if not in_bounds(nr, nc): break
                    t = self.board[nr][nc]
                    if t:
                        if t.color != color: attacks.append((nr, nc))
                        break
        elif k == "JP":
            for dr, dc in [(-2,0),(2,0),(0,-2),(0,2)]:
                nr, nc = r + dr, c + dc
                if in_bounds(nr, nc):
                    t = self.board[nr][nc]
                    if t is None: moves.append((nr, nc))
                    elif t.color != color: attacks.append((nr, nc))
        return moves, attacks

    def can_attack(self, by_color: str, tr: int, tc: int) -> bool:
        for r in range(8):
            for c in range(8):
                p = self.board[r][c]
                if p and p.color == by_color and (tr, tc) in self.piece_moves(r, c, p)[1]:
                    return True
        return False

    def is_in_check(self, color: str) -> bool:
        king = self.find_king(color)
        return bool(king and self.can_attack(opp(color), *king))

    def five_in_row(self) -> str | None:
        for r in range(8):
            for c in range(8):
                p = self.board[r][c]
                if not p:
                    continue
                for dr, dc in [(0,1),(1,0),(1,1),(1,-1)]:
                    count, nr, nc = 1, r + dr, c + dc
                    while in_bounds(nr, nc) and self.board[nr][nc] and self.board[nr][nc].color == p.color:
                        count += 1
                        nr, nc = nr + dr, nc + dc
                    if count >= 5:
                        return p.color
        return None

    def black_counter_five(self, mover: str) -> bool:
        return mover == "b" and self.five_in_row() == "b"

    def position_key(self) -> str:
        cells = []
        for row in self.board:
            for p in row:
                cells.append("." if p is None else f"{p.color}{p.kind}{p.attacks if p.kind == 'SN' else ''}")
        hand = "/".join("".join(f"{k}{self.hands[col].get(k,0)}" for k in KINDS) for col in COLORS)
        return self.turn + "|" + ",".join(cells) + "|h:" + hand

    def _try_sh_move(self, action: Action) -> str | None:
        assert action.fr is not None and action.fc is not None and action.tr is not None and action.tc is not None
        piece = self.board[action.fr][action.fc]
        assert piece is not None
        dy = -1 if piece.color == "w" else 1
        if action.tr not in (action.fr + dy, action.fr - dy) or action.tc != action.fc:
            return "방패는 앞/뒤 직진만 가능"
        target = self.board[action.tr][action.tc]
        if target and target.color == piece.color:
            return "아군 기물을 밀 수 없음"
        if target is None:
            self.board[action.tr][action.tc], self.board[action.fr][action.fc] = piece, None
        else:
            push_r = action.tr + (action.tr - action.fr)
            if in_bounds(push_r, action.tc) and self.board[push_r][action.tc] is None:
                self.board[push_r][action.tc] = target
            self.board[action.tr][action.tc], self.board[action.fr][action.fc] = piece, None
        return None

    def _raw_apply(self, action: Action) -> str | None:
        if action.color != self.turn:
            return "현재 차례의 색이 아님"
        if action.type == "place":
            if action.kind not in KINDS or action.r is None or action.c is None:
                return "잘못된 배치 액션"
            if self.hands[action.color].get(action.kind, 0) <= 0:
                return "손패 없음"
            if not self.can_place_here(action.color, action.kind, action.r, action.c):
                return "배치 불가 위치"
            self.board[action.r][action.c] = Piece(action.color, action.kind)
            self.hands[action.color][action.kind] -= 1
            if action.kind == "K": self.king_placed[action.color] = True
            self.last_move = action.to_json()
            return None
        if action.type != "move" or None in (action.fr, action.fc, action.tr, action.tc):
            return "잘못된 이동 액션"
        assert action.fr is not None and action.fc is not None and action.tr is not None and action.tc is not None
        p = self.board[action.fr][action.fc]
        if not p or p.color != self.turn:
            return "본인 기물 아님"
        if not self.king_placed["w"] or not self.king_placed["b"]:
            return "양쪽 킹 배치 전 이동 불가"
        if p.kind == "SH":
            err = self._try_sh_move(action)
            if err: return err
        elif p.kind == "SN":
            if (action.tr, action.tc) not in self.piece_moves(action.fr, action.fc, p)[1]:
                return "스나이퍼 공격 불가 위치"
            self.board[action.tr][action.tc] = None
            p.attacks += 1
            if p.attacks >= 3:
                self.board[action.fr][action.fc] = None
                self.hands[p.color]["SN"] += 1
        else:
            moves, attacks = self.piece_moves(action.fr, action.fc, p)
            if (action.tr, action.tc) not in moves + attacks:
                return "이동 불가 위치"
            self.board[action.tr][action.tc], self.board[action.fr][action.fc] = p, None
            if p.kind == "P" and ((p.color == "w" and action.tr == 0) or (p.color == "b" and action.tr == 7)):
                target = action.promote if action.promote in PROMOTIONS else "Q"
                self.board[action.tr][action.tc] = Piece(p.color, target)
        self.last_move = action.to_json()
        return None

    def apply(self, action: Action, check_terminal: bool = True) -> ApplyResult:
        if self.terminal:
            return ApplyResult(False, "이미 종료된 게임")
        before = self.clone()
        mover = self.turn
        err = self._raw_apply(action)
        if err:
            return ApplyResult(False, err)
        if self.king_placed[mover] and self.is_in_check(mover) and not self.black_counter_five(mover):
            self.__dict__.update(before.__dict__)
            return ApplyResult(False, "자기 킹이 체크됨")
        nxt = opp(mover)
        opponent_checked = self.king_placed[nxt] and self.is_in_check(nxt)
        if opponent_checked:
            self.total_checks[mover] += 1
            self.check_streak[nxt] += 1
            if self.total_checks[mover] > 5:
                self.__dict__.update(before.__dict__)
                return ApplyResult(False, "5회 체크 한도 초과")
            if self.check_streak[nxt] >= 3:
                self.terminal, self.winner, self.end_reason = True, nxt, "check_suicide"
                return ApplyResult(True, winner=nxt, reason="check_suicide", opponent_in_check=True)
        else:
            self.check_streak[nxt] = 0
        self.turn = nxt
        five = self.five_in_row()
        if five:
            self.terminal, self.winner, self.end_reason = True, five, "five_in_row"
            return ApplyResult(True, winner=five, reason="five_in_row", opponent_in_check=opponent_checked)
        self.history.append(self.position_key())
        if self.history.count(self.position_key()) >= 3:
            self.terminal, self.end_reason = True, "threefold"
            return ApplyResult(True, reason="threefold", draw=True, opponent_in_check=opponent_checked)
        if check_terminal:
            nxt_legal = self.legal_actions(validate_terminal=False)
            if not nxt_legal:
                if opponent_checked:
                    self.terminal, self.winner, self.end_reason = True, mover, "checkmate"
                    return ApplyResult(True, winner=mover, reason="checkmate", opponent_in_check=True)
                self.terminal, self.end_reason = True, "stalemate"
                return ApplyResult(True, reason="stalemate", draw=True)
        return ApplyResult(True, opponent_in_check=opponent_checked)

    def pseudo_actions(self, color: str) -> list[Action]:
        actions: list[Action] = []
        if not self.king_placed[color]:
            if self.hands[color].get("K", 0) > 0:
                for r in range(2, 6):
                    for c in range(2, 6):
                        if self.board[r][c] is None:
                            actions.append(Action("place", color, kind="K", r=r, c=c))
        else:
            for kind, n in self.hands[color].items():
                if n <= 0 or kind == "K": continue
                squares: Iterable[tuple[int, int]]
                squares = [(0,0),(0,7),(7,0),(7,7)] if kind == "SN" else ((r,c) for r in range(2,6) for c in range(1,7))
                for r, c in squares:
                    if self.board[r][c] is None:
                        actions.append(Action("place", color, kind=kind, r=r, c=c))
        for r in range(8):
            for c in range(8):
                p = self.board[r][c]
                if not p or p.color != color: continue
                moves, attacks = self.piece_moves(r, c, p)
                targets = attacks if p.kind == "SN" else moves + attacks
                for tr, tc in targets:
                    if p.kind == "P" and ((color == "w" and tr == 0) or (color == "b" and tr == 7)):
                        for promo in PROMOTIONS:
                            actions.append(Action("move", color, fr=r, fc=c, tr=tr, tc=tc, promote=promo))
                    else:
                        actions.append(Action("move", color, fr=r, fc=c, tr=tr, tc=tc))
        return actions

    def legal_actions(self, validate_terminal: bool = True) -> list[Action]:
        if self.terminal:
            return []
        color = self.turn
        result: list[Action] = []
        for action in self.pseudo_actions(color):
            copied = self.clone()
            applied = copied.apply(action, check_terminal=False)
            # Original JS filters check-suicide out of AI legal generation.
            if applied.ok and applied.reason != "check_suicide":
                result.append(action)
        return result
