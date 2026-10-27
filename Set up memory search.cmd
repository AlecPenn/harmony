@echo off
cd /d "%~dp0"
echo Setting up HARMONY memory search (about 200 MB the first time, free, stays on this PC).
if exist .venv\Scripts\python.exe (.venv\Scripts\python.exe -I scripts\setup-memory-model.py) else (echo Python for HARMONY is not set up yet. Run the speech setup first.)
pause
