@echo off
title Planer Akcji – Plemiona
cd /d "%~dp0"

:: ── Check for uv ────────────────────────────────────────────────────────────
where uv >nul 2>&1
if %errorlevel% == 0 goto run_app

echo.
echo  [INFO] uv nicht gefunden – wird jetzt installiert...
echo  (einmalig, dauert ~10 Sekunden)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "irm https://astral.sh/uv/install.ps1 | iex"

:: Reload PATH so uv is found
set "PATH=%USERPROFILE%\.local\bin;%USERPROFILE%\.cargo\bin;%PATH%"

where uv >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [FEHLER] uv konnte nicht installiert werden.
    echo  Bitte Python 3.12+ manuell installieren: https://python.org
    pause
    exit /b 1
)

:run_app
echo.
echo  ============================================
echo   Planer Akcji startet...
echo   Browser wird automatisch geöffnet.
echo   Dieses Fenster offen lassen!
echo  ============================================
echo.

uv run python main.py

echo.
echo  Anwendung beendet.
pause
