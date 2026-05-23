from __future__ import annotations
import json
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .game import GameState
from .model import ValueModel
from .search import choose_action

BASE = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE / "models" / "frontier-model.json"
_model: ValueModel | None = None

def get_model() -> ValueModel:
    global _model
    if _model is None:
        _model = ValueModel.load(MODEL_PATH)
    return _model

class MoveRequest(BaseModel):
    state: dict
    simulations: int = Field(default=32, ge=1, le=250)
    seed: int | None = None

app = FastAPI(title="FRONTIER Python AI", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])

@app.get("/api/health")
async def health():
    model = get_model()
    return {"ok": True, "service": "frontier-python-ai", "model": model.name, "modelVersion": model.version}

@app.get("/api/model")
async def model_info():
    model = get_model()
    return {"name": model.name, "version": model.version, "metadata": model.metadata}

@app.post("/api/move")
async def move(payload: MoveRequest):
    try:
        state = GameState.from_json(payload.state)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    action, info = choose_action(state, get_model(), payload.simulations, payload.seed)
    if action is None:
        return {"ok": False, "reason": "no_legal_action", "info": info}
    return {"ok": True, "action": action.to_json(), "info": info, "model": get_model().name}
