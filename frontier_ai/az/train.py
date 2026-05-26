"""AlphaZero training loop: self-play -> replay -> candidate train -> arena.

Run:
  python -m frontier_ai.az.train --iterations 200 --games-per-iter 24 --sims 64 --workers 8 --resume
"""
from __future__ import annotations

import argparse
import os
import pickle
import time

import numpy as np
import torch
import torch.nn.functional as F

from ..game import GameState, parse_hand_str
from .encoding import index_to_action
from .mcts import MCTS, choose
from .net import AZNet, pick_device
from .selfplay import generate_parallel, generate_serial, make_evaluator
from .stats import (
    counts_view,
    format_group_counts,
    format_move_stats,
    format_reason_stats,
    new_result_stats,
    record_result,
)
from .tactics import tactical_action


def _loss(net, planes, pi, z):
    logits, v = net(planes)
    policy_loss = -(pi * F.log_softmax(logits, dim=1)).sum(dim=1).mean()
    value_loss = F.mse_loss(v, z)
    return policy_loss + value_loss, policy_loss, value_loss


def _make_optimizer(net, lr: float):
    return torch.optim.Adam(net.parameters(), lr=lr, weight_decay=1e-4)


def _train_step(net, opt, buffer: list, batch_size: int, device):
    n = min(batch_size, len(buffer))
    idx = np.random.randint(0, len(buffer), size=n)
    planes = torch.from_numpy(np.stack([buffer[i][0] for i in idx])).to(device=device, dtype=torch.float32)
    pi = torch.from_numpy(np.stack([buffer[i][1] for i in idx])).to(device=device, dtype=torch.float32)
    z = torch.tensor([buffer[i][2] for i in idx], dtype=torch.float32, device=device)
    net.train()
    loss, pl, vl = _loss(net, planes, pi, z)
    opt.zero_grad()
    loss.backward()
    opt.step()
    return loss.item(), pl.item(), vl.item()


def _save(path: str, net, cfg: dict, meta: dict) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    torch.save({"cfg": cfg, "state_dict": net.state_dict(), "meta": meta}, tmp)
    os.replace(tmp, path)


def _save_many(paths: list[str], net, cfg: dict, meta: dict) -> None:
    seen = set()
    for path in paths:
        if path and path not in seen:
            _save(path, net, cfg, meta)
            seen.add(path)


def _load_if_compatible(path: str, net, cfg: dict, device, label: str) -> int:
    if not os.path.exists(path):
        return 0
    ckpt = torch.load(path, map_location=device)
    if ckpt.get("cfg") != cfg:
        print(f"warning: {label} structure mismatch; ignoring {path}")
        return 0
    net.load_state_dict(ckpt["state_dict"])
    iterations = int(ckpt.get("meta", {}).get("iterations", 0))
    print(f"resumed {label} from {path} (iterations={iterations})")
    return iterations


def _copy_weights(dst, src) -> None:
    dst.load_state_dict(src.state_dict())


def _load_replay(path: str, maxlen: int) -> list:
    if not path or not os.path.exists(path):
        return []
    with open(path, "rb") as f:
        data = list(pickle.load(f))
    if len(data) > maxlen:
        data = data[-maxlen:]
    print(f"loaded replay: {path} (samples={len(data)})")
    return data


def _save_replay(path: str, buffer: list) -> None:
    if not path:
        return
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        pickle.dump(list(buffer), f, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(tmp, path)


def _trim_replay(buffer: list, maxlen: int) -> None:
    overflow = len(buffer) - maxlen
    if overflow > 0:
        del buffer[:overflow]


def _arena_game(candidate, best, device, hand: dict[str, int], n_sims: int,
                max_moves: int, candidate_white: bool, seed: int,
                temp_moves: int, noise_frac: float) -> dict:
    rng = np.random.default_rng(seed)
    if noise_frac > 0:
        np.random.seed(seed % (2 ** 32))
    evaluators = {
        "candidate": make_evaluator(candidate, device),
        "best": make_evaluator(best, device),
    }
    state = GameState.initial(hand)
    moves = 0
    while not state.terminal and moves < max_moves:
        forced, _ = tactical_action(state)
        if forced is not None:
            state.apply(forced)
            moves += 1
            continue
        candidate_to_move = (state.turn == "w") == candidate_white
        evaluator = evaluators["candidate" if candidate_to_move else "best"]
        root = MCTS(evaluator, dirichlet_frac=noise_frac).run(state.clone(), n_sims, add_noise=noise_frac > 0)
        if not root.N:
            break
        temperature = 1.0 if moves < temp_moves else 1e-9
        action = index_to_action(choose(root, temperature=temperature, rng=rng), state.turn)
        state.apply(action)
        moves += 1
    reason = state.end_reason if state.terminal else "max_moves"
    if state.winner not in ("w", "b"):
        return {"winner": None, "reason": reason, "moves": moves}
    winner = "candidate" if (state.winner == "w") == candidate_white else "best"
    return {"winner": winner, "reason": reason, "moves": moves}


def _arena(candidate, best, device, hand: dict[str, int], games: int,
           n_sims: int, max_moves: int, seed_start: int,
           temp_moves: int, noise_frac: float) -> dict[str, int]:
    candidate.eval()
    best.eval()
    result = new_result_stats(("candidate", "best"))
    result["by_side"] = {
        "candidate_white": new_result_stats(("candidate", "best")),
        "candidate_black": new_result_stats(("candidate", "best")),
    }
    for i in range(games):
        candidate_white = i % 2 == 0
        outcome = _arena_game(candidate, best, device, hand, n_sims, max_moves,
                              candidate_white=candidate_white,
                              seed=(int(seed_start) + i) % (2 ** 32),
                              temp_moves=temp_moves,
                              noise_frac=noise_frac)
        record_result(result, outcome["winner"], outcome["reason"], outcome["moves"])
        side_key = "candidate_white" if candidate_white else "candidate_black"
        record_result(result["by_side"][side_key], outcome["winner"], outcome["reason"], outcome["moves"])
    return result


def main() -> None:
    p = argparse.ArgumentParser(description="AlphaZero self-play trainer for FRONTIER")
    p.add_argument("--channels", type=int, default=64)
    p.add_argument("--blocks", type=int, default=6)
    p.add_argument("--iterations", type=int, default=200)
    p.add_argument("--games-per-iter", type=int, default=24)
    p.add_argument("--sims", type=int, default=64)
    p.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    p.add_argument("--batch-size", type=int, default=256)
    p.add_argument("--train-steps", type=int, default=200)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--hand", default="K1Q1R2B2N2P8SH0SN0JP0")
    p.add_argument("--max-moves", type=int, default=200)
    p.add_argument("--temp-moves", type=int, default=16)
    p.add_argument("--buffer", type=int, default=50000)
    p.add_argument("--out", default="models/az-model.pt")
    p.add_argument("--candidate-out", default="models/az-candidate.pt")
    p.add_argument("--best-out", default="")
    p.add_argument("--replay-path", default="models/az-replay.pkl")
    p.add_argument("--replay-save-every", type=int, default=5)
    p.add_argument("--arena-every", type=int, default=10)
    p.add_argument("--arena-games", type=int, default=24)
    p.add_argument("--arena-sims", type=int, default=32)
    p.add_argument("--arena-threshold", type=float, default=0.55)
    p.add_argument("--arena-temp-moves", type=int, default=4)
    p.add_argument("--arena-noise-frac", type=float, default=0.15)
    p.add_argument("--resume", action="store_true")
    args = p.parse_args()
    best_out = args.best_out or args.out

    device = pick_device()
    cfg = {"channels": args.channels, "blocks": args.blocks}
    net = AZNet(**cfg).to(device)
    best_net = AZNet(**cfg).to(device)
    opt = _make_optimizer(net, args.lr)
    base_iter = 0
    buffer: list = []
    hand = parse_hand_str(args.hand)
    arena_enabled = args.arena_every > 0 and args.arena_games > 0

    if args.resume:
        if arena_enabled:
            best_iter = _load_if_compatible(best_out, best_net, cfg, device, "best")
            if os.path.exists(args.candidate_out):
                candidate_iter = _load_if_compatible(args.candidate_out, net, cfg, device, "candidate")
            else:
                _copy_weights(net, best_net)
                candidate_iter = best_iter
            if not best_iter and candidate_iter:
                _copy_weights(best_net, net)
            base_iter = max(best_iter, candidate_iter)
        else:
            base_iter = _load_if_compatible(args.out, net, cfg, device, "latest")
            _copy_weights(best_net, net)
        buffer = _load_replay(args.replay_path, args.buffer)
    else:
        _copy_weights(best_net, net)
    if arena_enabled and not os.path.exists(best_out):
        _save_many([best_out, args.out], best_net, cfg, {
            "iterations": base_iter, "hand": args.hand,
            "channels": args.channels, "blocks": args.blocks,
            "accepted": True,
        })

    print(f"device={device} | net=ch{args.channels}x{args.blocks}b | workers={args.workers}")
    if arena_enabled:
        print(f"arena=on every={args.arena_every} games={args.arena_games} "
              f"sims={args.arena_sims} threshold={args.arena_threshold:.3f} "
              f"temp_moves={args.arena_temp_moves} noise={args.arena_noise_frac:.2f}")
        print(f"best={best_out} | candidate={args.candidate_out}")
    print(f"replay={args.replay_path or 'off'} | replay_samples={len(buffer)} | max={args.buffer}")

    sp_kw = dict(n_sims=args.sims, max_moves=args.max_moves, temp_moves=args.temp_moves)
    last_iter = base_iter
    try:
        for it in range(1, args.iterations + 1):
            t0 = time.time()
            selfplay_net = best_net if arena_enabled else net
            selfplay_seed = (base_iter + it) * 1_000_003
            if args.workers > 1:
                data, res = generate_parallel(selfplay_net, cfg, args.games_per_iter, args.workers,
                                              hand_str=args.hand, seed_start=selfplay_seed, **sp_kw)
            else:
                data, res = generate_serial(selfplay_net, device, args.games_per_iter,
                                            hand_str=args.hand, seed_start=selfplay_seed, **sp_kw)
            buffer.extend(data)
            _trim_replay(buffer, args.buffer)
            t_sp = time.time() - t0

            losses = []
            if len(buffer) >= 64:
                for _ in range(args.train_steps):
                    losses.append(_train_step(net, opt, buffer, args.batch_size, device))
            t_tr = time.time() - t0 - t_sp
            last_iter = base_iter + it
            meta = {"iterations": last_iter, "hand": args.hand,
                    "channels": args.channels, "blocks": args.blocks}

            if losses:
                L = np.mean(losses, axis=0)
                print(f"iter={last_iter} | games={counts_view(res, ('w', 'b', 'draw'))} | "
                      f"ends={format_reason_stats(res, ('w', 'b', 'draw'))} | "
                      f"moves={format_move_stats(res, ('w', 'b', 'draw'))} | "
                      f"buffer={len(buffer)} | "
                      f"loss={L[0]:.4f}(p={L[1]:.4f},v={L[2]:.4f}) | "
                      f"selfplay={t_sp:.1f}s train={t_tr:.1f}s")
            else:
                print(f"iter={last_iter} | games={counts_view(res, ('w', 'b', 'draw'))} | "
                      f"ends={format_reason_stats(res, ('w', 'b', 'draw'))} | "
                      f"moves={format_move_stats(res, ('w', 'b', 'draw'))} | "
                      f"buffer={len(buffer)} | (warmup)")

            checkpoint_path = args.candidate_out if arena_enabled else args.out
            _save(checkpoint_path, net, cfg, meta)

            if args.replay_save_every > 0 and it % args.replay_save_every == 0:
                ts = time.time()
                _save_replay(args.replay_path, buffer)
                print(f"replay saved: {args.replay_path} (samples={len(buffer)}, {time.time()-ts:.1f}s)")

            if arena_enabled and it % args.arena_every == 0:
                ts = time.time()
                arena_seed = (last_iter * 9_176 + args.arena_games * 131) % (2 ** 32)
                arena = _arena(net, best_net, device, hand, args.arena_games, args.arena_sims,
                               args.max_moves, arena_seed, max(0, args.arena_temp_moves),
                               min(1.0, max(0.0, args.arena_noise_frac)))
                score = (arena["candidate"] + 0.5 * arena["draw"]) / max(1, args.arena_games)
                accepted = score >= args.arena_threshold
                print(f"arena iter={last_iter} | {counts_view(arena, ('candidate', 'best', 'draw'))} | "
                      f"sides={format_group_counts(arena.get('by_side', {}), (('candidate_white', 'candW'), ('candidate_black', 'candB')), ('candidate', 'best', 'draw'))} | "
                      f"ends={format_reason_stats(arena, ('candidate', 'best', 'draw'))} | "
                      f"moves={format_move_stats(arena, ('candidate', 'best', 'draw'))} | "
                      f"score={score:.3f} "
                      f"threshold={args.arena_threshold:.3f} | "
                      f"{'accepted' if accepted else 'rejected'} | time={time.time()-ts:.1f}s")
                if accepted:
                    _copy_weights(best_net, net)
                    _save_many([best_out, args.out], best_net, cfg, {**meta, "accepted": True,
                                                                     "arena": arena, "score": score})
                else:
                    _copy_weights(net, best_net)
                    opt = _make_optimizer(net, args.lr)
                    _save(args.candidate_out, net, cfg, {**meta, "reverted_to_best": True,
                                                         "arena": arena, "score": score})
    except KeyboardInterrupt:
        checkpoint_path = args.candidate_out if arena_enabled else args.out
        _save(checkpoint_path, net, cfg, {"iterations": last_iter, "hand": args.hand,
                                          "channels": args.channels, "blocks": args.blocks})
        _save_replay(args.replay_path, buffer)
        print(f"\nInterrupted. Saved checkpoint: {checkpoint_path}")
        if arena_enabled:
            print(f"best checkpoint remains: {best_out}")
        print(f"replay saved: {args.replay_path} (samples={len(buffer)})")
        print("Run train-az.bat again to resume.")
        return

    _save_replay(args.replay_path, buffer)
    if arena_enabled:
        print(f"saved candidate: {args.candidate_out}")
        print(f"best checkpoint: {best_out}")
    else:
        print(f"saved: {args.out}")


if __name__ == "__main__":
    main()
