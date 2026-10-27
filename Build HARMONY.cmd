@echo off
cd /d "%~dp0"
echo Building HARMONY...
call npm run build
if errorlevel 1 (echo.& echo The build failed. Scroll up to see why.) else (echo.& echo Done. Close HARMONY if it is open, then start it again.)
pause
