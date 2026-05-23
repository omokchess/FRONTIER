from __future__ import annotations
import json, math, random
from pathlib import Path
from .features import FEATURE_DIM


def _relu(xs: list[float]) -> list[float]:
    return [x if x > 0.0 else 0.0 for x in xs]


def _linear(w: list[list[float]], b: list[float], x: list[float]) -> list[float]:
    return [sum(a * z for a, z in zip(row, x)) + bias for row, bias in zip(w, b)]


class ValueModel:
    """Small MLP exported from PyTorch and runnable inside Cloudflare Python Workers."""
    def __init__(self, data: dict):
        self.name = data.get("name", "frontier-default")
        self.version = int(data.get("version", 1))
        self.layers = data["layers"]
        self.metadata = data.get("metadata", {})

    @classmethod
    def load(cls, path: str | Path) -> "ValueModel":
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def value(self, features: list[float]) -> float:
        x = features
        for layer in self.layers[:-1]:
            x = _relu(_linear(layer["weight"], layer["bias"], x))
        y = _linear(self.layers[-1]["weight"], self.layers[-1]["bias"], x)[0]
        return math.tanh(y)


def make_seed_model(seed: int = 67194, hidden: int = 32) -> dict:
    rng = random.Random(seed)
    def layer(out_dim: int, in_dim: int, scale: float) -> dict:
        return {"weight": [[rng.uniform(-scale, scale) for _ in range(in_dim)] for _ in range(out_dim)],
                "bias": [0.0 for _ in range(out_dim)]}
    return {"name": "frontier-seed", "version": 1,
            "metadata": {"algorithm": "afterstate-value-mlp", "trained_episodes": 0},
            "layers": [layer(hidden, FEATURE_DIM, 0.08), layer(hidden, hidden, 0.08), layer(1, hidden, 0.04)]}
