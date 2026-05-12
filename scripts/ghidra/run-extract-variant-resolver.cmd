@echo off
REM Headless run of ExtractVariantResolver.java against the existing
REM ghidra-am4-edit project.
REM
REM Output:
REM   C:\dev\mcp-midi-tools\samples\captured\decoded\ghidra-variant-resolver.txt
REM
REM Usage:
REM   scripts\ghidra\run-extract-variant-resolver.cmd
REM
REM Override Ghidra install location if needed:
REM   set GHIDRA_INSTALL_DIR=C:\path\to\ghidra_X.Y.Z_PUBLIC
REM   scripts\ghidra\run-extract-variant-resolver.cmd

setlocal

if "%GHIDRA_INSTALL_DIR%"=="" set GHIDRA_INSTALL_DIR=C:\tools\ghidra_12.0.4_PUBLIC

set HEADLESS=%GHIDRA_INSTALL_DIR%\support\analyzeHeadless.bat
if not exist "%HEADLESS%" (
    echo ERROR: analyzeHeadless.bat not found at "%HEADLESS%".
    echo Set GHIDRA_INSTALL_DIR to your Ghidra install root and re-run.
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
    -postScript ExtractVariantResolver.java

if errorlevel 1 (
    echo.
    echo Ghidra headless exited with errors. See output above.
    exit /b 1
)

echo.
echo Done. Output:
echo   %OUT_DIR%\ghidra-variant-resolver.txt
endlocal
