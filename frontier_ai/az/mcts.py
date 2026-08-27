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
    __slots__ = ("state", "to_move", "is_terminal", "expanded", "children", "P", "N", "W", "legal")

    def __init__(self, state: GameState):
        self.state = state
        self.to_move = state.turn
        self.is_terminal = state.terminal
        self.expanded = False
        self.children: dict[int, "Node"] = {}
        self.P: dict[int, float] = {}
        self.N: dict[int, int] = {}
        self.W: dict[int, float] = {}
        self.legal = None          # apply()가 넘겨준 합법수 (있으면 재계산 생략)


class MCTS:
    def __init__(self, evaluate, c_puct: float = C_PUCT,
                 dirichlet_alpha: float = 0.3, dirichlet_frac: float = 0.25,
                 evaluate_batch=None, batch_size: int = 16, virtual_loss: int = 1):
        # evaluate(state) -> (policy_logits np[POLICY_SIZE], value float) from state.turn's perspective
        # evaluate_batch(states) -> [(logits, value), ...] — 있으면 리프를 모아 한 번에 평가한다.
        #   배치 1 추론은 GPU에서 커널 실행 오버헤드가 지배한다(3060 실측: 64회를
        #   하나씩 389ms vs 16개씩 21ms). 자가대국 시간의 60%가 여기였다.
        self.evaluate = evaluate
        self.evaluate_batch = evaluate_batch
        self.batch_size = max(1, batch_size)
        self.virtual_loss = max(0, virtual_loss)
        self.c_puct = c_puct
        self.alpha = dirichlet_alpha
        self.frac = dirichlet_frac

    def _expand(self, node: Node) -> float:
        logits, value = self.evaluate(node.state)
        return self._expand_with(node, logits, value)

    def _expand_with(self, node: Node, logits, value) -> float:
        """평가 결과를 받아 노드를 펼친다. 같은 배치에 같은 노드가 두 번 들어와도
        안전하도록 이미 펼쳐진 노드는 값만 돌려준다."""
        if node.expanded:
            return float(value)
        # 자식 노드는 apply()가 이미 계산한 합법수를 들고 온다 (중복 계산 제거)
        idxs, _ = legal_action_indices(node.state, node.legal)
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

    def _descend(self, root: Node):
        """리프까지 내려간다. 내려가며 가상 손실을 걸어 같은 배치의 다음 탐색이
        같은 경로를 그대로 따라오지 않게 한다. (leaf, path, immediate_value) 반환."""
        node = root
        path: list[tuple[Node, int]] = []
        vl = self.virtual_loss
        while True:
            if node.is_terminal:
                return None, path, terminal_value(node.state)
            if not node.expanded:
                return node, path, None
            idx = self._select(node)
            path.append((node, idx))
            if vl:
                node.N[idx] += vl
                node.W[idx] -= vl
            if idx not in node.children:
                cs = node.state.clone()
                res = cs.apply(index_to_action(idx, node.state.turn))
                child = Node(cs)
                child.legal = res.legal_after      # 없으면 _expand가 직접 구한다
                node.children[idx] = child
            node = node.children[idx]

    def _backup(self, path, value) -> None:
        vl = self.virtual_loss
        for parent, idx in reversed(path):
            if vl:                       # 가상 손실 해제
                parent.N[idx] -= vl
                parent.W[idx] += vl
            value = -value               # negamax: 한 단계 올라갈 때마다 부호 반전
            parent.N[idx] += 1
            parent.W[idx] += value

    def run(self, root_state: GameState, n_sims: int, add_noise: bool = True) -> Node:
        root = Node(root_state.clone())
        self._expand(root)
        if add_noise:
            self._add_root_noise(root)

        total = max(1, n_sims)
        # 배치 평가기가 없으면 예전처럼 한 번에 하나씩 (동작 동일)
        step = self.batch_size if self.evaluate_batch is not None else 1
        done = 0
        while done < total:
            k = min(step, total - done)
            pending, results = [], []
            for _ in range(k):
                leaf, path, immediate = self._descend(root)
                if leaf is None:
                    results.append((path, immediate))
                else:
                    pending.append((leaf, path))
            if pending:
                if self.evaluate_batch is not None and len(pending) > 1:
                    outs = self.evaluate_batch([n.state for n, _ in pending])
                else:
                    outs = [self.evaluate(n.state) for n, _ in pending]
                for (leaf, path), (logits, value) in zip(pending, outs):
                    results.append((path, self._expand_with(leaf, logits, value)))
            for path, value in results:
                self._backup(path, value)
            done += k
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
