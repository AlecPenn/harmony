@echo off
cd /d "%~dp0"
echo Setting up HARMONY (hearing, wake word and voice). The first time downloads about 1.5 GB.
where py >nul 2>nul && (py -3 scripts\setup-all.py) || (python scripts\setup-all.py)
pause
