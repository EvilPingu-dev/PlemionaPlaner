@echo off
title Planer Akcji – Plemiona
cd /d "%~dp0"

:: ── Auto-update from GitHub ──────────────────────────────────────────────────
where git >nul 2>&1
if %errorlevel% == 0 (
    echo  [INFO] Sprawdzanie aktualizacji...
    git fetch origin main --quiet 2>nul
    for /f %%i in ('git rev-list HEAD..origin/main --count 2^>nul') do set BEHIND=%%i
    if defined BEHIND if "%BEHIND%" neq "0" (
        echo  [INFO] Znaleziono %BEHIND% nowe aktualizacje – pobieranie...
        git pull origin main --quiet 2>nul
        echo  [OK] Zaktualizowano do najnowszej wersji.
        echo.
    )
) else (
    echo  [INFO] Git nie znaleziony – pomijam sprawdzanie aktualizacji.
)

:: ── Check for uv ────────────────────────────────────────────────────────────
where uv >nul 2>&1
if %errorlevel% == 0 goto run_app

echo.
echo  [INFO] Brak uv – instalowanie...
echo  (jednorazowo, zajmuje ~10 sekund)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "irm https://astral.sh/uv/install.ps1 | iex"

:: Reload PATH so uv is found
set "PATH=%USERPROFILE%\.local\bin;%USERPROFILE%\.cargo\bin;%PATH%"

where uv >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [BLAD] Nie udalo sie zainstalowac uv.
    echo  Zainstaluj Python 3.12+ recznie: https://python.org
    pause
    exit /b 1
)

:run_app
echo.
echo  ============================================
echo   Planer Akcji uruchamia sie...
echo   Przegladarka otworzy sie automatycznie.
echo   Pozostaw to okno otwarte!
echo  ============================================
echo.

uv run python main.py

echo.
echo  Aplikacja zatrzymana.
pause
