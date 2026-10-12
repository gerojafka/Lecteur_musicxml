@echo off
setlocal
title Bibliotheque du lecteur MusicXML v27
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bibliotheque.ps1"
if errorlevel 1 pause
