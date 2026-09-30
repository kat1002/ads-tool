@echo off
py -3 "%~dp0host.py" %* 2>nul || python "%~dp0host.py" %*
