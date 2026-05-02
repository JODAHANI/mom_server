@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === mom_store server start ===
if not exist node_modules (
    echo node_modules not found. running npm install...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
)
call npm run dev
pause
