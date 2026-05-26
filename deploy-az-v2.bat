@echo off
cd /d "%~dp0"
set PYTHONUTF8=1
echo ============================================
echo   Deploy AlphaZero v2 model to Render
echo ============================================
echo.
if not exist "models\az-model-v2.pt" (
  echo [No model] models\az-model-v2.pt not found. Run train-az-v2.bat first.
  echo.
  pause
  exit /b
)
echo Exporting v2 trained net to ONNX...
".venv\Scripts\python.exe" -m frontier_ai.az.export_onnx --ckpt models/az-model-v2.pt --out models/az-model.onnx
echo.
echo Uploading AlphaZero stack + v2 ONNX model to GitHub...
git add frontier_ai requirements.txt models/az-model.onnx
git commit -m "deploy AlphaZero v2 model"
if errorlevel 1 (
  echo.
  echo [No change to commit]
) else (
  git push
  echo.
  echo === Done! Render redeploys with AlphaZero v2 shortly ===
  echo Check: https://frontier-python-ai.onrender.com/api/health
)
echo.
pause
