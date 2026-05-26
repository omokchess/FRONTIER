"""PUCT Monte-Carlo Tree Search guided by a policy+value network (AlphaZero-style)."""
from __future__ import annotations
import math
import numpy as np
from ..game import GameState
from .encoding import legal_action_indices, index_to_action, POLICY_SIZE

C_PUCT = 1.5


def terminal_value(state: GameState) -> float:
    """Outcome from the perspective of the side to move at `state` (terminal)."""
    if state.winner is None:
        return 0.0
    return 1.0 if state.winner == state.turn else -1.0


class Node:
    __slots__ = ("state", "to_move", "is_terminal", "expanded", "children", "P", "N", "W")

    def __init__(self, state: GameState):
        self.state = state
        self.to_move = state.turn
        self.is_terminal = state.terminal
        self.expanded = False
        self.children: dict[int, "Node"] = {}
        self.P: dict[int, float] = {}
        self.N: dict[int, int] = {}
        self.W: dict[int, float] = {}


class MCTS:
    def __init__(self, evaluate, c_puct: float = C_PUCT,
                 dirichlet_alpha: float = 0.3, dirichlet_frac: float = 0.25):
        # evaluate(state) -> (policy_logits np[POLICY_SIZE], value float) from state.turn's perspective
        self.evaluate = evaluate
        self.c_puct = c_puct
        self.alpha = dirichlet_alpha
        self.frac = dirichlet_frac

    def _expand(self, node: Node) -> float:
        logits, value = self.evaluate(node.state)
        idxs, _ = legal_action_indices(node.state)
        node.expanded = True
        if not idxs:
            return terminal_value(node.state)
        leg = np.array([logits[i] for i in idxs], dtype=np.float64)
        leg -= leg.max()
        pri = np.exp(leg)
        pri /= pri.sum()
        for i, p in zip(idxs, pri):
            node.P[i] = float(p)
            node.N[i] = 0
            node.W[i] = 0.0
        return float(value)

    def _add_root_noise(self, node: Node) -> None:
        idxs = list(node.P.keys())
        if len(idxs) < 2:
            return
        noise = np.random.dirichlet([self.alpha] * len(idxs))
        for i, nz in zip(idxs, noise):
            node.P[i] = (1 - self.frac) * node.P[i] + self.frac * float(nz)

    def _select(self, node: Node) -> int:
        total = sum(node.N.values())
        sq = math.sqrt(total + 1)
        best, best_score = -1, -1e30
        for i in node.P:
            q = node.W[i] / node.N[i] if node.N[i] > 0 else 0.0
            u = self.c_puct * node.P[i] * sq / (1 + node.N[i])
            score = q + u
            if score > best_score:
                best_score, best = score, i
        return best

    def run(self, root_state: GameState, n_sims: int, add_noise: bool = True) -> Node:
        root = Node(root_state.clone())
        self._expand(root)
        if add_noise:
            self._add_root_noise(root)
        for _ in range(max(1, n_sims)):
            node = root
            path: list[tuple[Node, int]] = []
            while True:
                if node.is_terminal:
                    value = terminal_value(node.state)
                    break
                if not node.expanded:
                    value = self._expand(node)
                    break
                idx = self._select(node)
                path.append((node, idx))
                if idx not in node.children:
                    cs = node.state.clone()
                    cs.apply(index_to_action(idx, node.state.turn))
                    node.children[idx] = Node(cs)
                node = node.children[idx]
            # negamax backup: flip sign at each level up
            for parent, idx in reversed(path):
                value = -value
                parent.N[idx] += 1
                parent.W[idx] += value
        return root


def _filtered_indices(root: Node, allowed: set[int] | None = None) -> list[int]:
    idxs = list(root.N.keys())
    if allowed is None:
        return idxs
    filtered = [i for i in idxs if i in allowed]
    return filtered or idxs


def non_threefold_indices(root: Node) -> tuple[set[int] | None, int]:
    """Return root actions that do not immediately end in a threefold draw."""
    safe: set[int] = set()
    avoided = 0
    for idx in root.N:
        state = root.state.clone()
        result = state.apply(index_to_action(idx, root.state.turn), check_terminal=False)
        is_threefold_draw = result.ok and state.terminal and state.winner is None and state.end_reason == "threefold"
        if is_threefold_draw:
            avoided += 1
        else:
            safe.add(idx)
    if not safe or not avoided:
        return None, 0
    return safe, avoided


def visit_policy(root: Node, temperature: float = 1.0, allowed: set[int] | None = None) -> np.ndarray:
    """Training target: visit-count distribution over the full policy space."""
    pi = np.zeros(POLICY_SIZE, dtype=np.float32)
    if not root.N:
        return pi
    idxs = _filtered_indices(root, allowed)
    counts = np.array([root.N[i] for i in idxs], dtype=np.float64)
    if counts.sum() == 0:
        counts = counts + 1.0
    if temperature <= 1e-6:
        probs = (counts == counts.max()).astype(np.float64)
        probs /= probs.sum()
    else:
        c = counts ** (1.0 / temperature)
        probs = c / c.sum()
    for i, p in zip(idxs, probs):
        pi[int(i)] = float(p)
    return pi


def choose(root: Node, temperature: float = 1.0, rng=None, allowed: set[int] | None = None) -> int:
    """Pick an action index from root visit counts (sample if temperature>0, else argmax)."""
    idxs = _filtered_indices(root, allowed)
    counts = np.array([root.N[i] for i in idxs], dtype=np.float64)
    if temperature <= 1e-6:
        return int(idxs[int(counts.argmax())])
    c = counts ** (1.0 / temperature)
    probs = c / c.sum()
    j = (rng or np.random).choice(len(idxs), p=probs)
    return int(idxs[int(j)])
