@echo off
setlocal
cd /d "%~dp0"
set "PYCMD="
py -3 -c "import sys" >nul 2>nul && set "PYCMD=py -3"
if not defined PYCMD python -c "import sys" >nul 2>nul && set "PYCMD=python"
if not defined PYCMD (
  echo.
  echo Khong tim thay Python 3. Hay cai Python 3 tai https://www.python.org/downloads/
  echo - tick "Add python.exe to PATH" khi cai - roi chay lai file nay.
  echo.
  echo Python 3 was not found. Install it from https://www.python.org/downloads/
  echo - tick "Add python.exe to PATH" - then run this file again.
  echo.
  pause
  exit /b 1
)
%PYCMD% "%~dp0updater\install.py"
echo.
pause
