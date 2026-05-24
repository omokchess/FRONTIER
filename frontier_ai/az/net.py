"""AlphaZero-style policy+value residual CNN for FRONTIER."""
from __future__ import annotations
import numpy as np
import torch
from torch import nn
import torch.nn.functional as F
from .encoding import NUM_PLANES, POLICY_SIZE


class ResBlock(nn.Module):
    def __init__(self, ch: int):
        super().__init__()
        self.c1 = nn.Conv2d(ch, ch, 3, padding=1, bias=False)
        self.b1 = nn.BatchNorm2d(ch)
        self.c2 = nn.Conv2d(ch, ch, 3, padding=1, bias=False)
        self.b2 = nn.BatchNorm2d(ch)

    def forward(self, x):
        y = F.relu(self.b1(self.c1(x)))
        y = self.b2(self.c2(y))
        return F.relu(x + y)


class AZNet(nn.Module):
    def __init__(self, channels: int = 64, blocks: int = 6,
                 planes: int = NUM_PLANES, policy_size: int = POLICY_SIZE):
        super().__init__()
        self.channels, self.blocks = channels, blocks
        self.stem = nn.Sequential(
            nn.Conv2d(planes, channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(channels), nn.ReLU(inplace=True))
        self.res = nn.Sequential(*[ResBlock(channels) for _ in range(blocks)])
        self.p_conv = nn.Sequential(
            nn.Conv2d(channels, 2, 1, bias=False), nn.BatchNorm2d(2), nn.ReLU(inplace=True))
        self.p_fc = nn.Linear(2 * 8 * 8, policy_size)
        self.v_conv = nn.Sequential(
            nn.Conv2d(channels, 1, 1, bias=False), nn.BatchNorm2d(1), nn.ReLU(inplace=True))
        self.v_fc1 = nn.Linear(8 * 8, channels)
        self.v_fc2 = nn.Linear(channels, 1)

    def forward(self, x):
        x = self.stem(x)
        x = self.res(x)
        p = self.p_fc(self.p_conv(x).flatten(1))                 # policy logits [B, POLICY_SIZE]
        v = F.relu(self.v_fc1(self.v_conv(x).flatten(1)))
        v = torch.tanh(self.v_fc2(v)).squeeze(-1)                # value [B] in (-1, 1)
        return p, v


def pick_device(prefer_gpu: bool = True) -> torch.device:
    return torch.device("cuda" if prefer_gpu and torch.cuda.is_available() else "cpu")


@torch.no_grad()
def infer_batch(net: AZNet, planes: np.ndarray, device: torch.device):
    """planes: [B, NUM_PLANES, 8, 8] -> (policy_logits [B,POLICY_SIZE] np, value [B] np)."""
    net.eval()
    x = torch.from_numpy(np.ascontiguousarray(planes)).to(device=device, dtype=torch.float32)
    p, v = net(x)
    return p.cpu().numpy(), v.cpu().numpy()
