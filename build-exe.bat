@echo off
cd /d "%~dp0"
python -m venv .buildenv
.buildenv\Scripts\python -m pip install -q pyinstaller
.buildenv\Scripts\pyinstaller --onefile --noconsole --name AdsTool --clean ^
  --add-data "ads-tool.html;." store-helper.py
echo Built: dist\AdsTool.exe
pause
