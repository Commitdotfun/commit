@echo off
chcp 65001 >nul
title Deploiement Commit
echo Deploiement de Commit via Ubuntu (WSL)...
echo.
wsl.exe bash -ic "cd /mnt/c/Users/naelm/Documents/memecoin-projets/commit && node tools/deploy.mjs"
echo.
echo Termine. Dis a Claude que c est fait (le resultat est enregistre dans commit\deploy-log.txt).
pause
