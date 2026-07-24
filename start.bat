@echo off
title Planer Akcji - Plemiona
cd /d "%~dp0"

echo.
echo  ============================================
echo   Planer Akcji - Tribal Wars
echo  ============================================
echo.

:: [1/3] Auto-update
echo  [1/3] Sprawdzanie aktualizacji z GitHub...
set BEHIND=0

where git >nul 2>&1
if %errorlevel% == 0 (
    echo        Git znaleziony - lacze z GitHub...
    git fetch origin main 2>nul
    if %errorlevel% neq 0 (
        echo        Brak polaczenia z GitHub - pomijam aktualizacje.
        goto update_done
    )
    for /f %%i in ('git rev-list HEAD..origin/main --count 2^>nul') do set BEHIND=%%i
    if "%BEHIND%"=="0" (
        echo        Aplikacja jest aktualna.
    ) else (
        echo        Znaleziono %BEHIND% nowe aktualizacje - pobieranie...
        git pull origin main
        echo        Gotowe - aplikacja zaktualizowana.
    )
    goto update_done
) else (
    echo        Brak git - pobieranie ZIP z GitHub...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$zip='%TEMP%\PlanerUpdate.zip'; $dest='%TEMP%\PlanerUpdate'; $repo='https://github.com/EvilPingu-dev/PlemionaPlaner/archive/refs/heads/main.zip'; try { Write-Host '       Pobieranie plikow...'; Invoke-WebRequest $repo -OutFile $zip -UseBasicParsing -ErrorAction Stop; Write-Host '       Rozpakowywanie...'; if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }; Expand-Archive $zip $dest -Force; $src=Join-Path $dest 'PlemionaPlaner-main'; Write-Host '       Instalowanie aktualizacji...'; Get-ChildItem $src | Where-Object { $_.Name -ne 'data' } | ForEach-Object { $t=Join-Path '%~dp0' $_.Name; if (Test-Path $t) { Remove-Item $t -Recurse -Force }; Copy-Item $_.FullName $t -Recurse -Force }; Write-Host '       Gotowe - aplikacja zaktualizowana.' } catch { Write-Host '       Brak internetu lub problem z GitHub - pomijam aktualizacje.' }"
)

:update_done
echo.

:: [2/3] Python / uv
echo  [2/3] Sprawdzanie srodowiska Python...

where uv >nul 2>&1
if %errorlevel% == 0 goto deps_ok

echo        Brak uv - instalowanie (jednorazowo, ok. 10 sekund)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
set "PATH=%USERPROFILE%\.local\bin;%USERPROFILE%\.cargo\bin;%PATH%"

where uv >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [BLAD] Nie udalo sie zainstalowac uv.
    echo  Pobierz Python 3.12 ze strony: https://python.org
    pause
    exit /b 1
)

:deps_ok
echo        Python OK.
echo.

:: [3/3] Biblioteki
echo  [3/3] Sprawdzanie bibliotek...
uv sync --quiet 2>nul
echo        Biblioteki OK.
echo.

:: Start
echo  ============================================
echo   Uruchamianie...
echo   Przegladarka otworzy sie automatycznie.
echo   Pozostaw to okno otwarte podczas gry!
echo  ============================================
echo.

uv run python main.py

echo.
echo  Aplikacja zatrzymana.
pause
