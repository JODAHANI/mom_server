@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === mom_store server update ===
echo.
echo [1/3] git fetch origin
git fetch origin
if errorlevel 1 (
    echo git fetch failed.
    pause
    exit /b 1
)

echo.
echo [2/3] git reset --hard origin/main  (local changes will be discarded)
git reset --hard origin/main
if errorlevel 1 (
    echo git reset failed.
    pause
    exit /b 1
)

echo.
echo [3/3] npm install
call npm install
if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
)

echo.
echo === update complete ===
pause
