@echo off
title OneClient Bridge
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on this computer.
  echo Install the LTS version from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)
node "%~dp0oneclient-bridge.js" %*
echo.
echo The bridge has stopped.
pause
