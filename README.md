# Ads Tool (Windows exe version)

Python helper + HTML tool, packaged as one `AdsTool.exe` with PyInstaller. Windows only, needs Microsoft Edge (built into Windows 10/11).
Double-click `AdsTool.exe`: an app-style Edge window opens. Closing the window stops the tool.

The cross-platform version (Chrome/Edge extension, no exe) is on the `main` branch.

## Build
`build-exe.bat` -> `dist\AdsTool.exe`. Requires Python 3.

## Run from source
`python store-helper.py`

Unsigned exe: Windows SmartScreen may warn on first run ("More info" -> "Run anyway").
