@echo off
chcp 65001 >nul
title 口播智剪
cd /d "%~dp0"

where node >nul 2>&1 || (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 20+ 后再运行。
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)

npm run dev
if errorlevel 1 pause
