@echo off
rem Runs the Wi-Fi watchdog scan once (read-only) and saves what it saw to .runtime\wifi-scan.json.
cd /d "%~dp0"
if not exist .runtime mkdir .runtime
powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File workers\network\neighbors.ps1 -Sweep > .runtime\wifi-scan.json
echo Wi-Fi scan saved to .runtime\wifi-scan.json
timeout /t 5
