"""AlphaZero training loop: iterate self-play (MCTS) <-> network training.

Run:
  python -m frontier_ai.az.train --iterations 200 --games-per-iter 24 --sims 64 --workers 8 --resume
"""
from __future__ import annotations
import argparse
import collections
import os
import time
import numpy as np
import torch
import torch.nn.functional as F
from .net import AZNet, pick_device
from .selfplay import generate_serial, generate_parallel


def _loss(net, planes, pi, z):
    logits, v = net(planes)
    policy_loss = -(pi * F.log_softmax(logits, dim=1)).sum(dim=1).mean()
    value_loss = F.mse_loss(v, z)
    return policy_loss + value_loss, policy_loss, value_loss


def _train_step(net, opt, buffer, batch_size, device):
    n = min(batch_size, len(buffer))
    idx = np.random.randint(0, len(buffer), size=n)
    planes = torch.from_numpy(np.stack([buffer[i][0] for i in idx])).to(device)
    pi = torch.from_numpy(np.stack([buffer[i][1] for i in idx])).to(device)
    z = torch.tensor([buffer[i][2] for i in idx], dtype=torch.float32, device=device)
    net.train()
    loss, pl, vl = _loss(net, planes, pi, z)
    opt.zero_grad(); loss.backward(); opt.step()
    return loss.item(), pl.item(), vl.item()


def _save(path, net, cfg, meta):
    tmp = path + ".tmp"
    torch.save({"cfg": cfg, "state_dict": net.state_dict(), "meta": meta}, tmp)
    os.replace(tmp, path)


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
    p.add_argument("--resume", action="store_true")
    args = p.parse_args()

    device = pick_device()
    cfg = {"channels": args.channels, "blocks": args.blocks}
    net = AZNet(**cfg).to(device)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr, weight_decay=1e-4)
    base_iter = 0
    buffer: collections.deque = collections.deque(maxlen=args.buffer)

    if args.resume and os.path.exists(args.out):
        ckpt = torch.load(args.out, map_location=device)
        if ckpt.get("cfg") == cfg:
            net.load_state_dict(ckpt["state_dict"])
            base_iter = int(ckpt.get("meta", {}).get("iterations", 0))
            print(f"resumed from {args.out} (iterations={base_iter})")
        else:
            print(f"경고: {args.out} 구조 불일치 — 처음부터 학습")

    print(f"device={device} | net=ch{args.channels}x{args.blocks}b | workers={args.workers}")
    sp_kw = dict(n_sims=args.sims, max_moves=args.max_moves, temp_moves=args.temp_moves)
    try:
        for it in range(1, args.iterations + 1):
            t0 = time.time()
            if args.workers > 1:
                data, res = generate_parallel(net, cfg, args.games_per_iter, args.workers,
                                              hand_str=args.hand, **sp_kw)
            else:
                data, res = generate_serial(net, device, args.games_per_iter,
                                            hand_str=args.hand, **sp_kw)
            buffer.extend(data)
            t_sp = time.time() - t0
            losses = []
            if len(buffer) >= 64:
                for _ in range(args.train_steps):
                    losses.append(_train_step(net, opt, buffer, args.batch_size, device))
            t_tr = time.time() - t0 - t_sp
            it_total = base_iter + it
            if losses:
                L = np.mean(losses, axis=0)
                print(f"iter={it_total} | games={res} | buffer={len(buffer)} | "
                      f"loss={L[0]:.4f}(p={L[1]:.4f},v={L[2]:.4f}) | selfplay={t_sp:.1f}s train={t_tr:.1f}s")
            else:
                print(f"iter={it_total} | games={res} | buffer={len(buffer)} | (warmup)")
            _save(args.out, net, cfg, {"iterations": it_total, "hand": args.hand,
                                       "channels": args.channels, "blocks": args.blocks})
    except KeyboardInterrupt:
        print(f"\n[중단됨] 마지막으로 저장된 체크포인트(iter={base_iter}+ 완료분, {args.out})는 안전합니다.")
        print("다시 train-az.bat 을 실행하면 그 지점부터 이어서 학습합니다.")
        return
    print(f"saved: {args.out}")


if __name__ == "__main__":
    main()
