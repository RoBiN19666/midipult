@echo off
rem Double-click friendly wrapper: keeps the window open and shows the error.
rem Usage from console:  deploy\push.cmd -Station 192.168.1.100
setlocal
cd /d "%~dp0.."
title Midi panel upload

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push-to-station.ps1" %*
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
    echo === DONE ===
) else (
    echo === FAILED, exit code %RC% ===
    echo See push.log in the project folder.
)
echo.
pause
exit /b %RC%
