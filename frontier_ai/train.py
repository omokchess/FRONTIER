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
    parser.add_argument("--resume", action="store_true", help="이어서 학습: --out 모델이 있으면 가중치를 불러와 warm-start")
    parser.add_argument("--save-every", type=int, default=0, help=">0이면 N 에피소드마다 체크포인트 저장 (중단해도 진행분 보존)")
    args = parser.parse_args()
    try:
        import torch
        from torch import nn
    except ImportError as exc:
        raise SystemExit("PyTorch가 필요합니다: pip install torch") from exc
    random.seed(args.seed); torch.manual_seed(args.seed)
    class Net(nn.Module):
        def __init__(self):
            super().__init__()
            self.net = nn.Sequential(nn.Linear(FEATURE_DIM, 32), nn.ReLU(), nn.Linear(32, 32), nn.ReLU(), nn.Linear(32, 1), nn.Tanh())
        def forward(self, x): return self.net(x)
    net = Net(); opt = torch.optim.Adam(net.parameters(), lr=0.002); loss_fn = nn.MSELoss()
    stats = {"w": 0, "b": 0, "draw": 0}

    def save_model(episodes_done: int) -> None:
        layers = []
        for module in net.net:
            if hasattr(module, "weight"):
                layers.append({"weight": module.weight.detach().tolist(), "bias": module.bias.detach().tolist()})
        data = {"name": "frontier-selfplay-value", "version": 1,
                "metadata": {"algorithm": "monte-carlo-afterstate-value", "trained_episodes": episodes_done,
                             "hand": args.hand, "seed": args.seed, "stats": dict(stats)},
                "layers": layers}
        out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(out.suffix + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tmp.replace(out)  # 원자적 교체: 저장 중 중단되어도 기존 모델이 깨지지 않음
        print(f"saved: {out} (trained_episodes={episodes_done})")

    # --resume: 기존 모델 가중치를 불러와 이어서 학습 (구조가 같을 때만)
    base_episodes = 0
    if args.resume and Path(args.out).exists():
        prev = json.loads(Path(args.out).read_text(encoding="utf-8"))
        linears = [m for m in net.net if hasattr(m, "weight")]
        prev_layers = prev.get("layers", [])
        if len(prev_layers) == len(linears):
            with torch.no_grad():
                for module, layer in zip(linears, prev_layers):
                    module.weight.copy_(torch.tensor(layer["weight"], dtype=torch.float32))
                    module.bias.copy_(torch.tensor(layer["bias"], dtype=torch.float32))
            base_episodes = int(prev.get("metadata", {}).get("trained_episodes", 0))
            print(f"resumed from {args.out} (trained_episodes={base_episodes})")
        else:
            print(f"경고: {args.out} 구조가 달라 warm-start 생략 — 처음부터 학습합니다.")

    replay: list[tuple[list[float], float]] = []
    hand = parse_hand_str(args.hand)
    def value(features):
        with torch.no_grad(): return float(net(torch.tensor([features], dtype=torch.float32))[0,0])
    ep = 0
    try:
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
                print(f"episode={base_episodes+ep}/{base_episodes+args.episodes} epsilon={eps:.3f} replay={len(replay)} W={stats['w']} B={stats['b']} D={stats['draw']} loss={loss.item():.5f}")
            if args.save_every and ep % args.save_every == 0:
                save_model(base_episodes + ep)
    except KeyboardInterrupt:
        print("\n중단 감지 — 현재까지 학습한 내용을 저장합니다...")
        save_model(base_episodes + ep)
        return
    save_model(base_episodes + args.episodes)


if __name__ == "__main__":
    main()
