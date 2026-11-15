@echo off
rem ==========================================================================
rem  BlindRev - double-click launcher (pure cmd.exe, no PowerShell).
rem  1. If the desktop build exists, start it.
rem  2. Otherwise run the browser version: check Node + pnpm, install
rem     dependencies on first run, start the dev server, open the browser.
rem ==========================================================================
setlocal EnableExtensions
title BlindRev
cd /d "%~dp0"

set "BLINDREV_EXE=%~dp0packages\app-shell\src-tauri\target\release\blindrev.exe"
if exist "%BLINDREV_EXE%" (
  echo [BlindRev] Starting the desktop app...
  echo           %BLINDREV_EXE%
  start "" "%BLINDREV_EXE%"
  exit /b 0
)

echo [BlindRev] No desktop build found - starting the browser version instead.
echo.

rem ---- Node.js ---------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [BlindRev] ERROR: Node.js was not found.
  echo           Install Node.js 22 or newer from https://nodejs.org and run this file again.
  goto :fail
)
for /f "delims=" %%v in ('node --version') do set "BLINDREV_NODE=%%v"
echo [BlindRev] Node.js %BLINDREV_NODE% found.

rem ---- pnpm (fallbacks: corepack, npx) -----------------------------------------
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
set "PNPM="
where pnpm >nul 2>nul
if not errorlevel 1 set "PNPM=pnpm"
if not defined PNPM (
  where corepack >nul 2>nul
  if not errorlevel 1 (
    call corepack pnpm --version >nul 2>nul
    if not errorlevel 1 set "PNPM=corepack pnpm"
  )
)
if not defined PNPM (
  where npx >nul 2>nul
  if not errorlevel 1 set "PNPM=npx --yes pnpm@10.30.2"
)
if not defined PNPM (
  echo [BlindRev] ERROR: pnpm was not found, and neither corepack nor npx could provide it.
  echo           Install it with:  npm install -g pnpm
  goto :fail
)
echo [BlindRev] Package manager: %PNPM%

rem ---- dependencies (first run only) -------------------------------------------
if not exist "node_modules\.modules.yaml" (
  echo [BlindRev] Installing dependencies - first run only, this can take a few minutes...
  call %PNPM% install
  if errorlevel 1 (
    echo [BlindRev] ERROR: dependency install failed. Check your internet connection and try again.
    goto :fail
  )
)

rem ---- dev server + browser ----------------------------------------------------
echo [BlindRev] Starting the game server on http://localhost:5173
echo [BlindRev] Your browser will open in a few seconds. Keep this window open while you play;
echo           close it (or press Ctrl+C) to stop the game.
echo.
start "" /b cmd /c "ping -n 7 127.0.0.1 >nul & start "" http://localhost:5173"
call %PNPM% dev
if errorlevel 1 (
  echo [BlindRev] ERROR: the game server stopped with an error.
  echo           If port 5173 is already in use, close the other program or window using it.
  goto :fail
)
exit /b 0

:fail
echo.
echo [BlindRev] Something went wrong - read the messages above.
pause
exit /b 1
