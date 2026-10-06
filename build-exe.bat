@echo off
cd /d "%~dp0"
python -m venv .buildenv
.buildenv\Scripts\python -m pip install -q pyinstaller
.buildenv\Scripts\pyinstaller --onefile --noconsole --name PlayableBatch --clean ^
  --add-data "playable-batch.html;." store-helper.py
echo Built: dist\PlayableBatch.exe
pause
