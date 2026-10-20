@echo off
setlocal
title Lecteur MusicXML v26
cd /d "%~dp0"
set "READER_PYTHON=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if exist "%READER_PYTHON%" goto run
set "READER_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%READER_PYTHON%" goto run
where py >nul 2>nul
if not errorlevel 1 (
 py -3 server.py
 goto done
)
where python >nul 2>nul
if not errorlevel 1 (
 python server.py
 goto done
)
echo Python 3 est necessaire uniquement pour l'apercu local.
echo Sur GitHub Pages, publiez directement ce dossier, sans installation.
pause
exit /b 1
:run
"%READER_PYTHON%" server.py
:done
if errorlevel 1 pause
