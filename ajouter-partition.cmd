@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Bibliotheque du lecteur MusicXML

set "script=%~dp0bibliotheque.ps1"

if not exist "%script%" (
  echo.
  echo Erreur : bibliotheque.ps1 est introuvable.
  echo Il doit rester dans le meme dossier que ce lanceur.
  pause
  exit /b 1
)

:menu
cls
echo.
echo   LECTEUR MUSICXML - BIBLIOTHEQUE DES PARTITIONS
echo   ===============================================
echo.
echo   1. Ouvrir le dossier des partitions dans l'Explorateur
echo   2. Ajouter plusieurs partitions avec l'Explorateur
echo   3. Ajouter une partition avec l'Explorateur
echo   4. Enlever plusieurs partitions
echo   5. Choisir le dossier ouvert par defaut dans l'Explorateur
echo   0. Fermer
echo.
set "choice="
set /p "choice=Votre choix : "

if "%choice%"=="1" goto openLibrary
if "%choice%"=="2" goto addBatch
if "%choice%"=="3" goto addGuided
if "%choice%"=="4" goto removeBatch
if "%choice%"=="5" goto chooseSource
if "%choice%"=="0" exit /b 0
goto menu

:openLibrary
cls
echo.
echo   OUVERTURE DU DOSSIER DES PARTITIONS
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%script%" -Action open-library
echo.
pause
goto menu

:addBatch
cls
echo.
echo   AJOUTER PLUSIEURS PARTITIONS MUSICXML
echo.
echo   L'Explorateur va s'ouvrir. Selectionnez les fichiers MusicXML,
echo   XML ou MXL avec Ctrl ou Maj, puis validez.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%script%" -Action add-batch
echo.
pause
goto menu

:addGuided
cls
echo.
echo   AJOUTER UNE PARTITION MUSICXML
echo.
echo   L'Explorateur va s'ouvrir. Choisissez un fichier MusicXML, XML ou MXL.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%script%" -Action add-guided
echo.
pause
goto menu

:removeBatch
cls
echo.
echo   ENLEVER PLUSIEURS PARTITIONS
echo.
echo   Cochez les partitions a enlever, puis validez.
echo   Elles seront retirees de la liste et du dossier partitions.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%script%" -Action remove-batch
echo.
pause
goto menu

:chooseSource
cls
echo.
echo   CHOISIR LE DOSSIER INITIAL DE L'EXPLORATEUR
echo.
echo   Ce dossier sera propose lors des prochains ajouts.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%script%" -Action choose-source
echo.
pause
goto menu
