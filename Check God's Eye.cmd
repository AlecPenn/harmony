@echo off
cd /d "%~dp0"
echo Checking God's Eye and its live world feeds (read-only public data)...
node scripts\check-gods-eye.ts
pause
