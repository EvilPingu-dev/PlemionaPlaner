@echo off
title Planer Akcji – Plemiona
cd /d "%~dp0"

:: ── Auto-update ──────────────────────────────────────────────────────────────
echo  [INFO] Sprawdzanie aktualizacji...

where git >nul 2>&1
if %errorlevel% == 0 (
    :: Git available – fast pull
    git fetch origin main --quiet 2>nul
    for /f %%i in ('git rev-list HEAD..origin/main --count 2^>nul') do set BEHIND=%%i
    if defined BEHIND if "%BEHIND%" neq "0" (
        echo  [INFO] Znaleziono %BEHIND% nowe aktualizacje – pobieranie...
        git pull origin main --quiet 2>nul
        echo  [OK] Zaktualizowano.
    )
) else (
    :: No git – download ZIP via PowerShell and extract (overwrites code, keeps data\)
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$zip='%TEMP%\PlanerUpdate.zip'; $dest='%TEMP%\PlanerUpdate'; $repo='https://github.com/EvilPingu-dev/PlemionaPlaner/archive/refs/heads/main.zip'; try { Invoke-WebRequest $repo -OutFile $zip -UseBasicParsing -ErrorAction Stop } catch { exit 0 }; if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }; Expand-Archive $zip $dest -Force; $src=Join-Path $dest 'PlemionaPlaner-main'; Get-ChildItem $src | Where-Object { $_.Name -ne 'data' } | ForEach-Object { $t=Join-Path '%~dp0' $_.Name; if (Test-Path $t) { Remove-Item $t -Recurse -Force }; Copy-Item $_.FullName $t -Recurse -Force }; Write-Host '[OK] Zaktualizowano.'"
)
echo.

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
