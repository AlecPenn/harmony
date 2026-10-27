@echo off
cd /d "%~dp0"
echo Setting up HARMONY security: voice and face checks (about 110 MB, free, stays on this PC).
if exist .venv\Scripts\python.exe (.venv\Scripts\python.exe -I scripts\setup-guard.py) else (echo Python for HARMONY is not set up yet. Run the speech setup first.)
pause
