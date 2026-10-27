@echo off
cd /d "%~dp0"
echo Checking HARMONY's brain on 52 everyday requests (close HARMONY first; about 3 minutes)...
node --experimental-strip-types scripts\brain-check.ts
pause
