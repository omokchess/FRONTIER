"""Export a trained AZ checkpoint (.pt) to ONNX so it can be served with onnxruntime (no torch)."""
from __future__ import annotations
import argparse
import sys
import torch
from .net import AZNet
from .encoding import NUM_PLANES


def export(ckpt_path: str, onnx_path: str) -> dict:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # torch.onnx may print unicode
    except Exception:
        pass
    ckpt = torch.load(ckpt_path, map_location="cpu")
    cfg = ckpt["cfg"]
    net = AZNet(**cfg)
    net.load_state_dict(ckpt["state_dict"])
    net.eval()
    dummy = torch.zeros(1, NUM_PLANES, 8, 8)
    torch.onnx.export(
        net, dummy, onnx_path,
        input_names=["planes"], output_names=["policy", "value"],
        dynamic_axes={"planes": {0: "batch"}, "policy": {0: "batch"}, "value": {0: "batch"}},
        opset_version=18, dynamo=False, verbose=False,
    )
    return cfg


def main() -> None:
    ap = argparse.ArgumentParser(description="Export AZ .pt checkpoint to ONNX")
    ap.add_argument("--ckpt", default="models/az-model.pt")
    ap.add_argument("--out", default="models/az-model.onnx")
    args = ap.parse_args()
    cfg = export(args.ckpt, args.out)
    print(f"exported {args.ckpt} -> {args.out} (cfg={cfg})")


if __name__ == "__main__":
    main()
