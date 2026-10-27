@echo off
cd /d "%~dp0"
echo Setting up HARMONY's free local brain (about 3 GB of downloads the first time).
where py >nul 2>nul && (py -3 scripts\provision-local-model.py %*) || (python scripts\provision-local-model.py %*)
echo.
echo Setting up memory search (about 200 MB the first time).
if exist .venv\Scripts\python.exe (.venv\Scripts\python.exe -I scripts\setup-memory-model.py) else (echo Run the speech setup first so Python is ready.)
pause
