@echo off
setlocal
title Partition vers MIDI
net session >nul 2>nul
if not "%errorlevel%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "APP_PYTHON=C:\Users\jafka\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%APP_PYTHON%" goto run
where py >nul 2>nul
if %errorlevel%==0 set "APP_PYTHON=py"& goto run
where python >nul 2>nul
if %errorlevel%==0 set "APP_PYTHON=python"& goto run
echo Python est introuvable sur cet ordinateur.
echo Installez Python 3.11 ou plus recent, puis relancez ce fichier.
pause
exit /b 1
:run
cd /d "%~dp0"
"%APP_PYTHON%" server.py
if errorlevel 1 pause
