from __future__ import annotations
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .game import GameState
from .model import ValueModel
from .search import choose_action

BASE = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE / "models" / "frontier-model.json"
AZ_ONNX = BASE / "models" / "az-model.onnx"

_model: ValueModel | None = None
_az = None
_az_tried = False


def get_model() -> ValueModel:
    global _model
    if _model is None:
        _model = ValueModel.load(MODEL_PATH)
    return _model


def get_az():
    """Return an AlphaZero onnx player if a model is present and deps load; else None (fall back to v1)."""
    global _az, _az_tried
    if _az is None and not _az_tried:
        _az_tried = True
        if AZ_ONNX.exists():
            try:
                from .az.serve import AZPlayer
                _az = AZPlayer(str(AZ_ONNX))
            except Exception as exc:  # numpy/onnxruntime missing or bad model -> stay on v1
                print(f"[frontier-ai] AZ model present but failed to load ({exc}); using value-mlp.")
    return _az


class MoveRequest(BaseModel):
    state: dict
    simulations: int = Field(default=32, ge=1, le=250)
    seed: int | None = None


app = FastAPI(title="FRONTIER Python AI", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                   allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])


@app.get("/api/health")
async def health():
    if get_az() is not None:
        return {"ok": True, "service": "frontier-python-ai", "engine": "alphazero", "model": "az-model.onnx"}
    model = get_model()
    return {"ok": True, "service": "frontier-python-ai", "engine": "value-mlp",
            "model": model.name, "modelVersion": model.version}


@app.get("/api/model")
async def model_info():
    if get_az() is not None:
        return {"engine": "alphazero", "model": "az-model.onnx"}
    model = get_model()
    return {"engine": "value-mlp", "name": model.name, "version": model.version, "metadata": model.metadata}


@app.post("/api/move")
async def move(payload: MoveRequest):
    try:
        state = GameState.from_json(payload.state)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    az = get_az()
    if az is not None:
        action, info = az.choose_action(state, payload.simulations)
    else:
        action, info = choose_action(state, get_model(), payload.simulations, payload.seed)
    if action is None:
        return {"ok": False, "reason": "no_legal_action", "info": info}
    return {"ok": True, "action": action.to_json(), "info": info, "engine": info.get("engine", "value-mlp")}
