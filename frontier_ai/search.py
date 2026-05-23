from __future__ import annotations
import math, random
from dataclasses import dataclass, field
from .features import encode
from .game import Action, GameState, opp
from .model import ValueModel

@dataclass
class Node:
    state: GameState
    root_color: str
    parent: "Node | None" = None
    action: Action | None = None
    children: list["Node"] = field(default_factory=list)
    untried: list[Action] = field(default_factory=list)
    visits: int = 0
    value_sum: float = 0.0

    def __post_init__(self):
        if not self.untried and not self.state.terminal:
            self.untried = self.state.legal_actions()

    @property
    def mean_value(self) -> float:
        return self.value_sum / self.visits if self.visits else 0.0


def terminal_value(state: GameState, perspective: str) -> float:
    if not state.terminal:
        raise ValueError("terminal state required")
    if state.winner is None:
        return 0.0
    return 1.0 if state.winner == perspective else -1.0


def choose_action(state: GameState, model: ValueModel, simulations: int = 32, seed: int | None = None) -> tuple[Action | None, dict]:
    legal = state.legal_actions()
    if not legal:
        return None, {"legal": 0, "simulations": 0}
    root_color = state.turn
    # Rule-safe tactical shortcut: never miss a one-move win.
    for action in legal:
        nxt = state.clone(); result = nxt.apply(action)
        if result.ok and result.winner == root_color:
            return action, {"legal": len(legal), "simulations": 0, "forced": "win"}
    rng = random.Random(seed)
    root = Node(state.clone(), root_color, untried=list(legal))
    exploration = 1.2
    for _ in range(max(1, simulations)):
        node = root
        while not node.state.terminal and not node.untried and node.children:
            sign = 1.0 if node.state.turn == root_color else -1.0
            node = max(node.children, key=lambda ch: sign * ch.mean_value + exploration * math.sqrt(math.log(node.visits + 1) / (ch.visits + 1)))
        if not node.state.terminal and node.untried:
            action = node.untried.pop(rng.randrange(len(node.untried)))
            nxt = node.state.clone(); nxt.apply(action)
            child = Node(nxt, root_color, parent=node, action=action)
            node.children.append(child); node = child
        value = terminal_value(node.state, root_color) if node.state.terminal else model.value(encode(node.state, root_color))
        while node is not None:
            node.visits += 1; node.value_sum += value; node = node.parent
    best = max(root.children, key=lambda n: (n.visits, n.mean_value)) if root.children else None
    if best is None:
        return legal[0], {"legal": len(legal), "simulations": simulations, "fallback": True}
    return best.action, {"legal": len(legal), "simulations": simulations, "visits": best.visits, "value": round(best.mean_value, 5)}
