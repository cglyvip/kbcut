@echo off
chcp 65001 >nul
title KBCut
cd /d "%~dp0"

where node >nul 2>&1 || (
  echo [ERROR] Node.js not found. Please install Node.js 20+ first.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)

npm run dev
if errorlevel 1 pause
