@echo off
cd /d "%~dp0"
set PYTHONUTF8=1
echo ==================================================
echo    FRONTIER AlphaZero v2 training
echo ==================================================
echo  - Warm-starts from models\az-model.pt.
echo  - Uses a fresh replay: models\az-replay-v2.pkl.
echo  - Penalizes the side that makes a threefold draw.
echo  - Keeps old v1 model/replay files untouched.
echo ==================================================
echo.
".venv\Scripts\python.exe" -m frontier_ai.az.train --iterations 1000 --games-per-iter 48 --sims 64 --batch-size 256 --train-steps 300 --buffer 300000 --resume --init-from models/az-model.pt --out models/az-model-v2.pt --candidate-out models/az-candidate-v2.pt --replay-path models/az-replay-v2.pkl --threefold-contempt 0.20
echo.
echo === AZ v2 training stopped (checkpoint saved) ===
pause
