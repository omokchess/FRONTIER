"""Serve moves from a trained AZ model via onnxruntime + PUCT-MCTS (no torch needed)."""
from __future__ import annotations
from dataclasses import replace
import numpy as np
import onnxruntime as ort
from ..game import GameState
from .encoding import encode_planes, index_to_action
from .mcts import MCTS, choose
from .tactics import tactical_action


class AZPlayer:
    def __init__(self, onnx_path: str):
        self.sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        self.input_name = self.sess.get_inputs()[0].name

    def _evaluate(self, state: GameState):
        planes = encode_planes(state, state.turn)[None]                    # [1,42,8,8]
        policy, value = self.sess.run(None, {self.input_name: planes})
        return policy[0], float(np.reshape(value, -1)[0])

    def choose_action(self, state: GameState, simulations: int = 64, c_puct: float = 1.5):
        forced, reason = tactical_action(state)
        if forced is not None:
            return forced, {"simulations": 0, "forced": reason, "engine": "alphazero"}
        mcts = MCTS(self._evaluate, c_puct=c_puct)
        root = mcts.run(state.clone(), simulations, add_noise=False)
        if not root.N:
            return None, {"legal": 0, "engine": "alphazero"}
        idx = choose(root, temperature=1e-9)                               # argmax visits for play
        action = index_to_action(idx, state.turn)
        if action.type == "move":
            p = state.board[action.fr][action.fc]
            if p and p.kind == "P" and ((state.turn == "w" and action.tr == 0)
                                        or (state.turn == "b" and action.tr == 7)):
                action = replace(action, promote="Q")
        q = root.W[idx] / root.N[idx] if root.N[idx] > 0 else 0.0
        return action, {"simulations": simulations, "visits": int(root.N[idx]),
                        "value": round(q, 5), "engine": "alphazero"}
