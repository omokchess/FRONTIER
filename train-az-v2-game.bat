@echo off
cd /d "%~dp0"
set PYTHONUTF8=1
echo ==================================================
echo    FRONTIER AlphaZero v2 training - gaming mode
echo ==================================================
echo  - Resumes the same v2 model/replay.
echo  - Runs Python at low priority.
echo  - Uses fewer self-play workers so games stay playable.
echo ==================================================
echo.
start "FRONTIER AZ v2 gaming mode" /low /wait ".venv\Scripts\python.exe" -m frontier_ai.az.train --iterations 1000 --games-per-iter 48 --sims 64 --workers 4 --batch-size 256 --train-steps 300 --buffer 300000 --resume --out models/az-model-v2.pt --candidate-out models/az-candidate-v2.pt --replay-path models/az-replay-v2.pkl --threefold-contempt 0.20 --arena-games 12 --arena-sims 24 --arena-bootstrap-until 60 --arena-bootstrap-threshold 0.40
echo.
echo === AZ v2 gaming-mode training stopped (checkpoint saved) ===
pause
