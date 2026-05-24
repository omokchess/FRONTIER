"""Self-play data generation (MCTS), serial + CPU-parallel."""
from __future__ import annotations
import os
import signal
import tempfile
import numpy as np
import torch
from ..game import GameState, parse_hand_str
from .encoding import encode_planes, index_to_action
from .net import AZNet, infer_batch
from .mcts import MCTS, visit_policy, choose


def make_evaluator(net: AZNet, device):
    def ev(state):
        planes = encode_planes(state, state.turn)[None]      # [1,42,8,8]
        logits, value = infer_batch(net, planes, device)
        return logits[0], float(value[0])
    return ev


def play_game(net, device, hand, n_sims=64, max_moves=200, temp_moves=12, c_puct=1.5, seed=None):
    if seed is not None:
        np.random.seed(seed)
    mcts = MCTS(make_evaluator(net, device), c_puct=c_puct)
    state = GameState.initial(hand)
    samples = []                       # (planes, pi_target, mover)
    moves = 0
    while not state.terminal and moves < max_moves:
        root = mcts.run(state, n_sims, add_noise=True)
        pi = visit_policy(root, temperature=1.0)             # target = visit-count distribution
        samples.append((encode_planes(state, state.turn), pi, state.turn))
        temp = 1.0 if moves < temp_moves else 1e-9           # explore early, greedy late
        state.apply(index_to_action(choose(root, temperature=temp), state.turn))
        moves += 1
    if state.winner == "w":
        z = {"w": 1.0, "b": -1.0}
    elif state.winner == "b":
        z = {"w": -1.0, "b": 1.0}
    else:
        z = {"w": 0.0, "b": 0.0}
    return [(pl, pi, z[mv]) for (pl, pi, mv) in samples], state.winner, moves


def generate_serial(net, device, n_games, hand_str="K1Q1R2B2N2P8SH0SN0JP0", **kw):
    hand = parse_hand_str(hand_str)
    data, results = [], {"w": 0, "b": 0, "draw": 0}
    for _ in range(n_games):
        samples, winner, _ = play_game(net, device, hand, **kw)
        data.extend(samples)
        results[winner if winner in ("w", "b") else "draw"] += 1
    return data, results


# ---------- CPU-parallel (call from a __main__ entry; uses spawn) ----------
_W: dict = {}


def _init_worker(net_cfg, sd_path, hand_str, kw):
    signal.signal(signal.SIGINT, signal.SIG_IGN)   # workers ignore Ctrl+C; the main process handles it
    torch.set_num_threads(1)
    net = AZNet(**net_cfg)
    net.load_state_dict(torch.load(sd_path, map_location="cpu"))
    net.eval()
    _W.update(net=net, device=torch.device("cpu"), hand=parse_hand_str(hand_str), kw=kw)


def _play_worker(seed):
    samples, winner, _ = play_game(_W["net"], _W["device"], _W["hand"], seed=seed, **_W["kw"])
    return samples, winner


def generate_parallel(net, net_cfg, n_games, n_workers, hand_str="K1Q1R2B2N2P8SH0SN0JP0", **kw):
    import multiprocessing as mp
    sd_path = os.path.join(tempfile.gettempdir(), "frontier_az_selfplay_net.pt")
    torch.save(net.state_dict(), sd_path)
    data, results = [], {"w": 0, "b": 0, "draw": 0}
    ctx = mp.get_context("spawn")
    with ctx.Pool(n_workers, initializer=_init_worker, initargs=(net_cfg, sd_path, hand_str, kw)) as pool:
        for samples, winner in pool.imap_unordered(_play_worker, range(n_games)):
            data.extend(samples)
            results[winner if winner in ("w", "b") else "draw"] += 1
    return data, results
