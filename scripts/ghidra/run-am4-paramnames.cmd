@echo off
REM Headless run of DumpAM4ParamNames.java.
REM Output:
REM   C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-am4-paramnames.txt
REM   C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-am4-paramnames.json

setlocal

if "%GHIDRA_INSTALL_DIR%"=="" set GHIDRA_INSTALL_DIR=C:\tools\ghidra_12.0.4_PUBLIC

set HEADLESS=%GHIDRA_INSTALL_DIR%\support\analyzeHeadless.bat

set PROJECT_DIR=C:\Users\Steph
set PROJECT_NAME=ghidra-am4-edit
set SCRIPT_DIR=C:\dev\mcp-midi-tools\scripts\ghidra
set OUT_DIR=C:\dev\mcp-midi-tools\samples\captured\decoded

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

"%HEADLESS%" "%PROJECT_DIR%" "%PROJECT_NAME%" ^
    -process "AM4-Edit.exe" ^
    -noanalysis ^
    -readOnly ^
    -scriptPath "%SCRIPT_DIR%" ^
    -postScript DumpAM4ParamNames.java

if errorlevel 1 (
    echo Ghidra headless exited with errors.
    exit /b 1
)

echo Done.
endlocal
