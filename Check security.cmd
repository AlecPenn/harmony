@echo off
cd /d "%~dp0"
echo HARMONY security check (read-only)...
node scripts\check-security.mjs
pause
