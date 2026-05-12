@echo off
REM Headless run of DumpResolverTables.java (cont 4 followup).
REM Output: C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-resolver-tables.txt

setlocal

if "%GHIDRA_INSTALL_DIR%"=="" set GHIDRA_INSTALL_DIR=C:\tools\ghidra_12.0.4_PUBLIC

set HEADLESS=%GHIDRA_INSTALL_DIR%\support\analyzeHeadless.bat
if not exist "%HEADLESS%" (
    echo ERROR: analyzeHeadless.bat not found at "%HEADLESS%".
    exit /b 1
)

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
    -postScript DumpResolverTables.java

if errorlevel 1 (
    echo.
    echo Ghidra headless exited with errors.
    exit /b 1
)

echo.
echo Done. Output: %OUT_DIR%\ghidra-resolver-tables.txt
endlocal
