@echo off
rem NAI Canvas launcher. Keep this file ASCII-only: cmd mis-parses UTF-8 text in .bat files.
cd /d "%~dp0"
title NAI Canvas
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js 24 from https://nodejs.org and try again.
  pause
  exit /b 1
)
node scripts\start.mjs
if errorlevel 1 pause
