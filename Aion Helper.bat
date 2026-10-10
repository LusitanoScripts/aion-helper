@echo off
title Aion Helper
cd /d "%~dp0"

REM O Electron recusa abrir a janela com isto definido (alguns shells exportam-no).
set "ELECTRON_RUN_AS_NODE="

if not exist "node_modules\electron" (
  echo A instalar dependencias pela primeira vez...
  call npm install
)

node_modules\.bin\electron.cmd .
