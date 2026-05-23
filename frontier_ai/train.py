from __future__ import annotations
import argparse, json, random
from pathlib import Path
from .features import FEATURE_DIM, encode
from .game import GameState, parse_hand_str, opp


def main() -> None:
    parser = argparse.ArgumentParser(description="Train FRONTIER afterstate value model by self-play.")
    parser.add_argument("--episodes", type=int, default=1000)
    parser.add_argument("--max-turns", type=int, default=220)
    parser.add_argument("--epsilon-start", type=float, default=0.35)
    parser.add_argument("--epsilon-end", type=float, default=0.05)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--epochs-per-block", type=int, default=3)
    parser.add_argument("--hand", default="K1Q1R2B2N2P8SH0SN0JP0")
    parser.add_argument("--out", default="models/frontier-model.json")
    parser.add_argument("--seed", type=int, default=67194)
    args = parser.parse_args()
    try:
        import torch
        from torch import nn
    except ImportError as exc:
        raise SystemExit("PyTorch가 필요합니다: pip install -e '.[train]'") from exc
    random.seed(args.seed); torch.manual_seed(args.seed)
    class Net(nn.Module):
        def __init__(self):
            super().__init__()
            self.net = nn.Sequential(nn.Linear(FEATURE_DIM, 32), nn.ReLU(), nn.Linear(32, 32), nn.ReLU(), nn.Linear(32, 1), nn.Tanh())
        def forward(self, x): return self.net(x)
    net = Net(); opt = torch.optim.Adam(net.parameters(), lr=0.002); loss_fn = nn.MSELoss()
    replay: list[tuple[list[float], float]] = []
    stats = {"w": 0, "b": 0, "draw": 0}
    hand = parse_hand_str(args.hand)
    def value(features):
        with torch.no_grad(): return float(net(torch.tensor([features], dtype=torch.float32))[0,0])
    for ep in range(1, args.episodes + 1):
        eps = args.epsilon_start + (args.epsilon_end - args.epsilon_start) * (ep - 1) / max(1, args.episodes - 1)
        state = GameState.initial(hand); trajectory: list[tuple[list[float], str]] = []
        for _ in range(args.max_turns):
            legal = state.legal_actions()
            if not legal: break
            actor = state.turn
            candidates = []
            for a in legal:
                nxt = state.clone(); res = nxt.apply(a)
                if res.ok and res.winner == actor:
                    candidates = [(999, a, nxt)]; break
                candidates.append((value(encode(nxt, actor)), a, nxt))
            if random.random() < eps and candidates[0][0] != 999:
                _, action, nxt = random.choice(candidates)
            else:
                _, action, nxt = max(candidates, key=lambda z: z[0])
            trajectory.append((encode(nxt, actor), actor)); state = nxt
            if state.terminal: break
        if state.winner in ("w", "b"): stats[state.winner] += 1
        else: stats["draw"] += 1
        for features, actor in trajectory:
            target = 0.0 if state.winner is None else (1.0 if actor == state.winner else -1.0)
            replay.append((features, target))
        if len(replay) > 60000: replay = replay[-60000:]
        if ep % 20 == 0 and replay:
            for _ in range(args.epochs_per_block):
                batch = random.sample(replay, min(args.batch_size, len(replay)))
                xb = torch.tensor([x for x, _ in batch], dtype=torch.float32)
                yb = torch.tensor([[y] for _, y in batch], dtype=torch.float32)
                opt.zero_grad(); loss = loss_fn(net(xb), yb); loss.backward(); opt.step()
            print(f"episode={ep}/{args.episodes} epsilon={eps:.3f} replay={len(replay)} W={stats['w']} B={stats['b']} D={stats['draw']} loss={float(loss):.5f}")
    layers = []
    for module in net.net:
        if hasattr(module, "weight"):
            layers.append({"weight": module.weight.detach().tolist(), "bias": module.bias.detach().tolist()})
    data = {"name": "frontier-selfplay-value", "version": 1,
            "metadata": {"algorithm": "monte-carlo-afterstate-value", "trained_episodes": args.episodes, "hand": args.hand, "seed": args.seed, "stats": stats},
            "layers": layers}
    out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"saved: {out}")

if __name__ == "__main__":
    main()
